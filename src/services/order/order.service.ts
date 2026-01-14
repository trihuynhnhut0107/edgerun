import { AppDataSource } from "../../config/ormconfig";
import { Order } from "../../entities/Order";
import { OrderAssignment } from "../../entities/OrderAssignment";
import { Customer } from "../../entities/Customer";
import { OrderStatus } from "../../enums/OrderStatus";
import { distanceCacheService } from "../routing/distanceCacheService";
import { matchOrders } from "../matching/matchingEngine";

export interface CreateOrderDTO {
  pickupLat: number;
  pickupLng: number;
  pickupAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  dropoffAddress: string;
  requestedDeliveryDate: Date;
  preferredTimeSlot?: string;
  priority?: number;
  value?: number;
  customerId?: string;
}

export class OrderService {
  private orderRepo = AppDataSource.getRepository(Order);
  private assignmentRepo = AppDataSource.getRepository(OrderAssignment);
  private customerRepo = AppDataSource.getRepository(Customer);

  /**
   * Create a new order with distance calculation and caching
   */
  async createOrder(data: CreateOrderDTO): Promise<Order> {
    // Validate customer if provided
    if (data.customerId) {
      const customer = await this.customerRepo.findOne({
        where: { id: data.customerId },
      });
      if (!customer) {
        throw new Error("Customer not found");
      }
    }

    // Calculate and cache distance between pickup and dropoff
    let estimatedDistance: number | undefined;
    let estimatedDuration: number | undefined;

    try {
      const distanceResult = await distanceCacheService.getDistanceWithCache(
        { lat: data.pickupLat, lng: data.pickupLng },
        { lat: data.dropoffLat, lng: data.dropoffLng },
        "driving-traffic"
      );
      estimatedDistance = distanceResult.distance;
      estimatedDuration = distanceResult.duration;
    } catch (error) {
      // Log error but don't fail order creation if distance calculation fails
      console.error("Failed to calculate distance for order:", error);
    }

    const order = this.orderRepo.create({
      // Customer relationship
      customerId: data.customerId,
      // Convert lat/lng to PostGIS Point geometry (GeoJSON format: [lng, lat])
      pickupLocation: {
        type: "Point",
        coordinates: [data.pickupLng, data.pickupLat],
      },
      pickupAddress: data.pickupAddress,
      dropoffLocation: {
        type: "Point",
        coordinates: [data.dropoffLng, data.dropoffLat],
      },
      dropoffAddress: data.dropoffAddress,
      requestedDeliveryDate: data.requestedDeliveryDate,
      preferredTimeSlot: data.preferredTimeSlot,
      status: OrderStatus.PENDING,
      priority: data.priority || 5,
      value: data.value || 0,
      // Distance cache
      estimatedDistance,
      estimatedDuration,
    });

    const savedOrder = await this.orderRepo.save(order);

    // Trigger matching engine to assign new order to drivers immediately
    // Runs asynchronously without blocking the response
    await matchOrders(false).catch((error) => {
      console.error("Failed to trigger matching after order creation:", error);
    });

    return savedOrder;
  }

  /**
   * Get order by ID
   */
  async getOrder(id: string): Promise<Order | null> {
    return await this.orderRepo.findOne({
      where: { id },
      relations: ["assignment", "assignment.driver"],
    });
  }

  /**
   * Update order status
   */
  async updateOrderStatus(
    orderId: string,
    status: OrderStatus
  ): Promise<Order> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) {
      throw new Error("Order not found");
    }

    // Use .update() to avoid cascading to eager-loaded assignment
    await this.orderRepo.update({ id: orderId }, { status });

    // Reload to return updated entity
    const updated = await this.orderRepo.findOne({ where: { id: orderId } });
    return updated!;
  }

  /**
   * Get all pending orders (not yet assigned)
   */
  async getPendingOrders(): Promise<Order[]> {
    return await this.orderRepo.find({
      where: { status: OrderStatus.PENDING },
      order: { priority: "DESC", createdAt: "ASC" },
    });
  }

  /**
   * Get orders assigned to a specific driver
   */
  async getOrdersForDriver(driverId: string): Promise<Order[]> {
    const assignments = await this.assignmentRepo.find({
      where: { driverId },
      relations: ["order"],
      order: { sequence: "ASC" },
    });

    return assignments
      .map((assignment) => assignment.order)
      .filter((order): order is Order => order !== undefined);
  }

  /**
   * Get active orders for a driver (not delivered or cancelled)
   */
  async getActiveOrdersForDriver(driverId: string): Promise<Order[]> {
    const orders = await this.orderRepo
      .createQueryBuilder("order")
      .innerJoin("order.assignment", "assignment")
      .where("assignment.driverId = :driverId", { driverId })
      .andWhere("order.status NOT IN (:...statuses)", {
        statuses: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
      })
      .orderBy("assignment.sequence", "ASC")
      .getMany();

    return orders;
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId: string): Promise<Order> {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ["assignment"],
    });

    if (!order) {
      throw new Error("Order not found");
    }

    // Cannot cancel if already picked up
    if (
      order.status === OrderStatus.PICKED_UP ||
      order.status === OrderStatus.DELIVERED
    ) {
      throw new Error(`Cannot cancel order with status: ${order.status}`);
    }

    // Use .update() to avoid cascading to eager-loaded assignment
    await this.orderRepo.update(
      { id: orderId },
      { status: OrderStatus.CANCELLED }
    );

    // Reload to return updated entity
    const updated = await this.orderRepo.findOne({ where: { id: orderId } });
    return updated!;
  }

  /**
   * Get all orders (for admin/testing purposes)
   */
  async getAllOrders(limit: number = 100): Promise<Order[]> {
    return await this.orderRepo.find({
      order: { createdAt: "DESC" },
      take: limit,
      relations: ["assignment"],
    });
  }

  /**
   * Get orders by status
   */
  async getOrdersByStatus(status: OrderStatus): Promise<Order[]> {
    return await this.orderRepo.find({
      where: { status },
      order: { createdAt: "DESC" },
      relations: ["assignment"],
    });
  }

  /**
   * Delete an order (only if pending or cancelled)
   */
  async deleteOrder(orderId: string): Promise<boolean> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) {
      throw new Error("Order not found");
    }

    if (
      order.status !== OrderStatus.PENDING &&
      order.status !== OrderStatus.CANCELLED
    ) {
      throw new Error("Can only delete pending or cancelled orders");
    }

    const result = await this.orderRepo.delete(orderId);
    return result.affected ? result.affected > 0 : false;
  }
}

// Export singleton instance
export const orderService = new OrderService();
