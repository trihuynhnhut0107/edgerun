/**
 * MATCHING ENGINE
 *
 * Optimized order-to-driver matching using Clarke-Wright + ALNS algorithms
 *
 * Main Flow:
 * 1. Draft: Generate optimized assignments using draftService (Clarke-Wright + ALNS)
 * 2. Offer: Persist as OFFERED assignments (order status → OFFERED)
 * 3. Accept/Reject: Drivers respond (order status → ASSIGNED or back to PENDING)
 * 4. Re-draft: Rejected orders get +20% priority boost and retry in next round
 *
 * Entry Point: matchOrders(autoAccept)
 */

import { AppDataSource } from "../../config/ormconfig";
import { Order } from "../../entities/Order";
import { Driver } from "../../entities/Driver";
import { OrderAssignment } from "../../entities/OrderAssignment";
import { OrderStatus } from "../../enums/OrderStatus";
import { DriverStatus } from "../../enums/DriverStatus";
import { AssignmentStatus } from "../../enums/AssignmentStatus";
import { Location } from "../../interfaces/Location";
import { distanceCacheService } from "../routing/distanceCacheService";
import { orderAssignmentService } from "../assignment/order-assignment.service";
import { draftService } from "./draftService";
import { DraftGroup } from "../../entities/DraftGroup";

/**
 * DriverWithLocation: Driver entity with current GPS location
 */
export interface DriverWithLocation {
  driver: Driver;
  location: Location;
}

/**
 * DraftResult: Temporary assignment calculation result
 * Used during draft phase before persisting to database
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
 * Stop: Represents a single stop in a route (pickup or delivery)
 * Part of VRPPD (Vehicle Routing Problem with Pickup and Delivery) implementation
 */
export interface Stop {
  orderId: string;
  type: "pickup" | "delivery";
  location: Location;
  sequenceIndex: number;
  cumulativeDistance: number;
  cumulativeTime: number;
}

/**
 * Route: Optimized sequence of locations for a driver
 * Supports batched delivery routing (VRPPD) with pickup/delivery stops
 */
export interface OptimizedRoute {
  driverId: string;
  driverName: string;
  orders: Order[];
  sequence: Location[];
  stops: Stop[];
  totalDistance: number;
  metrics: {
    orderCount: number;
    distancePerOrder: number;
  };
  timeWindows?: any[];
}

/**
 * ===================================================================
 * MAIN MATCHING FUNCTION
 * Entry point for order-to-driver matching
 * ===================================================================
 */

/**
 * Match pending orders to available drivers using Clarke-Wright + ALNS
 *
 * Multi-round matching with rejection handling:
 * - Round 1: Match all PENDING orders
 * - Round N: Re-match rejected orders (with +20% priority boost per rejection)
 * - Filters: Drivers in order.rejectedDriverIds[] are excluded
 *
 * @param autoAccept - If true, simulates driver responses (80% accept, 20% reject)
 * @returns OptimizedRoute[] for API response
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
      where: [{ status: OrderStatus.PENDING }, { status: OrderStatus.OFFERED }],
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
    console.log(
      `   Computation: ${bestDraftGroup.metadata.computationTimeMs}ms`
    );
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
    console.warn(
      `\n⚠️  Reached maximum rounds (${MAX_ROUNDS}). Some orders may still be pending.`
    );
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
 * ===================================================================
 * INTERNAL HELPER FUNCTIONS
 * ===================================================================
 */

/**
 * Update a REJECTED assignment with new draft data
 * Increments offerRound and transitions status back to OFFERED
 */
async function updateRejectedAssignment(
  rejectedAssignment: OrderAssignment,
  driverId: string,
  sequence: number,
  estimatedPickup: Date,
  estimatedDelivery: Date
): Promise<void> {
  const assignmentRepo = AppDataSource.getRepository(OrderAssignment);
  const orderRepo = AppDataSource.getRepository(Order);

  const newOfferRound = rejectedAssignment.offerRound + 1;

  // Update assignment with new driver and increment offerRound
  await assignmentRepo.update(
    { id: rejectedAssignment.id },
    {
      driverId: driverId,
      sequence: sequence,
      estimatedPickup: estimatedPickup,
      estimatedDelivery: estimatedDelivery,
      status: AssignmentStatus.OFFERED,
      offerRound: newOfferRound,
      offerExpiresAt: new Date(Date.now() + 10 * 60 * 1000), // Reset 10-minute expiry
      assignedAt: new Date(), // Update timestamp
    }
  );

  // Update order status back to OFFERED
  await orderRepo.update(
    { id: rejectedAssignment.orderId },
    { status: OrderStatus.OFFERED }
  );

  console.log(
    `  🔄 Updated REJECTED assignment for order ${rejectedAssignment.orderId}: ` +
      `driver ${rejectedAssignment.driverId} → ${driverId}, ` +
      `offerRound ${rejectedAssignment.offerRound} → ${newOfferRound}`
  );
}

/**
 * Convert DraftAssignments to OrderAssignments (OFFERED status)
 * Updates order status: PENDING → OFFERED (atomic transaction)
 * If a REJECTED assignment exists, updates it instead of creating new one
 */
async function createOrderAssignmentsFromDraft(
  draftGroup: DraftGroup
): Promise<number> {
  const assignments = draftGroup.assignments || [];
  const assignmentRepo = AppDataSource.getRepository(OrderAssignment);
  let created = 0;

  for (const draftAssignment of assignments) {
    // Use relation object ID as fallback - TypeORM may not populate scalar FK when loading relations
    const orderId = draftAssignment.orderId || draftAssignment.order?.id;
    const driverId = draftAssignment.driverId || draftAssignment.driver?.id;

    if (!orderId || !driverId) {
      console.error(
        `Missing IDs: orderId=${orderId}, driverId=${driverId}`,
        draftAssignment
      );
      continue;
    }

    // Check for existing REJECTED assignment
    const rejectedAssignment = await assignmentRepo.findOne({
      where: {
        orderId: orderId,
        status: AssignmentStatus.REJECTED,
      },
    });

    if (rejectedAssignment) {
      // Update existing REJECTED assignment with new draft data
      await updateRejectedAssignment(
        rejectedAssignment,
        driverId,
        draftAssignment.sequence,
        draftAssignment.estimatedPickupTime,
        draftAssignment.estimatedDeliveryTime
      );
      created++;
    } else {
      // Create new OFFERED assignment
      await orderAssignmentService.createOfferedAssignment(
        {
          orderId,
          driverId,
          sequence: draftAssignment.sequence,
          estimatedPickup: draftAssignment.estimatedPickupTime,
          estimatedDelivery: draftAssignment.estimatedDeliveryTime,
        },
        1 // offerRound
      );
      created++;
    }

    // Order status is now updated to OFFERED (atomic transaction)
  }

  return created;
}

/**
 * Build OptimizedRoute[] from database assignments
 * Groups assignments by driver and reconstructs optimized stop sequences
 */
async function buildRoutesFromAssignments(
  autoAccept: boolean
): Promise<OptimizedRoute[]> {
  const assignmentRepo = AppDataSource.getRepository(OrderAssignment);
  const driverRepo = AppDataSource.getRepository(Driver);

  // Query using proper enum values
  const whereClause = autoAccept
    ? [
        { status: AssignmentStatus.ACCEPTED },
        { status: AssignmentStatus.COMPLETED },
      ]
    : { status: AssignmentStatus.OFFERED };

  console.log(`🔍 buildRoutesFromAssignments DEBUG:`);
  console.log(`   autoAccept: ${autoAccept}`);
  console.log(`   whereClause:`, whereClause);

  const assignments = await assignmentRepo.find({
    where: whereClause,
    relations: ["driver", "order"],
    order: { driverId: "ASC", sequence: "ASC" },
  });

  console.log(`   Found ${assignments.length} assignments`);

  // Group by driver
  const routesByDriver = new Map<string, OptimizedRoute>();
  const driverOrders = new Map<string, Order[]>();
  const driverInfo = new Map<string, Driver>();

  for (const assignment of assignments) {
    if (!assignment.driver || !assignment.order) continue;

    const driverId = assignment.driverId;

    if (!driverOrders.has(driverId)) {
      driverOrders.set(driverId, []);
      driverInfo.set(driverId, assignment.driver);
    }

    driverOrders.get(driverId)!.push(assignment.order);
  }

  // Build optimized routes for each driver
  for (const [driverId, orders] of driverOrders) {
    const driver = driverInfo.get(driverId)!;

    // Reconstruct optimized stop sequence
    const optimizedStops = await optimizeStopSequence(orders, driver.maxOrders);

    // Build complete stop details with cumulative metrics
    const stops: Stop[] = [];
    const sequence: Location[] = [];
    let cumulativeDistance = 0;
    let cumulativeTime = 0;

    for (let i = 0; i < optimizedStops.length; i++) {
      const stop = optimizedStops[i];

      // Calculate distance from previous stop (with caching)
      if (i > 0) {
        const prevLocation = optimizedStops[i - 1].location;
        const result = await distanceCacheService.getDistanceWithCache(
          prevLocation,
          stop.location,
          "driving-traffic"
        );
        cumulativeDistance += result.distance;
        cumulativeTime += result.duration;
      }

      stops.push({
        orderId: stop.orderId,
        type: stop.type,
        location: stop.location,
        sequenceIndex: i,
        cumulativeDistance,
        cumulativeTime,
      });

      sequence.push(stop.location);
    }

    routesByDriver.set(driverId, {
      driverId,
      driverName: driver.name,
      orders,
      sequence,
      stops,
      totalDistance: cumulativeDistance,
      metrics: {
        orderCount: orders.length,
        distancePerOrder:
          orders.length > 0 ? cumulativeDistance / orders.length : 0,
      },
      timeWindows: [],
    });
  }

  const routes = Array.from(routesByDriver.values());

  return routes;
}

/**
 * Optimize stop sequence for a route
 * Uses same algorithm as solvers to ensure consistency
 */
async function optimizeStopSequence(
  orders: Order[],
  vehicleCapacity: number
): Promise<
  { orderId: string; type: "pickup" | "delivery"; location: Location }[]
> {
  const stops: {
    orderId: string;
    type: "pickup" | "delivery";
    location: Location;
  }[] = [];
  const completed = new Set<string>();
  const pickedUp = new Set<string>();
  let currentLoad = 0;

  // Create all stops
  const allStops: {
    orderId: string;
    type: "pickup" | "delivery";
    location: Location;
  }[] = [];
  for (const order of orders) {
    const pickupCoords = order.pickupLocation.coordinates;
    const dropoffCoords = order.dropoffLocation.coordinates;

    allStops.push({
      type: "pickup",
      orderId: order.id,
      location: { lat: pickupCoords[1], lng: pickupCoords[0] },
    });
    allStops.push({
      type: "delivery",
      orderId: order.id,
      location: { lat: dropoffCoords[1], lng: dropoffCoords[0] },
    });
  }

  // Start from first pickup location (could use depot/driver location)
  let currentLocation =
    allStops.length > 0 ? allStops[0].location : { lat: 0, lng: 0 };

  // Greedy nearest neighbor with VRPPD and capacity constraints
  while (stops.length < allStops.length) {
    let bestStop: (typeof allStops)[0] | null = null;
    let bestDistance = Infinity;

    for (const stop of allStops) {
      // Skip if already added
      if (completed.has(`${stop.orderId}-${stop.type}`)) continue;

      // VRPPD constraint: Can't deliver before pickup
      if (stop.type === "delivery" && !pickedUp.has(stop.orderId)) {
        continue;
      }

      // CAPACITY constraint: Can't pick up if at max capacity
      if (stop.type === "pickup" && currentLoad >= vehicleCapacity) {
        continue;
      }

      // Calculate distance from current location (with caching)
      const result = await distanceCacheService.getDistanceWithCache(
        currentLocation,
        stop.location,
        "driving-traffic"
      );

      if (result.distance < bestDistance) {
        bestDistance = result.distance;
        bestStop = stop;
      }
    }

    if (!bestStop) break; // No valid stop found

    // Add stop to sequence
    stops.push(bestStop);
    completed.add(`${bestStop.orderId}-${bestStop.type}`);

    if (bestStop.type === "pickup") {
      pickedUp.add(bestStop.orderId);
      currentLoad++;
    } else {
      currentLoad--;
    }

    currentLocation = bestStop.location;
  }

  return stops;
}

/**
 * Calculate total distance of a route using cached distances
 */
async function calculateRouteTotalDistance(route: Location[]): Promise<number> {
  if (route.length < 2) return 0;

  let total = 0;

  for (let i = 0; i < route.length - 1; i++) {
    const result = await distanceCacheService.getDistanceWithCache(
      route[i],
      route[i + 1],
      "driving-traffic"
    );
    total += result.distance;
  }

  return total;
}

/**
 * Auto-accept all OFFERED assignments (for testing)
 * Updates order status: OFFERED → ASSIGNED
 */
async function autoAcceptAllOffers(): Promise<number> {
  const assignmentRepo = AppDataSource.getRepository(OrderAssignment);

  // Find all OFFERED assignments
  const offeredAssignments = await assignmentRepo.find({
    where: { status: AssignmentStatus.OFFERED },
    relations: ["order"],
  });

  let acceptedCount = 0;

  for (const assignment of offeredAssignments) {
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
  }

  return acceptedCount;
}
