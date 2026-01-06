/**
 * Request body for updating driver's GPS location
 * @example {
 *   "lat": 37.7749,
 *   "lng": -122.4194,
 *   "heading": 90,
 *   "speed": 15.5
 * }
 */
export interface UpdateLocationRequest {
  /** Latitude coordinate (-90 to 90) */
  lat: number;

  /** Longitude coordinate (-180 to 180) */
  lng: number;

  /** Compass heading in degrees (0-360, optional) */
  heading?: number;

  /** Speed in km/h (optional) */
  speed?: number;
}
