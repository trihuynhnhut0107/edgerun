/**
 * Request body for creating a new order
 * System will generate optimal time window after route optimization
 * @example {
 *   "pickupLocation": {
 *     "lat": 37.7749,
 *     "lng": -122.4194
 *   },
 *   "pickupAddress": "123 Market St, San Francisco, CA",
 *   "dropoffLocation": {
 *     "lat": 37.7849,
 *     "lng": -122.4094
 *   },
 *   "dropoffAddress": "456 Mission St, San Francisco, CA",
 *   "requestedDeliveryDate": "2024-11-17",
 *   "preferredTimeSlot": "morning",
 *   "priority": 5,
 *   "value": 15.99
 * }
 */
export interface CreateOrderRequest {
  /** Pickup GPS coordinates */
  pickupLocation: {
    /** Pickup latitude */
    lat: number;
    /** Pickup longitude */
    lng: number;
  };

  /** Human-readable pickup address */
  pickupAddress: string;

  /** Dropoff GPS coordinates */
  dropoffLocation: {
    /** Dropoff latitude */
    lat: number;
    /** Dropoff longitude */
    lng: number;
  };

  /** Human-readable dropoff address */
  dropoffAddress: string;

  /** Requested delivery date (ISO 8601 date format: YYYY-MM-DD) - system will generate specific time window */
  requestedDeliveryDate: string | Date;

  /** Optional time preference: "morning" | "afternoon" | "evening" | omit for flexible */
  preferredTimeSlot?: string;

  /** Order priority (1-10, higher is more urgent, default: 5) */
  priority?: number;

  /** Order value in dollars (for revenue tracking) */
  value?: number;

  /** Customer ID (optional - for registered customers) */
  customerId?: string;
}
