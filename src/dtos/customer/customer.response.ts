/**
 * Customer information response
 * @example {
 *   "id": "550e8400-e29b-41d4-a716-446655440000",
 *   "name": "Jane Smith",
 *   "email": "jane@example.com",
 *   "phone": "+1234567890",
 *   "defaultAddress": "123 Main St, City, State 12345",
 *   "createdAt": "2024-01-15T10:30:00.000Z"
 * }
 */
export interface CustomerResponse {
  /** Unique customer identifier (UUID) */
  id: string;

  /** Customer's full name */
  name: string;

  /** Customer's email address */
  email: string;

  /** Phone number */
  phone: string;

  /** Default delivery address */
  defaultAddress?: string;

  /** Default location coordinates */
  defaultLocation?: {
    lat: number;
    lng: number;
  };

  /** Account creation timestamp */
  createdAt: Date;
}
