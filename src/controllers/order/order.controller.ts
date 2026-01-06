import { Controller, Post, Get, Route, Body, Path, Response, Tags } from 'tsoa';
import { orderService } from '../../services/order/order.service';
import { CreateOrderRequest } from '../../dtos/order/create-order.request';
import { OrderResponse } from '../../dtos/order/order.response';

@Route('orders')
@Tags('Orders')
export class OrderController extends Controller {
  @Post()
  @Response<OrderResponse>(201, 'Order created')
  async createOrder(@Body() body: CreateOrderRequest): Promise<OrderResponse> {
    const order = await orderService.createOrder({
      pickupLat: body.pickupLocation.lat,
      pickupLng: body.pickupLocation.lng,
      pickupAddress: body.pickupAddress,
      dropoffLat: body.dropoffLocation.lat,
      dropoffLng: body.dropoffLocation.lng,
      dropoffAddress: body.dropoffAddress,
      requestedDeliveryDate: new Date(body.requestedDeliveryDate),
      preferredTimeSlot: body.preferredTimeSlot,
      priority: body.priority,
      value: body.value,
    });

    // TODO: Implement matching algorithm (Phase 6 - see 05_IMPLEMENTATION_PLAN.md)
    // const matchResult = await matchingEngine.matchOrder(order.id);
    // if (matchResult) {
    //   await orderAssignmentService.assignOrder({
    //     orderId: order.id,
    //     driverId: matchResult.driverId,
    //     sequence: matchResult.sequence,
    //     estimatedPickup: matchResult.estimatedPickup,
    //     estimatedDelivery: matchResult.estimatedDelivery
    //   });
    // }

    this.setStatus(201);
    const pickupCoords = order.pickupLocation?.coordinates || [0, 0];
    const dropoffCoords = order.dropoffLocation?.coordinates || [0, 0];

    return {
      id: order.id,
      pickupLat: pickupCoords[1],
      pickupLng: pickupCoords[0],
      pickupAddress: order.pickupAddress,
      dropoffLat: dropoffCoords[1],
      dropoffLng: dropoffCoords[0],
      dropoffAddress: order.dropoffAddress,
      requestedDeliveryDate: order.requestedDeliveryDate,
      preferredTimeSlot: order.preferredTimeSlot,
      status: order.status,
      priority: order.priority,
      value: order.value,
      driverId: order.assignment?.driverId,
    };
  }

  @Get('{id}')
  @Response<OrderResponse>(200, 'Order found')
  @Response<{ error: string }>(404, 'Order not found')
  async getOrder(@Path() id: string): Promise<OrderResponse> {
    const order = await orderService.getOrder(id);

    if (!order) {
      this.setStatus(404);
      throw new Error('Order not found');
    }

    const pickupCoords = order.pickupLocation?.coordinates || [0, 0];
    const dropoffCoords = order.dropoffLocation?.coordinates || [0, 0];

    return {
      id: order.id,
      pickupLat: pickupCoords[1],
      pickupLng: pickupCoords[0],
      pickupAddress: order.pickupAddress,
      dropoffLat: dropoffCoords[1],
      dropoffLng: dropoffCoords[0],
      dropoffAddress: order.dropoffAddress,
      requestedDeliveryDate: order.requestedDeliveryDate,
      preferredTimeSlot: order.preferredTimeSlot,
      status: order.status,
      priority: order.priority,
      value: order.value,
      driverId: order.assignment?.driverId,
    };
  }
}
