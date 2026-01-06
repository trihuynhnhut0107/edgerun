import { AppDataSource } from '../../config/ormconfig';
import { Order } from '../../entities/Order';
import { OrderAssignment } from '../../entities/OrderAssignment';
import { OrderStatus } from '../../enums/OrderStatus';

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
}

export class OrderService {
  private orderRepo = AppDataSource.getRepository(Order);
  private assignmentRepo = AppDataSource.getRepository(OrderAssignment);

  /**
   * Create a new order
   */
  async createOrder(data: CreateOrderDTO): Promise<Order> {
    const order = this.orderRepo.create({
      // Convert lat/lng to PostGIS Point geometry (GeoJSON format: [lng, lat])
      pickupLocation: {
        type: 'Point',
        coordinates: [data.pickupLng, data.pickupLat],
      },
      pickupAddress: data.pickupAddress,
      dropoffLocation: {
        type: 'Point',
        coordinates: [data.dropoffLng, data.dropoffLat],
      },
      dropoffAddress: data.dropoffAddress,
      requestedDeliveryDate: data.requestedDeliveryDate,
      preferredTimeSlot: data.preferredTimeSlot,
      status: OrderStatus.PENDING,
      priority: data.priority || 5,
      value: data.value || 0,
    });

    return await this.orderRepo.save(order);
  }

  /**
   * Get order by ID
   */
  async getOrder(id: string): Promise<Order | null> {
    return await this.orderRepo.findOne({
      where: { id },
      relations: ['assignment', 'assignment.driver'],
    });
  }

  /**
   * Update order status
   */
  async updateOrderStatus(orderId: string, status: OrderStatus): Promise<Order> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) {
      throw new Error('Order not found');
    }

    order.status = status;
    return await this.orderRepo.save(order);
  }

  /**
   * Get all pending orders (not yet assigned)
   */
  async getPendingOrders(): Promise<Order[]> {
    return await this.orderRepo.find({
      where: { status: OrderStatus.PENDING },
      order: { priority: 'DESC', createdAt: 'ASC' },
    });
  }

  /**
   * Get orders assigned to a specific driver
   */
  async getOrdersForDriver(driverId: string): Promise<Order[]> {
    const assignments = await this.assignmentRepo.find({
      where: { driverId },
      relations: ['order'],
      order: { sequence: 'ASC' },
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
      .createQueryBuilder('order')
      .innerJoin('order.assignment', 'assignment')
      .where('assignment.driverId = :driverId', { driverId })
      .andWhere('order.status NOT IN (:...statuses)', {
        statuses: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
      })
      .orderBy('assignment.sequence', 'ASC')
      .getMany();

    return orders;
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId: string): Promise<Order> {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['assignment'],
    });

    if (!order) {
      throw new Error('Order not found');
    }

    // Cannot cancel if already picked up
    if (
      order.status === OrderStatus.PICKED_UP ||
      order.status === OrderStatus.DELIVERED
    ) {
      throw new Error(`Cannot cancel order with status: ${order.status}`);
    }

    order.status = OrderStatus.CANCELLED;
    return await this.orderRepo.save(order);
  }

  /**
   * Get all orders (for admin/testing purposes)
   */
  async getAllOrders(limit: number = 100): Promise<Order[]> {
    return await this.orderRepo.find({
      order: { createdAt: 'DESC' },
      take: limit,
      relations: ['assignment'],
    });
  }

  /**
   * Get orders by status
   */
  async getOrdersByStatus(status: OrderStatus): Promise<Order[]> {
    return await this.orderRepo.find({
      where: { status },
      order: { createdAt: 'DESC' },
      relations: ['assignment'],
    });
  }

  /**
   * Delete an order (only if pending or cancelled)
   */
  async deleteOrder(orderId: string): Promise<boolean> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) {
      throw new Error('Order not found');
    }

    if (
      order.status !== OrderStatus.PENDING &&
      order.status !== OrderStatus.CANCELLED
    ) {
      throw new Error('Can only delete pending or cancelled orders');
    }

    const result = await this.orderRepo.delete(orderId);
    return result.affected ? result.affected > 0 : false;
  }
}

// Export singleton instance
export const orderService = new OrderService();
