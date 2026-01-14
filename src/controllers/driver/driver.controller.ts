import {
  Controller,
  Post,
  Get,
  Patch,
  Route,
  Body,
  Path,
  Response,
  Tags,
} from "tsoa";
import {
  driverService,
  RouteStop,
  RouteAssignment,
  DriverRouteData,
} from "../../services/driver/driver.service";
import { orderAssignmentService } from "../../services/assignment/order-assignment.service";
import { DriverStatus } from "../../enums/DriverStatus";
import { CreateDriverRequest } from "../../dtos/driver/create-driver.request";
import { DriverResponse } from "../../dtos/driver/driver.response";
import { UpdateLocationRequest } from "../../dtos/driver/update-location.request";
import { UpdateStatusRequest } from "../../dtos/driver/update-status.request";
import { Point } from "geojson";

/**
 * Driver route response with optimized stop sequence
 */
interface DriverRouteResponse {
  driverId: string;
  driverName: string;
  driverStatus: string;
  totalAssignments: number;
  totalStops: number;
  currentLoad: number; // Current number of orders in vehicle
  maxCapacity: number; // Max concurrent orders
  assignments: RouteAssignment[];
  stops: RouteStop[]; // Optimized sequence of pickups and deliveries
  totalDistance: number;
  estimatedDuration: number;
}

@Route("drivers")
@Tags("Drivers")
export class DriverController extends Controller {
  @Post()
  @Response<DriverResponse>(201, "Driver created")
  async createDriver(
    @Body() body: CreateDriverRequest
  ): Promise<DriverResponse> {
    const driver = await driverService.createDriver({
      name: body.name,
      phone: body.phone,
      vehicleType: body.vehicleType,
      maxOrders: body.maxOrders,
      initialLocation: body.initialLocation,
    });

    this.setStatus(201);
    return {
      id: driver.id,
      name: driver.name,
      phone: driver.phone,
      vehicleType: driver.vehicleType,
      status: driver.status,
      maxOrders: driver.maxOrders,
    };
  }

  @Post("{id}/location")
  @Response<{ message: string }>(200, "Location updated")
  async updateLocation(
    @Path() id: string,
    @Body() body: UpdateLocationRequest
  ): Promise<{ message: string }> {
    try {
      await driverService.updateDriverLocation(id, {
        lat: body.lat,
        lng: body.lng,
        heading: body.heading,
        speed: body.speed,
      });
      return { message: "Location updated" };
    } catch (error) {
      this.setStatus(404);
      throw error;
    }
  }

  @Patch("{id}/status")
  @Response<DriverResponse>(200, "Status updated")
  async updateStatus(
    @Path() id: string,
    @Body() body: UpdateStatusRequest
  ): Promise<DriverResponse> {
    try {
      const driver = await driverService.updateDriverStatus(
        id,
        body.status as DriverStatus
      );

      return {
        id: driver.id,
        name: driver.name,
        phone: driver.phone,
        vehicleType: driver.vehicleType,
        status: driver.status,
        maxOrders: driver.maxOrders,
      };
    } catch (error) {
      this.setStatus(404);
      throw error;
    }
  }

  @Get("{id}")
  @Response<DriverResponse>(200, "Driver found")
  @Response<{ error: string }>(404, "Driver not found")
  async getDriver(@Path() id: string): Promise<DriverResponse> {
    const driver = await driverService.getDriver(id);

    if (!driver) {
      this.setStatus(404);
      throw new Error("Driver not found");
    }

    return {
      id: driver.id,
      name: driver.name,
      phone: driver.phone,
      vehicleType: driver.vehicleType,
      status: driver.status,
      maxOrders: driver.maxOrders,
    };
  }

  /**
   * Get offered assignments for a driver (pending response)
   * Returns all assignments with OFFERED status
   *
   * @param id Driver ID
   * @returns Array of offered assignments
   */
  @Get("{id}/assignments/offered")
  @Response<RouteAssignment[]>(200, "Offered assignments retrieved")
  @Response<{ error: string }>(404, "Driver not found")
  async getOfferedAssignments(@Path() id: string): Promise<RouteAssignment[]> {
    // Verify driver exists
    const driver = await driverService.getDriver(id);
    if (!driver) {
      this.setStatus(404);
      throw new Error("Driver not found");
    }

    // Get offered assignments
    const assignmentRepo = orderAssignmentService["assignmentRepo"];
    const assignments = await assignmentRepo.find({
      where: {
        driverId: id,
        status: "offered" as any,
      },
      relations: ["order"],
      order: { offerExpiresAt: "ASC" },
    });

    // Transform to route assignments
    return assignments.map((assignment) => {
      const pickupCoords = assignment.order?.pickupLocation?.coordinates || [
        0, 0,
      ];
      const dropoffCoords = assignment.order?.dropoffLocation?.coordinates || [
        0, 0,
      ];

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
        status: assignment.status,
      };
    });
  }

  /**
   * Accept an offered assignment
   *
   * @param id Assignment ID
   * @returns Success message with updated assignment
   */
  @Post("assignments/{id}/accept")
  @Response<{ success: boolean; message: string }>(200, "Assignment accepted")
  @Response<{ error: string }>(400, "Invalid state transition")
  @Response<{ error: string }>(404, "Assignment not found")
  async acceptAssignment(
    @Path() id: string
  ): Promise<{ success: boolean; message: string; assignment: any }> {
    try {
      const assignment = await orderAssignmentService.acceptAssignment(id);

      return {
        success: true,
        message: "Assignment accepted successfully",
        assignment: {
          id: assignment.id,
          orderId: assignment.orderId,
          driverId: assignment.driverId,
          status: assignment.status,
        },
      };
    } catch (error) {
      this.setStatus(400);
      throw error;
    }
  }

  /**
   * Reject an offered assignment
   *
   * @param id Assignment ID
   * @param body Rejection reason (optional)
   * @returns Success message
   */
  @Post("assignments/{id}/reject")
  @Response<{ success: boolean; message: string }>(200, "Assignment rejected")
  @Response<{ error: string }>(400, "Invalid state transition")
  @Response<{ error: string }>(404, "Assignment not found")
  async rejectAssignment(
    @Path() id: string,
    @Body() body?: { reason?: string }
  ): Promise<{ success: boolean; message: string }> {
    try {
      await orderAssignmentService.rejectAssignment(id, body?.reason);

      return {
        success: true,
        message: "Assignment rejected",
      };
    } catch (error) {
      this.setStatus(400);
      throw error;
    }
  }

  /**
   * Get the current delivery route for a driver
   * Returns optimized stop sequence (pickups & deliveries) respecting capacity constraints
   *
   * @param id Driver ID
   * @returns DriverRouteResponse with optimized stop sequence
   */
  @Get("{id}/route")
  @Response<DriverRouteResponse>(200, "Route retrieved successfully")
  @Response<{ error: string }>(404, "Driver not found")
  async getDriverRoute(@Path() id: string): Promise<DriverRouteResponse> {
    try {
      return await driverService.getDriverRouteData(id);
    } catch (error) {
      this.setStatus(404);
      throw error;
    }
  }
}
