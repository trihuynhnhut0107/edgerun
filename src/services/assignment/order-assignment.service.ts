import { AppDataSource } from "../../config/ormconfig";
import { OrderAssignment } from "../../entities/OrderAssignment";
import { Order } from "../../entities/Order";
import { Driver } from "../../entities/Driver";
import { OrderStatus } from "../../enums/OrderStatus";
import { DriverStatus } from "../../enums/DriverStatus";
import { AssignmentStatus } from "../../enums/AssignmentStatus";
import { LessThan } from "typeorm";
import { matchOrders } from "../matching/matchingEngine";
import {
  formatDuration,
  formatTime,
  formatTimeWindow,
} from "../../utils/formatters";

export interface TimeWindowData {
  lowerBound: Date;
  upperBound: Date;
  expectedArrival: Date;
  windowWidthSeconds: number;
  confidenceLevel: number;
  violationProbability: number;
  penaltyWidth: number;
  penaltyEarly: number;
  penaltyLate: number;
  calculationMethod: string;
  sampleCount?: number;
  travelTimeStdDev?: number;
  coefficientOfVariation?: number;
}

export interface CreateAssignmentDTO {
  orderId: string;
  driverId: string;
  sequence: number;
  estimatedPickup: Date;
  estimatedDelivery: Date;
  timeWindow?: TimeWindowData;
}

export interface AssignmentDetails {
  id: string;
  orderId: string;
  driverId: string;
  sequence: number;
  estimatedPickup: Date;
  estimatedDelivery: Date;
  actualPickup?: Date;
  actualDelivery?: Date;
  assignedAt: Date;
  order?: Order;
  driver?: Driver;
}

export class OrderAssignmentService {
  private assignmentRepo = AppDataSource.getRepository(OrderAssignment);
  private orderRepo = AppDataSource.getRepository(Order);
  private driverRepo = AppDataSource.getRepository(Driver);

  /**
   * Assign an order to a driver
   */
  async assignOrder(data: CreateAssignmentDTO): Promise<OrderAssignment> {
    // Verify order exists and is pending
    const order = await this.orderRepo.findOne({ where: { id: data.orderId } });
    if (!order) {
      throw new Error("Order not found");
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new Error(`Order status must be PENDING, got: ${order.status}`);
    }

    // Verify driver exists and is available
    const driver = await this.driverRepo.findOne({
      where: { id: data.driverId },
    });
    if (!driver) {
      throw new Error("Driver not found");
    }

    // Check if order is already assigned
    const existingAssignment = await this.assignmentRepo.findOne({
      where: { orderId: data.orderId },
    });
    if (existingAssignment) {
      throw new Error("Order is already assigned");
    }

    // Create assignment
    const assignment = this.assignmentRepo.create({
      orderId: data.orderId,
      driverId: data.driverId,
      sequence: data.sequence,
      estimatedPickup: data.estimatedPickup,
      estimatedDelivery: data.estimatedDelivery,
      timeWindow: data.timeWindow || undefined,
      assignedAt: new Date(),
    });

    const savedAssignment = await this.assignmentRepo.save(assignment);

    // Update order status - use .update() to avoid cascading to eager-loaded assignment
    await this.orderRepo.update(
      { id: data.orderId },
      { status: OrderStatus.ASSIGNED }
    );

    // Update driver status if this is their first order
    if (driver.status === DriverStatus.AVAILABLE) {
      driver.status = DriverStatus.EN_ROUTE_PICKUP;
      await this.driverRepo.save(driver);
    }

    return savedAssignment;
  }

  /**
   * Create an OFFERED assignment (draft state)
   * This does NOT update Order status or Driver status yet
   */
  async createOfferedAssignment(
    data: CreateAssignmentDTO,
    offerRound: number
  ): Promise<OrderAssignment> {
    // Verify order exists and is PENDING
    const order = await this.orderRepo.findOne({ where: { id: data.orderId } });
    if (!order) {
      throw new Error("Order not found");
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new Error(`Order must be PENDING, got: ${order.status}`);
    }

    // Check for existing OFFERED assignment (prevent duplicates in same round)
    const existingOffer = await this.assignmentRepo.findOne({
      where: {
        orderId: data.orderId,
        status: AssignmentStatus.OFFERED,
      },
    });
    if (existingOffer) {
      throw new Error("Order already has pending offer");
    }

    // Create OFFERED assignment with 3-minute expiry
    const assignment = this.assignmentRepo.create({
      orderId: data.orderId,
      driverId: data.driverId,
      sequence: data.sequence,
      estimatedPickup: data.estimatedPickup,
      estimatedDelivery: data.estimatedDelivery,
      timeWindow: data.timeWindow || undefined,
      status: AssignmentStatus.OFFERED,
      offerExpiresAt: new Date(Date.now() + 10 * 60 * 1000), // 3 minutes
      offerRound,
      assignedAt: new Date(),
    });

    const savedAssignment = await this.assignmentRepo.save(assignment);

    // Update order status to OFFERED - use .update() to avoid cascading to eager-loaded assignment
    await this.orderRepo.update(
      { id: data.orderId },
      { status: OrderStatus.OFFERED }
    );

    return savedAssignment;
  }

  /**
   * Accept an OFFERED assignment
   * Transitions to ACCEPTED and updates Order + Driver status
   */
  async acceptAssignment(assignmentId: string): Promise<OrderAssignment> {
    const assignment = await this.assignmentRepo.findOne({
      where: { id: assignmentId },
      relations: ["order", "driver"],
    });

    if (!assignment) {
      throw new Error("Assignment not found");
    }

    // Validate state transition
    if (assignment.status !== AssignmentStatus.OFFERED) {
      throw new Error(
        `Cannot accept assignment with status: ${assignment.status}`
      );
    }

    // Check expiration
    if (assignment.offerExpiresAt && new Date() > assignment.offerExpiresAt) {
      throw new Error("Offer has expired");
    }

    // Update assignment - use .update() to avoid null FK constraint issues
    await this.assignmentRepo.update(
      { id: assignmentId },
      {
        status: AssignmentStatus.ACCEPTED,
        respondedAt: new Date(),
      }
    );

    // Update order status - use .update() to avoid cascading to eager-loaded assignment
    if (assignment.order) {
      await this.orderRepo.update(
        { id: assignment.order.id },
        { status: OrderStatus.ASSIGNED }
      );
    }

    // Update driver status if this is their first order
    if (
      assignment.driver &&
      assignment.driver.status === DriverStatus.AVAILABLE
    ) {
      assignment.driver.status = DriverStatus.EN_ROUTE_PICKUP;
      await this.driverRepo.save(assignment.driver);
    }

    return assignment;
  }

  /**
   * Reject an OFFERED assignment
   * Updates order back to PENDING and adds driver to rejectedDriverIds
   * Automatically triggers matching to find alternative driver
   */
  async rejectAssignment(assignmentId: string, reason?: string): Promise<void> {
    const assignment = await this.assignmentRepo.findOne({
      where: { id: assignmentId },
      relations: ["order"],
    });

    if (!assignment) {
      throw new Error("Assignment not found");
    }

    if (assignment.status !== AssignmentStatus.OFFERED) {
      throw new Error(
        `Cannot reject assignment with status: ${assignment.status}`
      );
    }

    // Update assignment - use .update() to avoid null FK constraint issues
    await this.assignmentRepo.update(
      { id: assignmentId },
      {
        status: AssignmentStatus.REJECTED,
        rejectionReason: reason || undefined,
        respondedAt: new Date(),
      }
    );

    // Update order with priority boost - use .update() to avoid cascading to eager-loaded assignment
    if (assignment.order) {
      const order = assignment.order;
      await this.orderRepo.update(
        { id: order.id },
        {
          rejectedDriverIds: [...order.rejectedDriverIds, assignment.driverId],
          rejectionCount: order.rejectionCount + 1,
          priorityMultiplier: order.priorityMultiplier + 0.2,
          status: OrderStatus.PENDING,
        }
      );

      // Trigger matching engine to reassign the rejected order
      // Run asynchronously without blocking the response
      await matchOrders().catch(() => {});
    }
  }

  /**
   * Auto-expire stale OFFERED assignments
   * Returns count of expired assignments
   */
  async expireStaleOffers(): Promise<number> {
    const expiredAssignments = await this.assignmentRepo.find({
      where: {
        status: AssignmentStatus.OFFERED,
        offerExpiresAt: LessThan(new Date()),
      },
      relations: ["order"],
    });

    for (const assignment of expiredAssignments) {
      // Mark as expired - use .update() to avoid null FK constraint issues
      await this.assignmentRepo.update(
        { id: assignment.id },
        { status: AssignmentStatus.EXPIRED }
      );

      // Update order with priority boost - use .update() to avoid cascading to eager-loaded assignment
      if (assignment.order) {
        const order = assignment.order;
        await this.orderRepo.update(
          { id: order.id },
          {
            rejectedDriverIds: [
              ...order.rejectedDriverIds,
              assignment.driverId,
            ],
            rejectionCount: order.rejectionCount + 1,
            priorityMultiplier: order.priorityMultiplier + 0.2,
            status: OrderStatus.PENDING,
          }
        );
      }
    }

    return expiredAssignments.length;
  }

  /**
   * Unassign an order from a driver
   */
  async unassignOrder(orderId: string): Promise<void> {
    const assignment = await this.assignmentRepo.findOne({
      where: { orderId },
      relations: ["order"],
    });

    if (!assignment) {
      throw new Error("Assignment not found");
    }

    // Cannot unassign if order is already picked up
    if (assignment.order && assignment.order.status === OrderStatus.PICKED_UP) {
      throw new Error("Cannot unassign order that has been picked up");
    }

    // Update order status back to pending - use .update() to avoid cascading to eager-loaded assignment
    if (assignment.order) {
      await this.orderRepo.update(
        { id: assignment.order.id },
        { status: OrderStatus.PENDING }
      );
    }

    // Delete assignment
    await this.assignmentRepo.delete(assignment.id);
  }

  /**
   * Get assignment for an order
   */
  async getAssignmentForOrder(
    orderId: string
  ): Promise<OrderAssignment | null> {
    return await this.assignmentRepo.findOne({
      where: { orderId },
      relations: ["order", "driver"],
    });
  }

  /**
   * Get all active assignments for a driver
   */
  async getActiveAssignmentsForDriver(
    driverId: string
  ): Promise<OrderAssignment[]> {
    return await this.assignmentRepo
      .createQueryBuilder("assignment")
      .innerJoinAndSelect("assignment.order", "order")
      .where("assignment.driverId = :driverId", { driverId })
      .andWhere("order.status NOT IN (:...statuses)", {
        statuses: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
      })
      .orderBy("assignment.sequence", "ASC")
      .getMany();
  }

  /**
   * Update actual pickup/delivery times
   */
  async updateActuals(
    assignmentId: string,
    actualPickup?: Date,
    actualDelivery?: Date
  ): Promise<OrderAssignment> {
    const assignment = await this.assignmentRepo.findOne({
      where: { id: assignmentId },
      relations: ["order"],
    });

    if (!assignment) {
      throw new Error("Assignment not found");
    }

    if (actualPickup) {
      await this.assignmentRepo.update({ id: assignmentId }, { actualPickup });
      if (assignment.order) {
        await this.orderRepo.update(
          { id: assignment.order.id },
          { status: OrderStatus.PICKED_UP }
        );
      }
    }

    if (actualDelivery) {
      await this.assignmentRepo.update(
        { id: assignmentId },
        { actualDelivery }
      );
      if (assignment.order) {
        await this.orderRepo.update(
          { id: assignment.order.id },
          { status: OrderStatus.DELIVERED }
        );
      }
    }

    // Reload to return updated entity
    const updated = await this.assignmentRepo.findOne({
      where: { id: assignmentId },
      relations: ["order"],
    });
    return updated!;
  }

  /**
   * Get assignment with full details
   */
  async getAssignmentWithDetails(
    assignmentId: string
  ): Promise<AssignmentDetails | null> {
    const assignment = await this.assignmentRepo.findOne({
      where: { id: assignmentId },
      relations: ["order", "driver"],
    });

    if (!assignment) {
      return null;
    }

    return {
      id: assignment.id,
      orderId: assignment.orderId,
      driverId: assignment.driverId,
      sequence: assignment.sequence,
      estimatedPickup: assignment.estimatedPickup,
      estimatedDelivery: assignment.estimatedDelivery,
      actualPickup: assignment.actualPickup,
      actualDelivery: assignment.actualDelivery,
      assignedAt: assignment.assignedAt,
      order: assignment.order,
      driver: assignment.driver,
    };
  }

  /**
   * Get all assignments (for admin/testing purposes)
   */
  async getAllAssignments(limit: number = 100): Promise<OrderAssignment[]> {
    return await this.assignmentRepo.find({
      order: { assignedAt: "DESC" },
      take: limit,
      relations: ["order", "driver"],
    });
  }

  /**
   * Recalculate sequence for driver's orders
   * This should be called after route optimization
   */
  async updateSequences(
    driverId: string,
    orderSequence: { orderId: string; sequence: number }[]
  ): Promise<void> {
    for (const item of orderSequence) {
      await this.assignmentRepo.update(
        { driverId, orderId: item.orderId },
        { sequence: item.sequence }
      );
    }
  }

  /**
   * Accept all OFFERED assignments at once (testing utility)
   * Returns count of accepted assignments
   */
  async acceptAllAssignments(): Promise<number> {
    const offeredAssignments = await this.assignmentRepo.find({
      where: { status: AssignmentStatus.OFFERED },
      relations: ["order", "driver"],
    });

    let acceptedCount = 0;

    for (const assignment of offeredAssignments) {
      try {
        await this.acceptAssignment(assignment.id);
        console.log(
          `✅ Accepted assignment ${assignment.id} (Order: ${assignment.orderId}, Driver: ${assignment.driverId})`
        );
        acceptedCount++;
      } catch (error) {
        console.error(
          `❌ Failed to accept assignment ${assignment.id}:`,
          error instanceof Error ? error.message : error
        );
      }
    }

    console.log(
      `\n📊 Total accepted: ${acceptedCount}/${offeredAssignments.length}`
    );
    return acceptedCount;
  }

  /**
   * Reject all OFFERED assignments at once (testing utility)
   * Returns count of rejected assignments
   */
  async rejectAllAssignments(
    reason: string = "Bulk rejection for testing"
  ): Promise<number> {
    const offeredAssignments = await this.assignmentRepo.find({
      where: { status: AssignmentStatus.OFFERED },
      relations: ["order"],
    });

    let rejectedCount = 0;

    for (const assignment of offeredAssignments) {
      try {
        await this.rejectAssignment(assignment.id, reason);
        console.log(
          `🚫 Rejected assignment ${assignment.id} (Order: ${assignment.orderId}, Driver: ${assignment.driverId})`
        );
        rejectedCount++;
      } catch (error) {
        console.error(
          `❌ Failed to reject assignment ${assignment.id}:`,
          error instanceof Error ? error.message : error
        );
      }
    }

    console.log(
      `\n📊 Total rejected: ${rejectedCount}/${offeredAssignments.length}`
    );
    return rejectedCount;
  }
}

// Export singleton instance
export const orderAssignmentService = new OrderAssignmentService();
