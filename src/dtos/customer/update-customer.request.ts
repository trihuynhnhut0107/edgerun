/**
 * Request body for updating customer information
 * @example {
 *   "name": "Jane Smith Updated",
 *   "defaultAddress": "456 New St, City, State 54321"
 * }
 */
export interface UpdateCustomerRequest {
  /** Customer's full name */
  name?: string;

  /** Customer's email address */
  email?: string;

  /** Phone number with country code */
  phone?: string;

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
