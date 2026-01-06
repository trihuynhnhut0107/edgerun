/**
 * Order input for API requests (lat/lng format for client convenience)
 * Internally converted to PostGIS Point geometry for storage
 */
export interface OrderInput {
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

  /** Requested delivery date */
  requestedDeliveryDate: Date;

  /** Optional time preference: 'morning', 'afternoon', 'evening' */
  preferredTimeSlot?: string;

  /** Order priority (1-10) */
  priority?: number;

  /** Order value in dollars */
  value?: number;
}
