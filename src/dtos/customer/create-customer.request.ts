/**
 * Request body for creating a new customer (registration)
 * @example {
 *   "name": "Jane Smith",
 *   "email": "jane@example.com",
 *   "phone": "+1234567890",
 *   "defaultAddress": "123 Main St, City, State 12345",
 *   "defaultLocation": {
 *     "lat": 37.7749,
 *     "lng": -122.4194
 *   }
 * }
 */
export interface CreateCustomerRequest {
  /** Customer's full name */
  name: string;

  /** Customer's email address (unique) */
  email: string;

  /** Phone number with country code (e.g., +1234567890, unique) */
  phone: string;

  /** Default delivery address */
  defaultAddress?: string;

  /** Default GPS location */
  defaultLocation?: {
    /** Latitude coordinate */
    lat: number;
    /** Longitude coordinate */
    lng: number;
  };
}
