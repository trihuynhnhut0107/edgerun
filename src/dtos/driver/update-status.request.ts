/**
 * Request body for updating driver status
 * @example {
 *   "status": "available"
 * }
 */
export interface UpdateStatusRequest {
  /** New driver status: 'offline', 'available', 'en_route_pickup', 'at_pickup', 'en_route_delivery', 'at_delivery' */
  status: string;
}
