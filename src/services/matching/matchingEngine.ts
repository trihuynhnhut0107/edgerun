/**
 * MATCHING ENGINE
 *
 * Optimized order-to-driver matching using Clarke-Wright + ALNS algorithms
 *
 * Main Flow:
 * 1. Draft: Generate optimized assignments using draftService (Clarke-Wright + ALNS)
 * 2. Offer: Persist as OFFERED assignments (order status -> OFFERED)
 * 3. Accept/Reject: Drivers respond via API (order status -> ASSIGNED or back to PENDING)
 *
 * Entry Point: matchOrders()
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
import { DraftAssignment } from "../../entities/DraftAssignment";

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
 * Creates OFFERED assignments that drivers can accept/reject via API
 *
 * @returns OptimizedRoute[] for API response
 */
export async function matchOrders(): Promise<OptimizedRoute[]> {
  const orderRepo = AppDataSource.getRepository(Order);
  const driverRepo = AppDataSource.getRepository(Driver);
  const draftAssignmentRepo = AppDataSource.getRepository(DraftAssignment);
  const draftGroupRepo = AppDataSource.getRepository(DraftGroup);

  // Clear previous draft data before generating new matches
  // Delete assignments first (child), then groups (parent) to respect FK constraints
  const allAssignments = await draftAssignmentRepo.find();
  if (allAssignments.length > 0) {
    await draftAssignmentRepo.remove(allAssignments);
  }
  const allGroups = await draftGroupRepo.find();
  if (allGroups.length > 0) {
    await draftGroupRepo.remove(allGroups);
  }

  const pendingOrders = await orderRepo.find({
    where: [{ status: OrderStatus.PENDING }, { status: OrderStatus.OFFERED }],
    order: { priority: "DESC", createdAt: "ASC" },
  });

  let availableDrivers = await driverRepo.find({
    where: [
      { status: DriverStatus.AVAILABLE },
      { status: DriverStatus.EN_ROUTE_PICKUP },
    ],
  });

  if (pendingOrders.length === 0 || availableDrivers.length === 0) {
    return [];
  }

  // Check if any orders have rejections
  const hasRejections = pendingOrders.some(
    (o) => o.rejectedDriverIds.length > 0
  );
  if (hasRejections) {
    console.log("\n⚠️  Rejection filtering active:");
    // Create filtered order list that only includes orders without all drivers rejected
    const validOrders = pendingOrders.filter((order) => {
      const rejectedCount = order.rejectedDriverIds.length;
      const availableCount = availableDrivers.filter(
        (d) => !order.rejectedDriverIds.includes(d.id)
      ).length;

      if (availableCount === 0) {
        console.log(
          `   ❌ Order ${order.id.slice(0, 8)}: All ${availableDrivers.length} drivers have rejected`
        );
        return false;
      }

      if (rejectedCount > 0) {
        console.log(
          `   🔄 Order ${order.id.slice(0, 8)}: ${rejectedCount} rejection(s), ${availableCount} driver(s) available`
        );
      }
      return true;
    });

    if (validOrders.length === 0) {
      console.log(
        "   ⚠️  No orders can be assigned (all drivers rejected all orders)\n"
      );
      return [];
    }
  }

  const bestDraftGroup = await draftService.generateDraftGroups(
    pendingOrders,
    availableDrivers,
    3
  );

  await createOrderAssignmentsFromDraft(bestDraftGroup);

  const routes = await buildRoutesFromAssignments();

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

  await assignmentRepo.update(
    { id: rejectedAssignment.id },
    {
      driverId: driverId,
      sequence: sequence,
      estimatedPickup: estimatedPickup,
      estimatedDelivery: estimatedDelivery,
      status: AssignmentStatus.OFFERED,
      offerRound: newOfferRound,
      offerExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      assignedAt: new Date(),
    }
  );

  await orderRepo.update(
    { id: rejectedAssignment.orderId },
    { status: OrderStatus.OFFERED }
  );
}

/**
 * Convert DraftAssignments to OrderAssignments (OFFERED status)
 * Updates order status: PENDING -> OFFERED (atomic transaction)
 * If a REJECTED assignment exists, updates it instead of creating new one
 */
async function createOrderAssignmentsFromDraft(
  draftGroup: DraftGroup
): Promise<number> {
  const assignments = draftGroup.assignments || [];
  const assignmentRepo = AppDataSource.getRepository(OrderAssignment);
  const orderRepo = AppDataSource.getRepository(Order);

  // Clear all OFFERED assignments before persisting new ones
  // This ensures route recalculation updates all sequences and travel times correctly
  const existingOffered = await assignmentRepo.find({
    where: { status: AssignmentStatus.OFFERED },
  });

  if (existingOffered.length > 0) {
    console.log(
      `🔄 Clearing ${existingOffered.length} existing OFFERED assignments for route recalculation`
    );

    // Update orders back to PENDING before deleting assignments
    for (const existing of existingOffered) {
      await orderRepo.update(
        { id: existing.orderId },
        { status: OrderStatus.PENDING }
      );
    }

    // Delete old assignments
    await assignmentRepo.remove(existingOffered);
  }

  let created = 0;

  for (const draftAssignment of assignments) {
    const orderId = draftAssignment.orderId || draftAssignment.order?.id;
    const driverId = draftAssignment.driverId || draftAssignment.driver?.id;

    if (!orderId || !driverId) {
      console.warn(
        `Skipping draft assignment with missing IDs: orderId=${orderId}, driverId=${driverId}`
      );
      continue;
    }

    // Validate that this driver hasn't rejected this order
    const order = await orderRepo.findOne({ where: { id: orderId } });
    if (order && order.rejectedDriverIds.includes(driverId)) {
      console.warn(
        `⚠️  Skipping assignment: Driver ${driverId.slice(0, 8)} previously rejected order ${orderId.slice(0, 8)}`
      );
      continue;
    }

    const rejectedAssignment = await assignmentRepo.findOne({
      where: {
        orderId: orderId,
        status: AssignmentStatus.REJECTED,
      },
    });

    if (rejectedAssignment) {
      await updateRejectedAssignment(
        rejectedAssignment,
        driverId,
        draftAssignment.sequence,
        draftAssignment.estimatedPickupTime,
        draftAssignment.estimatedDeliveryTime
      );
      created++;
    } else {
      await orderAssignmentService.createOfferedAssignment(
        {
          orderId,
          driverId,
          sequence: draftAssignment.sequence,
          estimatedPickup: draftAssignment.estimatedPickupTime,
          estimatedDelivery: draftAssignment.estimatedDeliveryTime,
        },
        1
      );
      created++;
    }
  }

  return created;
}

/**
 * Build OptimizedRoute[] from database assignments
 * Groups assignments by driver and reconstructs optimized stop sequences
 */
async function buildRoutesFromAssignments(): Promise<OptimizedRoute[]> {
  const assignmentRepo = AppDataSource.getRepository(OrderAssignment);

  const assignments = await assignmentRepo.find({
    where: { status: AssignmentStatus.OFFERED },
    relations: ["driver", "order"],
    order: { driverId: "ASC", sequence: "ASC" },
  });

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

  for (const [driverId, orders] of driverOrders) {
    const driver = driverInfo.get(driverId)!;

    const optimizedStops = await optimizeStopSequence(orders, driver.maxOrders);

    const stops: Stop[] = [];
    const sequence: Location[] = [];
    let cumulativeDistance = 0;
    let cumulativeTime = 0;

    for (let i = 0; i < optimizedStops.length; i++) {
      const stop = optimizedStops[i];

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

  let currentLocation =
    allStops.length > 0 ? allStops[0].location : { lat: 0, lng: 0 };

  while (stops.length < allStops.length) {
    let bestStop: (typeof allStops)[0] | null = null;
    let bestDistance = Infinity;

    for (const stop of allStops) {
      if (completed.has(`${stop.orderId}-${stop.type}`)) continue;

      if (stop.type === "delivery" && !pickedUp.has(stop.orderId)) {
        continue;
      }

      if (stop.type === "pickup" && currentLoad >= vehicleCapacity) {
        continue;
      }

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

    if (!bestStop) break;

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
