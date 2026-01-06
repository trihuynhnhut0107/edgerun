/**
 * Request body for creating a new driver
 * @example {
 *   "name": "John Doe",
 *   "phone": "+1234567890",
 *   "vehicleType": "bike",
 *   "maxOrders": 3,
 *   "initialLocation": {
 *     "lat": 37.7749,
 *     "lng": -122.4194
 *   }
 * }
 */
export interface CreateDriverRequest {
  /** Driver's full name */
  name: string;

  /** Phone number with country code (e.g., +1234567890) */
  phone: string;

  /** Type of vehicle: 'bike', 'scooter', or 'car' */
  vehicleType: string;

  /** Maximum number of concurrent orders (default: 3) */
  maxOrders?: number;

  /** Initial GPS location of the driver */
  initialLocation?: {
    /** Latitude coordinate */
    lat: number;
    /** Longitude coordinate */
    lng: number;
  };
}
