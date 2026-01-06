/**
 * Driver information response
 * @example {
 *   "id": "550e8400-e29b-41d4-a716-446655440000",
 *   "name": "John Doe",
 *   "phone": "+1234567890",
 *   "vehicleType": "bike",
 *   "status": "available",
 *   "maxOrders": 3
 * }
 */
export interface DriverResponse {
  /** Unique driver identifier (UUID) */
  id: string;

  /** Driver's full name */
  name: string;

  /** Phone number */
  phone: string;

  /** Vehicle type: 'bike', 'scooter', or 'car' */
  vehicleType: string;

  /** Current driver status: 'offline', 'available', 'en_route_pickup', 'at_pickup', 'en_route_delivery', 'at_delivery' */
  status: string;

  /** Maximum concurrent orders */
  maxOrders: number;
}
