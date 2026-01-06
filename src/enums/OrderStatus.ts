export enum OrderStatus {
  PENDING = 'pending',
  OFFERED = 'offered', // Draft assignment sent to driver, awaiting response
  ASSIGNED = 'assigned',
  PICKED_UP = 'picked_up',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
}
