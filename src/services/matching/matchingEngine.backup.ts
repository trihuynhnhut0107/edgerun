/**
 * REGION-BASED ITERATIVE MATCHING ENGINE
 *
 * Enhanced algorithm with:
 * - PostGIS region-based spatial filtering for efficiency
 * - Iterative Draft → Offer → Loop cycle
 * - Time window validation using SAA (Sample Average Approximation)
 * - Mapbox-only routing (no OSRM)
 *
 * Stages:
 * STAGE 0: Region Splitting - Group orders/drivers by geographic proximity (PostGIS)
 * STAGE 1: Territory Sectorization - Assign orders to nearest drivers within regions
 * STAGE 2: Driver Matching - Implicit in Stage 1 (each driver has sector)
 * STAGE 3: Route Optimization - Generate efficient delivery sequences per driver
 * STAGE 4: Time Window Generation - SAA-based window calculation with confidence scoring
 * STAGE 5: Draft → Offer → Loop - Iterative assignment with driver feedback
 *
 * Reference: https://arxiv.org/html/2508.01032v1
 */

import { AppDataSource } from "../../config/ormconfig";
import { Order } from "../../entities/Order";
import { Driver } from "../../entities/Driver";
import { OrderAssignment } from "../../entities/OrderAssignment";
import { OrderStatus } from "../../enums/OrderStatus";
import { DriverStatus } from "../../enums/DriverStatus";
import { AssignmentStatus } from "../../enums/AssignmentStatus";
import { Location } from "../../interfaces/Location";
import { getLatestDriverLocation } from "../geospatial/queries";
import {
  getDistance,
  isWithinRoutableDistance,
  haversineDistance,
} from "../routing/mapboxClient";
import {
  orderAssignmentService,
  TimeWindowData,
} from "../assignment/order-assignment.service";
import {
  timeWindowCalculator,
  DEFAULT_TIME_WINDOW_PARAMS,
  CalculatedTimeWindow,
} from "../timeWindow/timeWindowCalculator";
import { RegionService, Region } from "./RegionService";
import { DraftMemory, ScoredDraft } from "./DraftMemory";
import { draftService } from "./draftService";
import { DraftGroup } from "../../entities/DraftGroup";

/**
 * Sector: All orders assigned to a specific driver
 */
export interface Sector {
  driverId: string;
  orders: Order[];
  driver: Driver;
  driverLocation: Location;
}

/**
 * Stop: Represents a single stop in a route (pickup or delivery)
 * Part of VRPPD (Vehicle Routing Problem with Pickup and Delivery) implementation
 */
export interface Stop {
  orderId: string;
  type: "pickup" | "delivery";
  location: Location;
  sequenceIndex: number; // Position in route sequence
  cumulativeDistance: number; // Total distance from depot to this stop (meters)
  cumulativeTime: number; // Total time from depot to this stop (minutes)
}

/**
 * Route: Optimized sequence of locations for a driver
 * Supports batched delivery routing (VRPPD) with pickup/delivery stops
 */
export interface OptimizedRoute {
  driverId: string;
  driverName: string;
  orders: Order[];
  sequence: Location[]; // ALL stops in optimal order (including pickups and deliveries)
  stops: Stop[]; // Metadata for each stop (NEW: for VRPPD support)
  totalDistance: number; // meters
  metrics: {
    orderCount: number;
    distancePerOrder: number;
  };
  timeWindows?: (TimeWindowData | null)[]; // Generated time window data (null if generation failed for that order)
}

/**
 * ===================================================================
 * STAGE 1: TERRITORY SECTORIZATION
 * Assign each pending order to the nearest available driver
 * Time Complexity: O(n × m) where n=orders, m=drivers
 * ===================================================================
 */

export async function sectorizeOrders(
  orders: Order[],
  driversWithLocation: DriverWithLocation[]
): Promise<Sector[]> {
  const sectors: Sector[] = [];

  // Initialize sector for each driver
  const driverMap = new Map<string, DriverWithLocation>(
    driversWithLocation.map((dw) => [dw.driver.id, dw])
  );
  const sectorMap = new Map<string, Order[]>();

  for (const dw of driversWithLocation) {
    sectorMap.set(dw.driver.id, []);
  }

  // Assign each order to nearest available driver
  for (const order of orders) {
    // Get all available drivers with capacity
    const availableDrivers = driversWithLocation.filter((dw) => {
      const assignedCount = sectorMap.get(dw.driver.id)?.length || 0;
      return (
        dw.driver.status !== DriverStatus.OFFLINE &&
        assignedCount < dw.driver.maxOrders
      );
    });

    if (availableDrivers.length === 0) {
      console.warn(`⚠️  No available driver for order ${order.id}`);
      continue;
    }

    // Find closest driver using Mapbox routing with geographic pre-filtering
    let closestDW = availableDrivers[0];
    let minDistance = Infinity;
    const pickupCoords = order.pickupLocation?.coordinates || [0, 0];
    const orderLocation: Location = {
      lat: pickupCoords[1],
      lng: pickupCoords[0],
    };

    // Pre-filter: only consider drivers within 100km straight-line distance
    const nearbyDrivers = availableDrivers.filter((dw) =>
      isWithinRoutableDistance(dw.location, orderLocation, 100)
    );

    if (nearbyDrivers.length === 0) {
      console.warn(
        `⚠️  No drivers within 100km of order ${order.id} (skipping)`
      );
      continue;
    }

    for (const dw of nearbyDrivers) {
      try {
        const result = await getDistance(dw.location, orderLocation);
        const distance = result.distance_m;

        if (distance < minDistance) {
          minDistance = distance;
          closestDW = dw;
        }
      } catch (error) {
        // Optimistically skip failed route calculations
        console.warn(
          `⚠️  Mapbox routing unavailable for driver ${dw.driver.id} → order ${order.id} (skipping)`
        );
        continue; // Skip this driver, try next one
      }
    }

    // Skip order if no drivers could be routed to it
    if (minDistance === Infinity) {
      console.warn(
        `⚠️  No routable drivers found for order ${order.id} (skipping)`
      );
      continue;
    }

    // Assign order to closest driver
    const driverSector = sectorMap.get(closestDW.driver.id)!;
    driverSector.push(order);
  }

  // Convert map to array of Sector objects
  for (const [driverId, orderList] of sectorMap.entries()) {
    const dw = driverMap.get(driverId);
    if (dw) {
      sectors.push({
        driverId,
        orders: orderList,
        driver: dw.driver,
        driverLocation: dw.location,
      });
    }
  }

  return sectors;
}

/**
 * Get pending orders ready for matching
 */
export async function getPendingOrders(): Promise<Order[]> {
  const orderRepo = AppDataSource.getRepository(Order);
  return await orderRepo.find({
    where: { status: OrderStatus.PENDING },
    order: { priority: "DESC", createdAt: "ASC" },
  });
}

/**
 * Driver with current location
 */
export interface DriverWithLocation {
  driver: Driver;
  location: Location;
}

/**
 * Get all active (non-offline) drivers with their current locations
 */
export async function getAvailableDrivers(): Promise<DriverWithLocation[]> {
  const driverRepo = AppDataSource.getRepository(Driver);
  const drivers = await driverRepo.find({
    where: [
      { status: DriverStatus.AVAILABLE },
      { status: DriverStatus.EN_ROUTE_PICKUP },
      { status: DriverStatus.AT_PICKUP },
      { status: DriverStatus.EN_ROUTE_DELIVERY },
      { status: DriverStatus.AT_DELIVERY },
    ],
  });

  // Get current location for each driver from latest entry
  const driversWithLocation = await Promise.all(
    drivers.map(async (driver) => {
      const latestLoc = await getLatestDriverLocation(driver.id);
      // Extract lat/lng from PostGIS Point geometry (coordinates are [lng, lat])
      const coords = latestLoc?.location?.coordinates || [0, 0];
      const location: Location = latestLoc
        ? { lat: coords[1], lng: coords[0] }
        : { lat: 0, lng: 0 }; // Default to origin if no location
      return { driver, location };
    })
  );

  return driversWithLocation;
}

/**
 * ===================================================================
 * STAGE 3: ROUTE OPTIMIZATION
 * For each driver's sector, generate optimized delivery sequence
 * ===================================================================
 */

/**
 * STAGE 3a: Nearest Neighbor - Initial route generation
 * Time Complexity: O(n²) where n = orders per driver
 * Quality: 70-80% of optimal
 *
 * Uses Mapbox Directions API for actual road distances
 */
export async function nearestNeighbor(
  orders: Order[],
  startLocation: Location
): Promise<Location[]> {
  if (orders.length === 0) {
    return [startLocation];
  }

  const route: Location[] = [startLocation];
  const unvisited = new Set<Order>(orders);

  // Start from driver location
  let current = startLocation;

  // Greedily add nearest unvisited order
  while (unvisited.size > 0) {
    let nearest: Order | null = null;
    let minDistance = Infinity;

    for (const order of unvisited) {
      // Extract lat/lng from PostGIS Point geometry
      const pickupCoords = order.pickupLocation?.coordinates || [0, 0];
      const orderLocation: Location = {
        lat: pickupCoords[1],
        lng: pickupCoords[0],
      };

      try {
        // Use Mapbox Directions API for actual road distance
        const result = await getDistance(current, orderLocation);
        const distance = result.distance_m;

        if (distance < minDistance) {
          minDistance = distance;
          nearest = order;
        }
      } catch (error) {
        // Optimistically skip failed route calculations
        console.warn(
          `⚠️  Mapbox routing unavailable in nearestNeighbor (skipping order ${order.id})`
        );
        continue; // Skip this order, try next one
      }
    }

    if (!nearest) break;

    // Add to route
    const nearestCoords = nearest.pickupLocation?.coordinates || [0, 0];
    route.push({
      lat: nearestCoords[1],
      lng: nearestCoords[0],
    });

    // Mark as visited
    unvisited.delete(nearest);
    current = {
      lat: nearestCoords[1],
      lng: nearestCoords[0],
    };
  }

  // Return to start (complete circuit)
  route.push(startLocation);

  return route;
}

/**
 * STAGE 3b: 2-Opt Improvement - Local search optimization
 * Time Complexity: O(n² × iterations)
 * Improvement: 10-20% distance reduction
 *
 * Uses Mapbox Directions API for accurate distance calculations
 */
export async function twoOpt(
  route: Location[],
  maxIterations: number = 10
): Promise<Location[]> {
  if (route.length <= 3) return route; // No optimization possible

  let improved = true;
  let iteration = 0;

  while (improved && iteration < maxIterations) {
    improved = false;

    // Try all edge pairs
    for (let i = 1; i < route.length - 2; i++) {
      for (let j = i + 1; j < route.length - 1; j++) {
        try {
          // Current edges: (i-1 → i) and (j → j+1)
          const [d1, d2] = await Promise.all([
            getDistance(route[i - 1], route[i]),
            getDistance(route[j], route[j + 1]),
          ]);
          const currentDistance = d1.distance_m + d2.distance_m;

          // New edges after swap: (i-1 → j) and (i → j+1)
          const [d3, d4] = await Promise.all([
            getDistance(route[i - 1], route[j]),
            getDistance(route[i], route[j + 1]),
          ]);
          const newDistance = d3.distance_m + d4.distance_m;

          // If swap improves, reverse segment [i:j]
          if (newDistance < currentDistance) {
            // Reverse the segment
            const reversed = route.slice(i, j + 1).reverse();
            route.splice(i, j - i + 1, ...reversed);
            improved = true;
            break;
          }
        } catch (error) {
          // Optimistically skip failed route calculations
          console.warn(
            `⚠️  Mapbox routing unavailable in twoOpt (skipping swap)`
          );
          continue; // Skip this swap, try next one
        }
      }

      if (improved) break;
    }

    iteration++;
  }

  return route;
}

/**
 * Optimize routes for all drivers in sectors
 * Uses Mapbox Directions API for distance calculations
 * Supports VRPPD (Vehicle Routing Problem with Pickup and Delivery)
 */
export async function optimizeAllRoutes(
  sectors: Sector[]
): Promise<OptimizedRoute[]> {
  const optimizedRoutes: OptimizedRoute[] = [];

  for (const sector of sectors) {
    if (sector.orders.length === 0) {
      continue; // Skip empty sectors
    }

    // Stage 3a: Generate initial route using Mapbox-aware nearestNeighbor
    let route = await nearestNeighbor(sector.orders, sector.driverLocation);

    // Stage 3b: Improve with 2-Opt using Mapbox
    route = await twoOpt(route, 10);

    // Calculate metrics using Mapbox distances
    const totalDistance = await calculateRouteTotalDistance(route);
    const distancePerOrder =
      sector.orders.length > 0 ? totalDistance / sector.orders.length : 0;

    // Build stops array for VRPPD support
    // Currently represents pickup stops in order; future: will include delivery stops
    const stops: Stop[] = [];
    let cumulativeDistance = 0;

    for (let i = 1; i < route.length - 1; i++) {
      const location = route[i];
      const prevLocation = route[i - 1];

      // Calculate segment distance using Mapbox Directions API
      const result = await getDistance(prevLocation, location);
      const segmentDistance = result.distance_m;
      cumulativeDistance += segmentDistance;

      // Find the order for this location
      const order = sector.orders.find((o) => {
        const coords = o.pickupLocation?.coordinates || [0, 0];
        return (
          Math.abs(location.lat - coords[1]) < 0.0001 &&
          Math.abs(location.lng - coords[0]) < 0.0001
        );
      });

      if (order) {
        const cumulativeTimeMinutes = (cumulativeDistance / 1000) * (60 / 35); // 35 km/h average speed
        stops.push({
          orderId: order.id,
          type: "pickup",
          location,
          sequenceIndex: i,
          cumulativeDistance,
          cumulativeTime: cumulativeTimeMinutes,
        });
      }
    }

    // Validate precedence constraints (will be more important with batched deliveries)
    try {
      validatePickupBeforeDelivery(stops);
    } catch (error) {
      console.warn(
        `⚠️  Precedence validation warning for route ${sector.driverId}:`,
        error
      );
    }

    optimizedRoutes.push({
      driverId: sector.driverId,
      driverName: sector.driver.name,
      orders: sector.orders,
      sequence: route,
      stops,
      totalDistance,
      metrics: {
        orderCount: sector.orders.length,
        distancePerOrder,
      },
    });
  }

  return optimizedRoutes;
}

/**
 * ===================================================================
 * STAGE 4: TIME WINDOW GENERATION (NEW)
 * Generate optimal service time windows for each order in route
 * Uses algorithm from "Service Time Window Design in Last-Mile Delivery"
 * ===================================================================
 */

/**
 * Generate time windows for all orders in an optimized route
 * Enhanced with SAA (Sample Average Approximation) confidence scoring
 *
 * Algorithm (VRPPD + SAA-aware):
 * 1. Iterate through ALL stops (pickups + deliveries, not just orders)
 * 2. For each stop, calculate travel time from previous location using Mapbox
 * 3. Add service time (pickup=5min, delivery=3min)
 * 4. Calculate cumulative time from depot through all stops
 * 5. Generate time window bounds using SAA if observations available
 * 6. Calculate confidence scores and violation probabilities
 * 7. Validate pickup-before-delivery precedence constraint
 *
 * Reference: https://arxiv.org/html/2508.01032v1 (Proposition 2.4)
 */
async function generateTimeWindowsForRoute(
  route: OptimizedRoute
): Promise<(TimeWindowData | null)[]> {
  const timeWindows: (TimeWindowData | null)[] = [];
  let cumulativeTime = new Date(); // Start from now
  let cumulativeDistance = 0;

  console.log(
    `🕐 Generating time windows for ${route.driverName} (${route.stops.length} stops from ${route.orders.length} orders) using SAA-enhanced VRPPD calculation`
  );

  // Process each STOP in sequence (not just each order)
  // This supports batched delivery where multiple pickups precede deliveries
  for (let stopIdx = 0; stopIdx < route.stops.length; stopIdx++) {
    const stop = route.stops[stopIdx];
    const previousLocation =
      stopIdx === 0
        ? route.sequence[0]
        : route.sequence[route.stops[stopIdx - 1].sequenceIndex];
    const currentLocation = route.sequence[stop.sequenceIndex];

    try {
      // Calculate travel time using Mapbox API
      const result = await getDistance(previousLocation, currentLocation);
      const segmentDistance = result.distance_m;
      const segmentDuration = result.duration_s;

      // Service time depends on stop type
      // Pickup: ~5 minutes to load package
      // Delivery: ~3 minutes to unload package
      const serviceTimeMinutes = stop.type === "pickup" ? 5 : 3;

      // Update cumulative time (VRPPD: accumulates across all stops in sequence)
      cumulativeTime = new Date(
        cumulativeTime.getTime() +
          (segmentDuration + serviceTimeMinutes * 60) * 1000
      );
      cumulativeDistance += segmentDistance;

      // TODO: Fetch historical observations for this route segment
      // For now, use empty array which will trigger simple heuristic
      const observations: any[] = [];

      // Use timeWindowCalculator with SAA if observations available
      const params = {
        ...DEFAULT_TIME_WINDOW_PARAMS,
        // Use SAA method if we have enough observations (30+)
        method:
          observations.length >= 30 ? "stochastic_saa" : "simple_heuristic",
      } as any;

      const calculated: CalculatedTimeWindow =
        timeWindowCalculator.calculateTimeWindow(
          new Date(cumulativeTime),
          observations,
          params
        );

      // Calculate additional confidence metrics for draft scoring
      const confidence = calculateTimeWindowConfidence(calculated);

      // Convert CalculatedTimeWindow to TimeWindowData format for storage
      const timeWindowData: TimeWindowData = {
        lowerBound: calculated.lowerBound,
        upperBound: calculated.upperBound,
        expectedArrival: calculated.expectedArrival,
        windowWidthSeconds: calculated.windowWidthSeconds,
        confidenceLevel: calculated.confidenceLevel,
        violationProbability: calculated.violationProbability,
        penaltyWidth: params.penalties.width,
        penaltyEarly: params.penalties.early,
        penaltyLate: params.penalties.late,
        calculationMethod: calculated.method,
        sampleCount: calculated.sampleCount,
        travelTimeStdDev: calculated.travelTimeStdDev,
        coefficientOfVariation: calculated.coefficientOfVariation,
      };

      timeWindows.push(timeWindowData);

      console.log(
        `  ✓ Order ${stop.orderId} (${stop.type}): ` +
          `${calculated.lowerBound.toLocaleTimeString()} - ${calculated.upperBound.toLocaleTimeString()} ` +
          `(${(calculated.windowWidthSeconds / 60).toFixed(1)}min, ` +
          `confidence: ${(confidence * 100).toFixed(1)}%, ` +
          `method: ${calculated.method}, ` +
          `cumulative: ${Math.round(cumulativeDistance)}m)`
      );
    } catch (error) {
      console.error(
        `  ✗ Failed to generate time window for order ${stop.orderId}:`,
        error
      );
      // Push null to maintain index alignment with stops array
      timeWindows.push(null);
    }
  }

  // Validate precedence constraints (critical for VRPPD)
  try {
    validatePickupBeforeDelivery(route.stops);
    console.log(
      `  ✅ Precedence constraints validated: all deliveries after pickups`
    );
  } catch (error) {
    console.error(`  ❌ Precedence constraint error:`, error);
    throw error; // Fail fast on constraint violation
  }

  return timeWindows;
}

/**
 * Calculate overall confidence in a time window (0-1)
 * Based on SAA confidence scoring from paper
 *
 * Factors:
 * - Confidence level from calculation
 * - Sample size (if SAA used)
 * - Coefficient of variation (lower is more predictable)
 * - Window width (wider = more uncertainty)
 */
function calculateTimeWindowConfidence(
  calculated: CalculatedTimeWindow
): number {
  let confidence = calculated.confidenceLevel;

  // Adjust for sample size if SAA method used
  if (calculated.method === "stochastic_saa" && calculated.sampleCount) {
    // More samples = higher confidence
    // 30 samples = 0.9, 100+ samples = 1.0
    const sampleFactor = Math.min(calculated.sampleCount / 100, 1.0);
    confidence *= 0.9 + sampleFactor * 0.1;
  }

  // Adjust for coefficient of variation if available
  if (calculated.coefficientOfVariation !== undefined) {
    // Lower CV = more predictable = higher confidence
    // CV < 0.2 = excellent, CV > 0.5 = poor
    const cvPenalty = Math.min(calculated.coefficientOfVariation / 0.5, 1.0);
    confidence *= 1 - cvPenalty * 0.2; // Up to 20% penalty for high CV
  }

  // Adjust for window width
  // Wider windows = lower confidence in precise timing
  const windowMinutes = calculated.windowWidthSeconds / 60;
  if (windowMinutes > 30) {
    const widthPenalty = Math.min((windowMinutes - 30) / 30, 0.3);
    confidence *= 1 - widthPenalty;
  }

  return Math.max(0.5, Math.min(confidence, 1.0)); // Clamp to [0.5, 1.0]
}

/**
 * ===================================================================
 * HELPER: Calculate route total distance using Google Maps API
 * ===================================================================
 */

/**
 * Calculate total distance of a route using Google Maps API
 */
async function calculateRouteTotalDistance(route: Location[]): Promise<number> {
  if (route.length < 2) return 0;

  let total = 0;

  for (let i = 0; i < route.length - 1; i++) {
    // Use Google Maps to get actual road distance
    const result = await getDistance(route[i], route[i + 1]);
    total += result.distance_m;
  }

  return total;
}

/**
 * ===================================================================
 * PERSISTENCE: Save assignments to database
 * ===================================================================
 */

/**
 * Calculate accumulated travel TIME (using Mapbox duration) up to a specific index in route
 * Uses actual Mapbox driving durations instead of distance-based estimates
 */
async function calculateAccumulatedTime(
  sequence: Location[],
  upToIndex: number,
  baseTime: Date = new Date()
): Promise<Date> {
  if (upToIndex <= 0) return baseTime;

  let totalDurationSeconds = 0;
  for (let i = 0; i < upToIndex; i++) {
    const fromLoc = sequence[i];
    const toLoc = sequence[i + 1];
    const result = await getDistance(fromLoc, toLoc);
    totalDurationSeconds += result.duration_s; // Use Mapbox duration
  }

  // Return ETA by adding accumulated time to base time
  const eta = new Date(baseTime);
  eta.setSeconds(eta.getSeconds() + totalDurationSeconds);
  return eta;
}

/**
 * Calculate route total duration using Mapbox travel times
 */
async function calculateRouteTotalTime(route: Location[]): Promise<number> {
  if (route.length < 2) return 0;

  let totalSeconds = 0;

  for (let i = 0; i < route.length - 1; i++) {
    const result = await getDistance(route[i], route[i + 1]);
    totalSeconds += result.duration_s; // Use actual Mapbox duration
  }

  return totalSeconds;
}

/**
 * Build sequence mapping for orders in an optimized route
 * Returns a Map of orderId -> sequence index based on optimized waypoint order
 */
function buildOrderSequenceMap(
  orders: Order[],
  sequence: Location[]
): Map<string, number> {
  const orderPositions = new Map<string, number>();

  // The sequence array includes:
  // [0] = driver start location
  // [1..n-1] = order pickup locations (in optimized order)
  // [n] = driver end location (returns to start)

  for (
    let sequenceIndex = 1;
    sequenceIndex < sequence.length - 1;
    sequenceIndex++
  ) {
    const seqPoint = sequence[sequenceIndex];

    // Find the order that matches this sequence point by coordinates
    for (const order of orders) {
      // Extract lat/lng from PostGIS Point geometry
      const pickupCoords = order.pickupLocation?.coordinates || [0, 0];
      // Check if coordinates match within tolerance
      if (
        Math.abs(seqPoint.lat - pickupCoords[1]) < 0.0001 &&
        Math.abs(seqPoint.lng - pickupCoords[0]) < 0.0001
      ) {
        orderPositions.set(order.id, sequenceIndex);
        break;
      }
    }
  }

  return orderPositions;
}

/**
 * Save optimized route assignments to database
 * Creates OrderAssignment records for each order in each route
 * Uses OrderAssignmentService for proper business logic
 * Uses PostGIS for accurate distance calculations
 */
export async function saveAssignments(
  optimizedRoutes: OptimizedRoute[]
): Promise<number> {
  let totalSaved = 0;

  for (const route of optimizedRoutes) {
    // Build mapping of order IDs to their sequence positions
    const orderSequenceMap = buildOrderSequenceMap(
      route.orders,
      route.sequence
    );

    // Process each order in the route
    for (let i = 0; i < route.orders.length; i++) {
      const order = route.orders[i];
      const sequenceIndex = orderSequenceMap.get(order.id);

      // Skip if we couldn't find the order in the sequence (shouldn't happen)
      if (sequenceIndex === undefined) {
        console.warn(
          `⚠️  Order ${order.id} not found in optimized sequence for driver ${route.driverId}`
        );
        continue;
      }

      try {
        // Get time window data for this order (includes cumulative travel time from VRPPD generation)
        const timeWindowItem = route.timeWindows?.[i];
        const timeWindowData =
          timeWindowItem && timeWindowItem !== null
            ? timeWindowItem
            : undefined;

        // Use cumulative time window expected arrival if available (VRPPD-aware)
        // This reflects actual travel time considering movement between previous stops
        let estimatedPickup: Date;
        let estimatedDelivery: Date;

        if (timeWindowData) {
          // Use expected arrival from time window (already includes cumulative travel time)
          estimatedPickup = timeWindowData.expectedArrival;
          // Add delivery time: time window upper bound + small buffer
          estimatedDelivery = new Date(
            timeWindowData.upperBound.getTime() + 180000
          ); // +3 minutes

          console.log(
            `  📍 Order ${order.id}: pickup at ${estimatedPickup.toLocaleTimeString()} ` +
              `(cumulative from depot via ${i} previous stops)`
          );
        } else {
          // Fallback: Calculate using Mapbox travel durations if time window unavailable
          const baseTime = new Date();
          estimatedPickup = await calculateAccumulatedTime(
            route.sequence,
            sequenceIndex,
            baseTime
          );

          // Calculate delivery time by adding travel time from pickup to dropoff
          const pickupLocation = route.sequence[sequenceIndex];
          const dropoffLocation = order.dropoffLocation?.coordinates
            ? {
                lat: order.dropoffLocation.coordinates[1],
                lng: order.dropoffLocation.coordinates[0],
              }
            : pickupLocation;

          const pickupToDropoffDuration = await getDistance(
            pickupLocation,
            dropoffLocation
          );
          estimatedDelivery = new Date(
            estimatedPickup.getTime() +
              pickupToDropoffDuration.duration_s * 1000
          );

          console.warn(
            `  ⚠️  Order ${order.id}: using Mapbox duration-based estimation (time window unavailable)`
          );
        }

        // Use OrderAssignmentService which handles:
        // - Validation (order exists, is PENDING, not already assigned)
        // - Validation (driver exists)
        // - Order status update to ASSIGNED
        // - Driver status update if first order
        await orderAssignmentService.assignOrder({
          orderId: order.id,
          driverId: route.driverId,
          sequence: sequenceIndex,
          estimatedPickup,
          estimatedDelivery,
          timeWindow: timeWindowData,
        });

        totalSaved++;
      } catch (error) {
        console.error(
          `❌ Failed to assign order ${order.id} to driver ${route.driverId}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  console.log(`💾 Saved ${totalSaved} order assignments to database`);
  return totalSaved;
}

/**
 * ===================================================================
 * MAIN PIPELINE: Execute all three stages
 * ===================================================================
 */

/**
 * ===================================================================
 * BEST INSERTION ALGORITHM
 * Calculate optimal position to insert an order into existing route
 * ===================================================================
 */

export interface InsertionResult {
  cost: number; // Total route distance increase
  pickupIndex: number; // Where to insert pickup in sequence
  deliveryIndex: number; // Where to insert delivery in sequence
  pickupTime: Date;
  deliveryTime: Date;
  newTotalDistance: number;
}

/**
 * Calculate best insertion position for an order into a driver's current route
 * Uses VRPPD constraint: pickup must come before delivery
 */
/**
 * Calculate best insertion position for an order into a driver's current route
 * Uses VRPPD constraint: pickup must come before delivery
 *
 * @param order - Order to insert
 * @param currentRoute - Driver's existing stops
 * @param driverLocation - Driver's current GPS location (START of route)
 * @returns Best insertion with cost, positions, and ETAs
 */
export async function calculateBestInsertion(
  order: Order,
  currentRoute: Stop[],
  driverLocation: Location // NEW: driver's starting location
): Promise<InsertionResult> {
  const pickupCoords = order.pickupLocation?.coordinates || [0, 0];
  const dropoffCoords = order.dropoffLocation?.coordinates || [0, 0];

  const pickup: Stop = {
    orderId: order.id,
    type: "pickup",
    location: { lat: pickupCoords[1], lng: pickupCoords[0] },
    sequenceIndex: 0,
    cumulativeDistance: 0,
    cumulativeTime: 0,
  };

  const delivery: Stop = {
    orderId: order.id,
    type: "delivery",
    location: { lat: dropoffCoords[1], lng: dropoffCoords[0] },
    sequenceIndex: 0,
    cumulativeDistance: 0,
    cumulativeTime: 0,
  };

  let minCost = Infinity;
  let bestInsertion: InsertionResult | null = null;

  // ✅ FIX: Include driver's START location in route
  const currentLocations = [
    driverLocation, // Driver starts here (GPS location)
    ...currentRoute.map((stop) => stop.location),
  ];
  const baseTime = new Date();

  // Try all valid insertion positions
  // Constraint: pickup must come before delivery
  for (let i = 0; i <= currentRoute.length; i++) {
    for (let j = i + 1; j <= currentRoute.length + 1; j++) {
      // Build candidate route (insert pickup at i, delivery at j)
      const candidateStops: Stop[] = [
        ...currentRoute.slice(0, i),
        pickup,
        ...currentRoute.slice(i, j - 1),
        delivery,
        ...currentRoute.slice(j - 1),
      ];

      // Validate pickup/delivery constraint
      const pickupIdx = candidateStops.findIndex(
        (s) => s.orderId === order.id && s.type === "pickup"
      );
      const deliveryIdx = candidateStops.findIndex(
        (s) => s.orderId === order.id && s.type === "delivery"
      );

      if (pickupIdx >= deliveryIdx) continue; // Invalid: delivery before pickup

      // ✅ FIX: Build candidate locations INCLUDING driver start
      const candidateLocations = [
        driverLocation, // Driver starts here
        ...candidateStops.map((s) => s.location),
      ];

      // Calculate cost (total distance increase)
      const totalDistance =
        await calculateRouteTotalDistance(candidateLocations);
      const originalDistance =
        await calculateRouteTotalDistance(currentLocations);
      const cost = totalDistance - originalDistance;

      if (cost < minCost) {
        minCost = cost;

        // ✅ FIX: Calculate TIME estimates from driver location
        // pickupIdx in candidateStops maps to pickupIdx+1 in candidateLocations (due to driverLocation at index 0)
        const pickupETA = await calculateAccumulatedTime(
          candidateLocations,
          pickupIdx + 1, // +1 to account for driverLocation at index 0
          baseTime
        );
        const deliveryETA = await calculateAccumulatedTime(
          candidateLocations,
          deliveryIdx + 1, // +1 to account for driverLocation at index 0
          baseTime
        );

        bestInsertion = {
          cost,
          pickupIndex: i,
          deliveryIndex: j,
          pickupTime: pickupETA,
          deliveryTime: deliveryETA,
          newTotalDistance: totalDistance,
        };
      }
    }
  }

  if (!bestInsertion) {
    // Fallback: append at end
    const fallbackRoute = [
      driverLocation, // ✅ FIX: Start from driver location
      ...currentLocations.slice(1), // Existing stops (skip duplicate driverLocation)
      pickup.location,
      delivery.location,
    ];
    const totalDistance = await calculateRouteTotalDistance(fallbackRoute);

    // Calculate ETAs for fallback (includes travel time from driver location)
    const pickupETA = await calculateAccumulatedTime(
      fallbackRoute,
      currentRoute.length + 1, // +1 for driverLocation
      baseTime
    );
    const deliveryETA = await calculateAccumulatedTime(
      fallbackRoute,
      currentRoute.length + 2, // +2 for driverLocation + pickup
      baseTime
    );

    bestInsertion = {
      cost: 0,
      pickupIndex: currentRoute.length,
      deliveryIndex: currentRoute.length + 1,
      pickupTime: pickupETA,
      deliveryTime: deliveryETA,
      newTotalDistance: totalDistance,
    };
  }

  return bestInsertion;
}

/**
 * Get driver's current route (active assignments)
 */
export async function getDriverCurrentRoute(driverId: string): Promise<Stop[]> {
  const activeAssignments =
    await orderAssignmentService.getActiveAssignmentsForDriver(driverId);

  const stops: Stop[] = [];
  for (const assignment of activeAssignments) {
    if (!assignment.order) continue;

    const pickupCoords = assignment.order.pickupLocation?.coordinates || [0, 0];
    const dropoffCoords = assignment.order.dropoffLocation?.coordinates || [
      0, 0,
    ];

    stops.push({
      orderId: assignment.orderId,
      type: "pickup",
      location: { lat: pickupCoords[1], lng: pickupCoords[0] },
      sequenceIndex: assignment.sequence,
      cumulativeDistance: 0,
      cumulativeTime: 0,
    });

    stops.push({
      orderId: assignment.orderId,
      type: "delivery",
      location: { lat: dropoffCoords[1], lng: dropoffCoords[0] },
      sequenceIndex: assignment.sequence + 1,
      cumulativeDistance: 0,
      cumulativeTime: 0,
    });
  }

  return stops.sort((a, b) => a.sequenceIndex - b.sequenceIndex);
}

/**
 * ===================================================================
 * DRAFT → OFFER → WAIT → PROCESS WORKFLOW
 * Phase-based assignment with accept/reject lifecycle
 * ===================================================================
 */

export interface DraftResult {
  orderId: string;
  driverId: string;
  insertionCost: number;
  estimatedPickup: Date;
  estimatedDelivery: Date;
  sequence: number;
  priorityScore: number;
}

/**
 * PHASE 1: DRAFT (Region-Based with DraftMemory)
 * Calculate best assignments in-memory with priority sorting
 * Now uses PostGIS regions for efficient spatial filtering
 */
/**
 * PHASE 1: DRAFT (Region-Based with DraftMemory)
 * Calculate best assignments in-memory with priority sorting
 * Now uses PostGIS regions for efficient spatial filtering
 *
 * ✅ UPDATED: Records ALL driver-order combinations (not just best per order)
 * This aligns with draft guide: "check each driver to each orders in that region"
 */
export async function draftBestAssignments(
  offerRound: number
): Promise<DraftResult[]> {
  console.log(`\n🎯 DRAFT PHASE - Round ${offerRound}`);

  // Load pending orders and available drivers
  const pendingOrders = await getPendingOrders();
  const availableDrivers = await getAvailableDrivers();

  console.log(`  📋 ${pendingOrders.length} pending orders`);
  console.log(`  🚗 ${availableDrivers.length} available drivers`);

  if (pendingOrders.length === 0 || availableDrivers.length === 0) {
    console.log(`  ⚠️  No orders or drivers to process`);
    return [];
  }

  // STAGE 0: Region-based spatial filtering using PostGIS
  console.log(`\n  📍 STAGE 0: Region Splitting (PostGIS)...`);
  const regions = await RegionService.groupByRegion(
    pendingOrders,
    availableDrivers,
    50, // maxDistanceKm: 50km radius per region
    2 // minPointsPerCluster: at least 2 orders per cluster
  );

  console.log(`  ✅ Created ${regions.length} regions\n`);

  // Initialize DraftMemory for efficient draft management
  const draftMemory = new DraftMemory();

  // Track unassigned orders (for logging)
  const unassignedOrders: Order[] = [];

  // Process each region independently
  for (const region of regions) {
    console.log(
      `\n  🌍 Processing ${region.id}: ${region.orders.length} orders, ${region.drivers.length} drivers`
    );

    // Sort orders by priority within region
    const regionOrders = region.orders.sort(
      (a, b) => b.getPriorityScore() - a.getPriorityScore()
    );

    // ✅ NEW: Record ALL driver-order combinations per region
    for (const order of regionOrders) {
      // Filter out rejected drivers
      const eligibleDrivers = region.drivers.filter(
        (dw) => !order.rejectedDriverIds.includes(dw.driver.id)
      );

      if (eligibleDrivers.length === 0) {
        console.warn(
          `    ⚠️  No eligible drivers for order ${order.id} (priority: ${order.getPriorityScore().toFixed(1)})`
        );
        unassignedOrders.push(order);
        continue;
      }

      // ✅ CHANGED: Try ALL eligible drivers and record ALL combinations
      console.log(
        `    📝 Calculating drafts for order ${order.id} with ${eligibleDrivers.length} drivers...`
      );

      for (const dw of eligibleDrivers) {
        try {
          const currentRoute = await getDriverCurrentRoute(dw.driver.id);

          // ✅ FIX: Pass driver location (GPS coordinates)
          const insertion = await calculateBestInsertion(
            order,
            currentRoute,
            dw.location // Driver's current GPS location
          );

          // ✅ CHANGED: Record EVERY driver-order combination (not just best)
          const draft: DraftResult = {
            orderId: order.id,
            driverId: dw.driver.id,
            insertionCost: insertion.cost,
            estimatedPickup: insertion.pickupTime, // Now includes travel time from driver location
            estimatedDelivery: insertion.deliveryTime,
            sequence: insertion.pickupIndex,
            priorityScore: order.getPriorityScore(),
          };

          // Add to DraftMemory for intelligent scoring
          draftMemory.addDraft(dw.driver.id, draft);

          console.log(
            `      ✓ Draft recorded: Order ${order.id} → Driver ${dw.driver.id} ` +
              `(cost: ${insertion.cost.toFixed(0)}m, pickup: ${insertion.pickupTime.toLocaleTimeString()}, ` +
              `delivery: ${insertion.deliveryTime.toLocaleTimeString()})`
          );
        } catch (err) {
          console.error(
            `      ❌ Insertion failed for driver ${dw.driver.id}:`,
            err instanceof Error ? err.message : String(err)
          );
          // Continue to next driver - don't let one failure block others
        }
      }
    }
  }

  // Build driver capacity map
  const driverCapacities = new Map<string, number>();
  for (const dw of availableDrivers) {
    driverCapacities.set(dw.driver.id, dw.driver.maxOrders);
  }

  // Select best drafts across all regions using DraftMemory intelligence
  console.log(
    `\n  🧠 Selecting best assignments from ${draftMemory.getStats().totalDrafts} drafts...`
  );
  const selectedDrafts = draftMemory.selectBestDrafts(driverCapacities);

  // Print statistics
  const stats = draftMemory.getStats();
  console.log(
    `\n  📊 Draft Statistics:
    - Total Drafts Recorded: ${stats.totalDrafts}
    - Selected: ${selectedDrafts.length}
    - Unassigned Orders: ${unassignedOrders.length}
    - Drivers Used: ${new Set(selectedDrafts.map((d) => d.driverId)).size}
    - Avg Score: ${stats.avgScore.toFixed(3)}
    - Avg Confidence: ${(stats.avgConfidence * 100).toFixed(1)}%`
  );

  // Log unassigned orders for visibility
  if (unassignedOrders.length > 0) {
    console.warn(`\n  ⚠️  Unassigned Orders (${unassignedOrders.length}):`);
    for (const order of unassignedOrders) {
      console.warn(
        `    - Order ${order.id}: No eligible drivers in any region`
      );
    }
  }

  // Convert ScoredDraft[] back to DraftResult[]
  const drafts: DraftResult[] = selectedDrafts.map((sd) => ({
    orderId: sd.orderId,
    driverId: sd.driverId,
    insertionCost: sd.insertionCost,
    estimatedPickup: sd.estimatedPickup,
    estimatedDelivery: sd.estimatedDelivery,
    sequence: sd.sequence,
    priorityScore: sd.priorityScore,
  }));

  console.log(
    `\n✅ DRAFT COMPLETE: ${drafts.length} assignments planned (${stats.totalDrafts} combinations evaluated)`
  );
  return drafts;
}

/**
 * PHASE 2: OFFER
 * Persist draft assignments with OFFERED status
 */
export async function offerAssignments(
  drafts: DraftResult[],
  offerRound: number
): Promise<number> {
  console.log(`\n📤 OFFER PHASE - Persisting ${drafts.length} assignments`);

  let created = 0;
  for (const draft of drafts) {
    try {
      await orderAssignmentService.createOfferedAssignment(
        {
          orderId: draft.orderId,
          driverId: draft.driverId,
          estimatedPickup: draft.estimatedPickup,
          estimatedDelivery: draft.estimatedDelivery,
          sequence: draft.sequence,
        },
        offerRound
      );

      console.log(
        `  ✅ Offered: Order ${draft.orderId} → Driver ${draft.driverId}`
      );
      created++;
    } catch (err) {
      console.error(
        `  ❌ Failed to offer ${draft.orderId}:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  console.log(`\n✅ OFFER COMPLETE: ${created} assignments created`);
  return created;
}

/**
 * PHASE 3: WAIT
 * Wait for driver responses
 */
export async function waitForResponses(
  waitTimeMs: number = 3 * 60 * 1000
): Promise<void> {
  console.log(`\n⏳ WAIT PHASE - ${waitTimeMs / 1000}s response window`);
  await new Promise((resolve) => setTimeout(resolve, waitTimeMs));
}

/**
 * PHASE 4: PROCESS
 * Collect responses and expire stale offers
 */
export async function processResponses(): Promise<{
  accepted: number;
  rejected: number;
  expired: number;
}> {
  console.log(`\n📊 PROCESS PHASE - Collecting responses`);

  // Auto-expire stale offers
  const expired = await orderAssignmentService.expireStaleOffers();
  console.log(`  ⏱️  Expired: ${expired} stale offers`);

  // Count accepted/rejected
  const assignmentRepo = AppDataSource.getRepository(OrderAssignment);

  const accepted = await assignmentRepo.count({
    where: { status: AssignmentStatus.ACCEPTED },
  });

  const rejected = await assignmentRepo.count({
    where: { status: AssignmentStatus.REJECTED },
  });

  console.log(
    `\n✅ PROCESS COMPLETE: ${accepted} accepted, ${rejected} rejected, ${expired} expired`
  );

  return { accepted, rejected, expired };
}

/**
 * MAIN MATCHING CYCLE
 * Runs draft → offer → wait → process loop until all orders assigned
 */
/**
 * Get statistics about pending orders
 * Useful for monitoring continuous insertion flow
 */
export async function getPendingOrderStats(): Promise<{
  totalPending: number;
  rejectedOrders: number;
  avgPriorityBoost: number;
  topPriorityOrders: Array<{ id: string; priority: number; rejections: number }>;
}> {
  const pendingOrders = await getPendingOrders();
  const rejectedOrders = pendingOrders.filter((o) => o.rejectionCount > 0);

  const avgPriorityBoost =
    rejectedOrders.length > 0
      ? rejectedOrders.reduce((sum, o) => sum + (o.priorityMultiplier - 1), 0) /
        rejectedOrders.length
      : 0;

  const topPriorityOrders = pendingOrders
    .slice(0, 5)
    .map((o) => ({
      id: o.id,
      priority: o.getPriorityScore(),
      rejections: o.rejectionCount,
    }));

  return {
    totalPending: pendingOrders.length,
    rejectedOrders: rejectedOrders.length,
    avgPriorityBoost,
    topPriorityOrders,
  };
}

export async function runMatchingCycle(): Promise<void> {
  let offerRound = 1;
  const MAX_ROUNDS = 10; // Prevent infinite loops

  console.log(`\n🚀 ===== MATCHING CYCLE START =====`);

  while (offerRound <= MAX_ROUNDS) {
    console.log(`\n🔄 ===== ROUND ${offerRound} =====`);

    // PHASE 1: Draft
    // Includes PENDING orders (initial + rejected from previous rounds)
    // Filters out drivers in order.rejectedDriverIds[]
    const drafts = await draftBestAssignments(offerRound);

    if (drafts.length === 0) {
      console.log(`\n✅ All orders assigned or exhausted. Stopping.`);
      break;
    }

    // PHASE 2: Offer
    await offerAssignments(drafts, offerRound);

    // PHASE 3: Wait for driver responses
    console.log(`\n⏳ Waiting for driver responses (3 minutes)...`);
    await waitForResponses(3 * 60 * 1000);

    // PHASE 4: Process responses
    const { accepted, rejected, expired } = await processResponses();

    // Check if we need another round
    const needsReassignment = rejected + expired;
    
    if (needsReassignment === 0) {
      console.log(`\n✅ No rejections or expirations. All orders assigned.`);
      break;
    }

    // Continue to next round for rejected/expired orders
    console.log(
      `\n🔁 ${needsReassignment} orders need reassignment (rejected: ${rejected}, expired: ${expired})`
    );
    console.log(`   - Orders set to PENDING with boosted priority`);
    console.log(`   - Rejecting drivers excluded from next round`);

    offerRound++;
  }

  if (offerRound > MAX_ROUNDS) {
    console.warn(`\n⚠️  Reached maximum rounds (${MAX_ROUNDS}). Some orders may be unassigned.`);
  }

  console.log(`\n🏁 MATCHING CYCLE COMPLETE`);
}

/**
 * MAIN MATCHING FUNCTION: Region-Based with Draft→Offer→Accept Flow
 *
 * Integrates the complete redesigned matching engine:
 * - PostGIS region-based spatial filtering
 * - DraftMemory intelligent scoring
 * - Draft → Offer → Auto-accept flow (for testing)
 * - Time window validation with SAA
 * - Mapbox-only routing (no OSRM)
 *
 * Flow:
 * 1. Draft: Region-based matching with PostGIS + DraftMemory scoring
 * 2. Offer: Create OFFERED assignments in database
 * 3. Auto-accept: Simulate driver confirmation (testing mode)
 * 4. Result: ASSIGNED records ready for verification
 */
export async function matchOrders(
  autoAccept: boolean = true
): Promise<OptimizedRoute[]> {
  console.log(
    "🚀 Starting OPTIMIZED matching engine (Clarke-Wright + ALNS)..."
  );

  const MAX_ROUNDS = 5; // Limit iterations for rejected orders
  let round = 1;

  while (round <= MAX_ROUNDS) {
    console.log(`\n🔄 ===== MATCHING ROUND ${round} =====`);

    const orderRepo = AppDataSource.getRepository(Order);
    const driverRepo = AppDataSource.getRepository(Driver);

    // Get pending orders (includes rejected orders from previous rounds)
    const pendingOrders = await orderRepo.find({
      where: { status: OrderStatus.PENDING },
      order: { priority: "DESC", createdAt: "ASC" },
    });

    const availableDrivers = await driverRepo.find({
      where: [
        { status: DriverStatus.AVAILABLE },
        { status: DriverStatus.EN_ROUTE_PICKUP },
      ],
    });

    if (pendingOrders.length === 0) {
      console.log("✅ No pending orders to process");
      break;
    }

    if (availableDrivers.length === 0) {
      console.log("⚠️  No available drivers");
      break;
    }

    // PHASE 1: Generate optimized draft groups
    console.log("\n📍 PHASE 1: DRAFT OPTIMIZATION");
    console.log(
      `   Orders: ${pendingOrders.length}, Drivers: ${availableDrivers.length}`
    );

    // Show rejected orders info
    const rejectedOrders = pendingOrders.filter((o) => o.rejectionCount > 0);
    if (rejectedOrders.length > 0) {
      console.log(`   ⚠️  Rejected orders: ${rejectedOrders.length}`);
      for (const order of rejectedOrders) {
        console.log(
          `      - Order ${order.id}: ${order.rejectionCount} rejections, ` +
            `priority boost: +${((order.priorityMultiplier - 1) * 100).toFixed(0)}%, ` +
            `excluded drivers: ${order.rejectedDriverIds.length}`
        );
      }
    }

    const bestDraftGroup = await draftService.generateDraftGroups(
      pendingOrders,
      availableDrivers,
      3 // Generate 3 solutions
    );

    console.log(`✅ Best solution selected:`);
    console.log(`   Algorithm: ${bestDraftGroup.metadata.algorithm}`);
    console.log(
      `   Total time: ${bestDraftGroup.totalTravelTime.toFixed(2)} min`
    );
    console.log(
      `   Total distance: ${(bestDraftGroup.totalDistance / 1000).toFixed(2)} km`
    );
    console.log(`   Computation: ${bestDraftGroup.metadata.computationTimeMs}ms`);
    console.log(
      `   Quality: ${(bestDraftGroup.metadata.qualityScore * 100).toFixed(1)}%`
    );

    // PHASE 2: Convert draft assignments to OFFERED order assignments
    console.log("\n📍 PHASE 2: OFFER (Persist to OrderAssignment)");
    const offeredCount = await createOrderAssignmentsFromDraft(bestDraftGroup);
    console.log(`✅ Created ${offeredCount} OFFERED assignments`);

    if (offeredCount === 0) {
      console.log("⚠️  No offers created, stopping");
      break;
    }

    // PHASE 3: Auto-accept if enabled (for testing)
    if (autoAccept) {
      console.log("\n📍 PHASE 3: AUTO-ACCEPT (Simulate driver confirmation)");
      const acceptedCount = await autoAcceptAllOffers();
      console.log(`✅ Auto-accepted ${acceptedCount} offers → ASSIGNED`);

      // Check if any were rejected
      const rejectedCount = offeredCount - acceptedCount;
      if (rejectedCount > 0) {
        console.log(`🚫 Rejected: ${rejectedCount} orders`);
        console.log(`   - Orders set to PENDING with +20% priority boost`);
        console.log(`   - Will retry in next round`);
        round++;
        continue; // Go to next round for rejected orders
      }
    }

    // All accepted, we're done
    break;
  }

  if (round > MAX_ROUNDS) {
    console.warn(`\n⚠️  Reached maximum rounds (${MAX_ROUNDS}). Some orders may still be pending.`);
  }

  // Build OptimizedRoute[] response for API compatibility
  const routes = await buildRoutesFromAssignments(autoAccept);

  // Print summary
  console.log("\n📊 MATCHING SUMMARY:");
  let totalDistance = 0;
  for (const route of routes) {
    console.log(
      `   ${route.driverName}: ${route.metrics.orderCount} orders, ${Math.round(route.totalDistance)}m`
    );
    totalDistance += route.totalDistance;
  }
  console.log(`   TOTAL DISTANCE: ${Math.round(totalDistance)}m`);
  console.log(
    `   ASSIGNMENT STATUS: ${autoAccept ? AssignmentStatus.ACCEPTED : AssignmentStatus.OFFERED}`
  );
  console.log(
    `   ORDER STATUS: ${autoAccept ? OrderStatus.ASSIGNED : OrderStatus.OFFERED}`
  );

  return routes;
}

/**
 * Convert DraftAssignments to OrderAssignments (OFFERED status)
 */
async function createOrderAssignmentsFromDraft(
  draftGroup: DraftGroup
): Promise<number> {
  const assignments = draftGroup.assignments || [];
  let created = 0;

  for (const draftAssignment of assignments) {
    await orderAssignmentService.createOfferedAssignment(
      {
        orderId: draftAssignment.orderId,
        driverId: draftAssignment.driverId,
        sequence: draftAssignment.sequence,
        estimatedPickup: draftAssignment.estimatedPickupTime,
        estimatedDelivery: draftAssignment.estimatedDeliveryTime,
      },
      1 // offerRound
    );

    // Order status is now updated to OFFERED inside createOfferedAssignment (atomic transaction)
    created++;
  }

  return created;
}

/**
 * Build OptimizedRoute[] from database assignments
 * Groups assignments by driver and calculates route metrics
 */
async function buildRoutesFromAssignments(
  autoAccept: boolean
): Promise<OptimizedRoute[]> {
  const assignmentRepo = AppDataSource.getRepository(OrderAssignment);

  // Query using proper enum values
  const whereClause = autoAccept
    ? [
        { status: AssignmentStatus.ACCEPTED },
        { status: AssignmentStatus.COMPLETED },
      ]
    : { status: AssignmentStatus.OFFERED };

  const assignments = await assignmentRepo.find({
    where: whereClause,
    relations: ["driver", "order"],
    order: { driverId: "ASC", sequence: "ASC" },
  });

  // Group by driver
  const routesByDriver = new Map<string, OptimizedRoute>();

  for (const assignment of assignments) {
    if (!assignment.driver || !assignment.order) continue;

    const driverId = assignment.driverId;

    if (!routesByDriver.has(driverId)) {
      routesByDriver.set(driverId, {
        driverId,
        driverName: assignment.driver.name,
        orders: [],
        sequence: [],
        stops: [],
        totalDistance: 0,
        metrics: {
          orderCount: 0,
          distancePerOrder: 0,
        },
        timeWindows: [],
      });
    }

    const route = routesByDriver.get(driverId)!;
    route.orders.push(assignment.order);
    route.metrics.orderCount++;

    // Add pickup location to sequence
    const pickupCoords = assignment.order.pickupLocation?.coordinates || [0, 0];
    route.sequence.push({
      lat: pickupCoords[1],
      lng: pickupCoords[0],
    });
  }

  const routes = Array.from(routesByDriver.values());

  // Calculate total distance for each route
  for (const route of routes) {
    if (route.sequence.length > 1) {
      route.totalDistance = await calculateRouteTotalDistance(route.sequence);
      route.metrics.distancePerOrder =
        route.totalDistance / route.metrics.orderCount;
    }
  }

  return routes;
}

/**
 * Auto-accept all OFFERED assignments (for testing)
 * Simulates driver confirmation by converting OFFERED → ACCEPTED
 */
async function autoAcceptAllOffers(): Promise<number> {
  const assignmentRepo = AppDataSource.getRepository(OrderAssignment);

  // Find all OFFERED assignments
  const offeredAssignments = await assignmentRepo.find({
    where: { status: AssignmentStatus.OFFERED },
    relations: ["order"],
  });

  if (offeredAssignments.length === 0) return 0;

  let acceptedCount = 0;
  // Pick one random index to GUARANTEE acceptance (avoid 0 accept scenarios)
  const guaranteedIndex = Math.floor(Math.random() * offeredAssignments.length);

  for (let i = 0; i < offeredAssignments.length; i++) {
    const assignment = offeredAssignments[i];

    // Accept if it's the guaranteed one, OR random chance (e.g., 80% accept rate)
    const shouldAccept = i === guaranteedIndex || Math.random() > 0.2;

    if (shouldAccept) {
      try {
        await orderAssignmentService.acceptAssignment(assignment.id);
        console.log(
          `  ✅ Driver ${assignment.driverId} accepted order ${assignment.orderId}`
        );
        acceptedCount++;
      } catch (error) {
        console.error(
          `  ❌ Failed to accept assignment ${assignment.id}:`,
          error
        );
      }
    } else {
      try {
        await orderAssignmentService.rejectAssignment(
          assignment.id,
          "Simulated driver rejection"
        );
        console.log(
          `  🚫 Driver ${assignment.driverId} rejected order ${assignment.orderId} (Simulated)`
        );
      } catch (error) {
        console.error(
          `  ❌ Failed to reject assignment ${assignment.id}:`,
          error
        );
      }
    }
  }

  return acceptedCount;
}

/**
 * ===================================================================
 * HELPER FUNCTIONS
 * ===================================================================
 */

/**
 * Validate that delivery stops occur after pickup stops (precedence constraint)
 * Part of VRPPD implementation
 * @throws Error if precedence constraint violated
 */
function validatePickupBeforeDelivery(stops: Stop[]): void {
  const stopsByOrder = new Map<string, { pickup?: Stop; delivery?: Stop }>();

  // Group stops by order
  for (const stop of stops) {
    if (!stopsByOrder.has(stop.orderId)) {
      stopsByOrder.set(stop.orderId, {});
    }
    const orderStops = stopsByOrder.get(stop.orderId)!;
    if (stop.type === "pickup") {
      orderStops.pickup = stop;
    } else {
      orderStops.delivery = stop;
    }
  }

  // Validate precedence for each order
  for (const [orderId, { pickup, delivery }] of stopsByOrder.entries()) {
    if (pickup && delivery) {
      if (delivery.sequenceIndex <= pickup.sequenceIndex) {
        throw new Error(
          `Precedence constraint violated for order ${orderId}: ` +
            `delivery (seq ${delivery.sequenceIndex}) must occur after pickup (seq ${pickup.sequenceIndex})`
        );
      }
    }
  }
}
