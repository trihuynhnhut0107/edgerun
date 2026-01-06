import { AppDataSource } from '../../config/ormconfig';
import { OrderAssignment } from '../../entities/OrderAssignment';
import { Order } from '../../entities/Order';
import { Driver } from '../../entities/Driver';
import { OrderStatus } from '../../enums/OrderStatus';
import { DriverStatus } from '../../enums/DriverStatus';
import { AssignmentStatus } from '../../enums/AssignmentStatus';
import { LessThan } from 'typeorm';

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
      throw new Error('Order not found');
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new Error(`Order status must be PENDING, got: ${order.status}`);
    }

    // Verify driver exists and is available
    const driver = await this.driverRepo.findOne({ where: { id: data.driverId } });
    if (!driver) {
      throw new Error('Driver not found');
    }

    // Check if order is already assigned
    const existingAssignment = await this.assignmentRepo.findOne({
      where: { orderId: data.orderId },
    });
    if (existingAssignment) {
      throw new Error('Order is already assigned');
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

    // Update order status
    order.status = OrderStatus.ASSIGNED;
    await this.orderRepo.save(order);

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
      throw new Error('Order not found');
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
      throw new Error('Order already has pending offer');
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
      offerExpiresAt: new Date(Date.now() + 3 * 60 * 1000), // 3 minutes
      offerRound,
      assignedAt: new Date(),
    });

    // CRITICAL: Order stays PENDING until ACCEPTED
    // Do NOT update order.status or driver.status yet

    return await this.assignmentRepo.save(assignment);
  }

  /**
   * Accept an OFFERED assignment
   * Transitions to ACCEPTED and updates Order + Driver status
   */
  async acceptAssignment(assignmentId: string): Promise<OrderAssignment> {
    const assignment = await this.assignmentRepo.findOne({
      where: { id: assignmentId },
      relations: ['order', 'driver'],
    });

    if (!assignment) {
      throw new Error('Assignment not found');
    }

    // Validate state transition
    if (assignment.status !== AssignmentStatus.OFFERED) {
      throw new Error(`Cannot accept assignment with status: ${assignment.status}`);
    }

    // Check expiration
    if (assignment.offerExpiresAt && new Date() > assignment.offerExpiresAt) {
      throw new Error('Offer has expired');
    }

    // Atomic transition using transaction
    await this.assignmentRepo.manager.transaction(async (manager) => {
      // Update assignment
      assignment.status = AssignmentStatus.ACCEPTED;
      assignment.respondedAt = new Date();
      await manager.save(assignment);

      // Update order status
      if (assignment.order) {
        assignment.order.status = OrderStatus.ASSIGNED;
        await manager.save(assignment.order);
      }

      // Update driver status if this is their first order
      if (assignment.driver && assignment.driver.status === DriverStatus.AVAILABLE) {
        assignment.driver.status = DriverStatus.EN_ROUTE_PICKUP;
        await manager.save(assignment.driver);
      }
    });

    return assignment;
  }

  /**
   * Reject an OFFERED assignment
   * Updates order back to PENDING and adds driver to rejectedDriverIds
   */
  async rejectAssignment(
    assignmentId: string,
    reason?: string
  ): Promise<void> {
    const assignment = await this.assignmentRepo.findOne({
      where: { id: assignmentId },
      relations: ['order'],
    });

    if (!assignment) {
      throw new Error('Assignment not found');
    }

    if (assignment.status !== AssignmentStatus.OFFERED) {
      throw new Error(`Cannot reject assignment with status: ${assignment.status}`);
    }

    await this.assignmentRepo.manager.transaction(async (manager) => {
      // Update assignment
      assignment.status = AssignmentStatus.REJECTED;
      assignment.rejectionReason = reason || undefined;
      assignment.respondedAt = new Date();
      await manager.save(assignment);

      // Update order with priority boost
      if (assignment.order) {
        const order = assignment.order;
        order.rejectedDriverIds = [
          ...order.rejectedDriverIds,
          assignment.driverId,
        ];
        order.rejectionCount += 1;
        order.priorityMultiplier += 0.2; // +20% priority boost
        order.status = OrderStatus.PENDING; // Ready for re-draft
        await manager.save(order);
      }
    });
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
      relations: ['order'],
    });

    for (const assignment of expiredAssignments) {
      await this.assignmentRepo.manager.transaction(async (manager) => {
        // Mark as expired
        assignment.status = AssignmentStatus.EXPIRED;
        await manager.save(assignment);

        // Update order with priority boost
        if (assignment.order) {
          const order = assignment.order;
          order.rejectedDriverIds = [
            ...order.rejectedDriverIds,
            assignment.driverId,
          ];
          order.rejectionCount += 1;
          order.priorityMultiplier += 0.2; // +20% priority boost
          order.status = OrderStatus.PENDING;
          await manager.save(order);
        }
      });
    }

    return expiredAssignments.length;
  }

  /**
   * Unassign an order from a driver
   */
  async unassignOrder(orderId: string): Promise<void> {
    const assignment = await this.assignmentRepo.findOne({
      where: { orderId },
      relations: ['order'],
    });

    if (!assignment) {
      throw new Error('Assignment not found');
    }

    // Cannot unassign if order is already picked up
    if (assignment.order && assignment.order.status === OrderStatus.PICKED_UP) {
      throw new Error('Cannot unassign order that has been picked up');
    }

    // Update order status back to pending
    if (assignment.order) {
      assignment.order.status = OrderStatus.PENDING;
      await this.orderRepo.save(assignment.order);
    }

    // Delete assignment
    await this.assignmentRepo.delete(assignment.id);
  }

  /**
   * Get assignment for an order
   */
  async getAssignmentForOrder(orderId: string): Promise<OrderAssignment | null> {
    return await this.assignmentRepo.findOne({
      where: { orderId },
      relations: ['order', 'driver'],
    });
  }

  /**
   * Get all active assignments for a driver
   */
  async getActiveAssignmentsForDriver(driverId: string): Promise<OrderAssignment[]> {
    return await this.assignmentRepo
      .createQueryBuilder('assignment')
      .innerJoinAndSelect('assignment.order', 'order')
      .where('assignment.driverId = :driverId', { driverId })
      .andWhere('order.status NOT IN (:...statuses)', {
        statuses: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
      })
      .orderBy('assignment.sequence', 'ASC')
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
      relations: ['order'],
    });

    if (!assignment) {
      throw new Error('Assignment not found');
    }

    if (actualPickup) {
      assignment.actualPickup = actualPickup;
      if (assignment.order) {
        assignment.order.status = OrderStatus.PICKED_UP;
        await this.orderRepo.save(assignment.order);
      }
    }

    if (actualDelivery) {
      assignment.actualDelivery = actualDelivery;
      if (assignment.order) {
        assignment.order.status = OrderStatus.DELIVERED;
        await this.orderRepo.save(assignment.order);
      }
    }

    return await this.assignmentRepo.save(assignment);
  }

  /**
   * Get assignment with full details
   */
  async getAssignmentWithDetails(assignmentId: string): Promise<AssignmentDetails | null> {
    const assignment = await this.assignmentRepo.findOne({
      where: { id: assignmentId },
      relations: ['order', 'driver'],
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
      order: { assignedAt: 'DESC' },
      take: limit,
      relations: ['order', 'driver'],
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
    const assignments = await this.assignmentRepo.find({
      where: { driverId },
    });

    for (const item of orderSequence) {
      const assignment = assignments.find((a) => a.orderId === item.orderId);
      if (assignment) {
        assignment.sequence = item.sequence;
        await this.assignmentRepo.save(assignment);
      }
    }
  }
}

// Export singleton instance
export const orderAssignmentService = new OrderAssignmentService();
