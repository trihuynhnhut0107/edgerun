/**
 * Order information response
 * @example {
 *   "id": "550e8400-e29b-41d4-a716-446655440000",
 *   "pickupLat": 37.7749,
 *   "pickupLng": -122.4194,
 *   "pickupAddress": "123 Market St, San Francisco, CA",
 *   "dropoffLat": 37.7849,
 *   "dropoffLng": -122.4094,
 *   "dropoffAddress": "456 Mission St, San Francisco, CA",
 *   "requestedDeliveryDate": "2024-11-17",
 *   "preferredTimeSlot": "morning",
 *   "status": "pending",
 *   "priority": 5,
 *   "value": 15.99,
 *   "driverId": "660e8400-e29b-41d4-a716-446655440001"
 * }
 */
export interface OrderResponse {
  /** Unique order identifier (UUID) */
  id: string;

  /** Pickup latitude coordinate */
  pickupLat: number;

  /** Pickup longitude coordinate */
  pickupLng: number;

  /** Pickup address */
  pickupAddress: string;

  /** Dropoff latitude coordinate */
  dropoffLat: number;

  /** Dropoff longitude coordinate */
  dropoffLng: number;

  /** Dropoff address */
  dropoffAddress: string;

  /** Requested delivery date (system will generate optimal time window) */
  requestedDeliveryDate: Date;

  /** Optional time preference: morning, afternoon, evening */
  preferredTimeSlot?: string;

  /** Order status: 'pending', 'assigned', 'picked_up', 'delivered', 'cancelled' */
  status: string;

  /** Order priority (1-10) */
  priority: number;

  /** Order value in dollars */
  value: number;

  /** Assigned driver ID (if assigned) */
  driverId?: string;

  /** Customer ID (if order placed by registered customer) */
  customerId?: string;

  /** Estimated distance from pickup to dropoff in meters */
  estimatedDistance?: number;

  /** Estimated duration from pickup to dropoff in seconds */
  estimatedDuration?: number;
}
