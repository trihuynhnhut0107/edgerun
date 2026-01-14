import { AppDataSource } from "../../config/ormconfig";
import { Driver } from "../../entities/Driver";
import { DriverLocation } from "../../entities/DriverLocation";
import { OrderAssignment } from "../../entities/OrderAssignment";
import { DriverStatus } from "../../enums/DriverStatus";
import { Location } from "../../interfaces/Location";
import { DriverWithDistance } from "../../interfaces/Driver";
import { findDriversWithinRadius } from "../../services/geospatial/queries";
import { orderAssignmentService } from "../assignment/order-assignment.service";

export interface CreateDriverDTO {
  name: string;
  phone: string;
  vehicleType: string;
  maxOrders?: number;
  initialLocation?: Location;
}

export interface UpdateDriverLocationDTO {
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
}

/**
 * Individual stop in the route (pickup or delivery)
 */
export interface RouteStop {
  stopIndex: number;
  orderId: string;
  type: "pickup" | "delivery";
  lat: number;
  lng: number;
  address: string;
  distanceFromPrevious: number;
  durationFromPrevious: number;
  durationFromPreviousFormatted: string;
  estimatedArrival: Date;
  cumulativeDistance: number;
  cumulativeTime: number;
  cumulativeTimeFormatted: string;
}

/**
 * Route generation result
 */
export interface RouteGenerationResult {
  stops: RouteStop[];
  totalDistance: number;
  estimatedDuration: number;
  currentLoad: number;
}

/**
 * Route assignment information for an order
 */
export interface RouteAssignment {
  assignmentId: string;
  orderId: string;
  sequence: number;
  estimatedPickup: Date;
  estimatedDelivery: Date;
  actualPickup?: Date;
  actualDelivery?: Date;
  pickupLat: number;
  pickupLng: number;
  pickupAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  dropoffAddress: string;
  status: string;
}

/**
 * Complete driver route data
 */
export interface DriverRouteData {
  driverId: string;
  driverName: string;
  driverStatus: string;
  totalAssignments: number;
  totalStops: number;
  currentLoad: number;
  maxCapacity: number;
  assignments: RouteAssignment[];
  stops: RouteStop[];
  totalDistance: number;
  estimatedDuration: number;
}

export class DriverService {
  private driverRepo = AppDataSource.getRepository(Driver);
  private locationRepo = AppDataSource.getRepository(DriverLocation);
  private assignmentRepo = AppDataSource.getRepository(OrderAssignment);

  /**
   * Create a new driver
   */
  async createDriver(data: CreateDriverDTO): Promise<Driver> {
    const driver = this.driverRepo.create({
      name: data.name,
      phone: data.phone,
      vehicleType: data.vehicleType,
      maxOrders: data.maxOrders || 3,
      status: DriverStatus.OFFLINE,
    });

    const savedDriver = await this.driverRepo.save(driver);

    // Set initial location if provided
    if (data.initialLocation) {
      await this.updateDriverLocation(savedDriver.id, {
        lat: data.initialLocation.lat,
        lng: data.initialLocation.lng,
      });
    }

    return savedDriver;
  }

  /**
   * Get driver by ID
   */
  async getDriver(
    id: string,
    includeLocations = false
  ): Promise<Driver | null> {
    const relations = ["assignments"];
    if (includeLocations) {
      relations.push("locations");
    }

    return await this.driverRepo.findOne({
      where: { id },
      relations,
      order: includeLocations
        ? { locations: { timestamp: "DESC" } }
        : undefined,
    });
  }

  /**
   * Update driver location
   */
  async updateDriverLocation(
    driverId: string,
    locationData: UpdateDriverLocationDTO
  ): Promise<DriverLocation> {
    // Verify driver exists
    const driver = await this.driverRepo.findOne({ where: { id: driverId } });
    if (!driver) {
      throw new Error("Driver not found");
    }

    // Find existing location or create new one
    let location = await this.locationRepo.findOne({
      where: { driverId },
      order: { timestamp: "DESC" },
    });

    if (location) {
      // Update existing location
      location.location = {
        type: "Point",
        coordinates: [locationData.lng, locationData.lat], // GeoJSON order: [lng, lat]
      };
      location.heading = locationData.heading;
      location.speed = locationData.speed;
      location.timestamp = new Date();
    } else {
      // Create new location if none exists
      location = this.locationRepo.create({
        driverId,
        location: {
          type: "Point",
          coordinates: [locationData.lng, locationData.lat],
        },
        heading: locationData.heading,
        speed: locationData.speed,
        timestamp: new Date(),
      });
    }

    return await this.locationRepo.save(location);
  }

  /**
   * Update driver status
   */
  async updateDriverStatus(
    driverId: string,
    status: DriverStatus
  ): Promise<Driver> {
    const driver = await this.driverRepo.findOne({ where: { id: driverId } });
    if (!driver) {
      throw new Error("Driver not found");
    }

    driver.status = status;
    return await this.driverRepo.save(driver);
  }

  /**
   * Get available drivers within radius of a location
   */
  async getAvailableDriversNearLocation(
    location: Location,
    radiusMeters: number = 5000
  ): Promise<DriverWithDistance[]> {
    return await findDriversWithinRadius(location, radiusMeters, {
      status: [DriverStatus.AVAILABLE],
      limit: 50,
    });
  }

  /**
   * Get count of active orders for a driver
   */
  async getDriverActiveOrderCount(driverId: string): Promise<number> {
    const count = await this.assignmentRepo
      .createQueryBuilder("assignment")
      .innerJoin("assignment.order", "order")
      .where("assignment.driverId = :driverId", { driverId })
      .andWhere("order.status NOT IN (:...statuses)", {
        statuses: ["delivered", "cancelled"],
      })
      .getCount();

    return count;
  }

  /**
   * Check if driver can accept more orders
   */
  async canAcceptOrder(driverId: string): Promise<boolean> {
    const driver = await this.getDriver(driverId);
    if (!driver) {
      return false;
    }

    if (driver.status !== DriverStatus.AVAILABLE) {
      return false;
    }

    const activeOrderCount = await this.getDriverActiveOrderCount(driverId);
    return activeOrderCount < driver.maxOrders;
  }

  /**
   * Get all drivers (for admin/testing purposes)
   */
  async getAllDrivers(): Promise<Driver[]> {
    return await this.driverRepo.find({
      order: { createdAt: "DESC" },
    });
  }

  /**
   * Delete a driver
   */
  async deleteDriver(driverId: string): Promise<boolean> {
    const result = await this.driverRepo.delete(driverId);
    return result.affected ? result.affected > 0 : false;
  }

  /**
   * Get complete driver route data including assignments and optimized stops
   */
  async getDriverRouteData(driverId: string): Promise<DriverRouteData> {
    // Get driver with locations
    const driver = await this.getDriver(driverId, true);
    if (!driver) {
      throw new Error("Driver not found");
    }

    // Get all active assignments for this driver
    const assignments =
      await orderAssignmentService.getActiveAssignmentsForDriver(driverId);

    // Transform assignments to include order details
    const routeAssignments: RouteAssignment[] = assignments.map(
      (assignment) => {
        const pickupCoords = assignment.order?.pickupLocation?.coordinates || [
          0, 0,
        ];
        const dropoffCoords = assignment.order?.dropoffLocation
          ?.coordinates || [0, 0];

        return {
          assignmentId: assignment.id,
          orderId: assignment.orderId,
          sequence: assignment.sequence,
          estimatedPickup: assignment.estimatedPickup,
          estimatedDelivery: assignment.estimatedDelivery,
          actualPickup: assignment.actualPickup,
          actualDelivery: assignment.actualDelivery,
          pickupLat: pickupCoords[1],
          pickupLng: pickupCoords[0],
          pickupAddress: assignment.order?.pickupAddress || "",
          dropoffLat: dropoffCoords[1],
          dropoffLng: dropoffCoords[0],
          dropoffAddress: assignment.order?.dropoffAddress || "",
          status: assignment.order?.status || "",
        };
      }
    );

    // Get driver's latest location from the locations relationship
    const latestLocation = driver.locations?.[0]; // Already ordered by timestamp DESC
    const driverLocation = latestLocation?.location
      ? {
          lat: latestLocation.location.coordinates?.[1] || 0,
          lng: latestLocation.location.coordinates?.[0] || 0,
        }
      : undefined;

    const { stops, totalDistance, estimatedDuration, currentLoad } =
      await this.generateDriverRoute(
        assignments,
        driver.maxOrders,
        driverLocation
      );

    return {
      driverId: driver.id,
      driverName: driver.name,
      driverStatus: driver.status,
      totalAssignments: routeAssignments.length,
      totalStops: stops.length,
      currentLoad,
      maxCapacity: driver.maxOrders,
      assignments: routeAssignments,
      stops,
      totalDistance,
      estimatedDuration,
    };
  }

  /**
   * Generate optimized route for driver with VRPPD and capacity constraints
   * Uses nearest neighbor heuristic to minimize distance
   */
  async generateDriverRoute(
    assignments: any[],
    vehicleCapacity: number,
    driverLocation?: { lat: number; lng: number }
  ): Promise<RouteGenerationResult> {
    const stops: RouteStop[] = [];
    const completed = new Set<string>();
    const pickedUp = new Set<string>();
    let currentLoad = 0;
    let cumulativeDistance = 0;
    let cumulativeTime = 0;

    // Helper function to format seconds to human-readable time
    const formatDuration = (seconds: number): string => {
      if (seconds < 60) {
        return `${Math.round(seconds)} sec`;
      }

      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = Math.round(seconds % 60);

      const parts: string[] = [];
      if (hours > 0) parts.push(`${hours}h`);
      if (minutes > 0) parts.push(`${minutes}min`);
      if (secs > 0 && hours === 0) parts.push(`${secs}sec`);

      return parts.join(" ") || "0 sec";
    };

    // Create all possible stops
    interface PendingStop {
      orderId: string;
      type: "pickup" | "delivery";
      lat: number;
      lng: number;
      address: string;
    }

    const allStops: PendingStop[] = [];
    for (const assignment of assignments) {
      if (!assignment.order) continue;

      const pickupCoords = assignment.order.pickupLocation?.coordinates || [
        0, 0,
      ];
      const dropoffCoords = assignment.order.dropoffLocation?.coordinates || [
        0, 0,
      ];

      allStops.push({
        orderId: assignment.orderId,
        type: "pickup",
        lat: pickupCoords[1],
        lng: pickupCoords[0],
        address: assignment.order.pickupAddress || "",
      });

      allStops.push({
        orderId: assignment.orderId,
        type: "delivery",
        lat: dropoffCoords[1],
        lng: dropoffCoords[0],
        address: assignment.order.dropoffAddress || "",
      });
    }

    if (allStops.length === 0) {
      return {
        stops: [],
        totalDistance: 0,
        estimatedDuration: 0,
        currentLoad: 0,
      };
    }

    // Get starting location
    let currentLat = driverLocation?.lat || allStops[0].lat;
    let currentLng = driverLocation?.lng || allStops[0].lng;

    // Track current time for estimated arrivals (start from now)
    const startTime = new Date();
    let currentTime = startTime.getTime(); // milliseconds

    // Greedy nearest neighbor with VRPPD and capacity constraints
    while (stops.length < allStops.length) {
      let bestStop: PendingStop | null = null;
      let bestDistance = Infinity;

      for (const stop of allStops) {
        const key = `${stop.orderId}-${stop.type}`;

        // Skip if already completed
        if (completed.has(key)) continue;

        // VRPPD constraint: Can't deliver before pickup
        if (stop.type === "delivery" && !pickedUp.has(stop.orderId)) {
          continue;
        }

        // CAPACITY constraint: Can't pick up if at max capacity
        if (stop.type === "pickup" && currentLoad >= vehicleCapacity) {
          continue;
        }

        // Calculate straight-line distance (could use routing API for accuracy)
        const latDiff = stop.lat - currentLat;
        const lngDiff = stop.lng - currentLng;
        const distance =
          Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111000; // Rough meters

        if (distance < bestDistance) {
          bestDistance = distance;
          bestStop = stop;
        }
      }

      if (!bestStop) break; // No valid stop found

      // Calculate duration from previous stop (assume ~10 m/s average speed + 2 min service time)
      const segmentDuration = bestDistance / 10; // seconds for travel
      const serviceTime = 120; // 2 minutes service time per stop
      const totalSegmentTime =
        segmentDuration + (stops.length > 0 ? serviceTime : 0);

      // Add distance and time to cumulative
      cumulativeDistance += bestDistance;
      cumulativeTime += totalSegmentTime;
      currentTime += totalSegmentTime * 1000; // Convert to milliseconds

      // Add stop to sequence
      stops.push({
        stopIndex: stops.length,
        orderId: bestStop.orderId,
        type: bestStop.type,
        lat: bestStop.lat,
        lng: bestStop.lng,
        address: bestStop.address,
        distanceFromPrevious: bestDistance,
        durationFromPrevious: totalSegmentTime,
        durationFromPreviousFormatted: formatDuration(totalSegmentTime),
        estimatedArrival: new Date(currentTime),
        cumulativeDistance,
        cumulativeTime,
        cumulativeTimeFormatted: formatDuration(cumulativeTime),
      });

      completed.add(`${bestStop.orderId}-${bestStop.type}`);

      if (bestStop.type === "pickup") {
        pickedUp.add(bestStop.orderId);
        currentLoad++;
      } else {
        currentLoad--;
      }

      currentLat = bestStop.lat;
      currentLng = bestStop.lng;
    }

    // Calculate current load (orders picked up but not yet delivered)
    const finalLoad =
      pickedUp.size - stops.filter((s) => s.type === "delivery").length;

    return {
      stops,
      totalDistance: cumulativeDistance,
      estimatedDuration: cumulativeTime,
      currentLoad: finalLoad,
    };
  }
}

// Export singleton instance
export const driverService = new DriverService();
