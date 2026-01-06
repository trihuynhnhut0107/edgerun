import mbxDirections from '@mapbox/mapbox-sdk/services/directions';
import mbxMatrix from '@mapbox/mapbox-sdk/services/matrix';
import { Location } from '../../interfaces/Location';

/**
 * Calculate Haversine distance (straight-line) between two locations
 * Used for pre-filtering before expensive Mapbox API calls
 *
 * @param from - Starting location
 * @param to - Destination location
 * @returns Distance in meters
 */
export function haversineDistance(from: Location, to: Location): number {
  const R = 6371000; // Earth's radius in meters
  const φ1 = (from.lat * Math.PI) / 180;
  const φ2 = (to.lat * Math.PI) / 180;
  const Δφ = ((to.lat - from.lat) * Math.PI) / 180;
  const Δλ = ((to.lng - from.lng) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

/**
 * Check if two locations are within routable distance
 * Uses Haversine distance to pre-filter before calling Mapbox
 *
 * @param from - Starting location
 * @param to - Destination location
 * @param maxDistanceKm - Maximum distance in kilometers (default: 100km)
 * @returns true if locations are within range, false otherwise
 */
export function isWithinRoutableDistance(
  from: Location,
  to: Location,
  maxDistanceKm: number = 100
): boolean {
  const distanceMeters = haversineDistance(from, to);
  const distanceKm = distanceMeters / 1000;
  return distanceKm <= maxDistanceKm;
}

// Initialize Mapbox clients
const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN || '';

if (!MAPBOX_ACCESS_TOKEN) {
  console.warn('MAPBOX_ACCESS_TOKEN not found in environment variables');
}

const directionsClient = mbxDirections({ accessToken: MAPBOX_ACCESS_TOKEN });
const matrixClient = mbxMatrix({ accessToken: MAPBOX_ACCESS_TOKEN });

/**
 * Profile types for Mapbox routing
 */
export type MapboxProfile = 'driving-traffic' | 'driving' | 'walking' | 'cycling';

/**
 * Route result interface
 */
export interface RouteResult {
  distance_m: number;
  duration_s: number;
  geometry?: any;
}

/**
 * Get route information between two locations using Mapbox Directions API
 *
 * @param from - Starting location
 * @param to - Destination location
 * @param profile - Routing profile (default: 'driving-traffic')
 * @returns Route with distance in meters and duration in seconds
 */
export async function getRoute(
  from: Location,
  to: Location,
  profile: MapboxProfile = 'driving-traffic'
): Promise<RouteResult> {
  try {
    const response = await directionsClient.getDirections({
      profile,
      waypoints: [
        { coordinates: [from.lng, from.lat] },
        { coordinates: [to.lng, to.lat] }
      ],
      geometries: 'geojson',
      overview: 'full'
    }).send();

    if (!response.body.routes || response.body.routes.length === 0) {
      throw new Error('No route found between the specified locations');
    }

    const route = response.body.routes[0];

    return {
      distance_m: route.distance,
      duration_s: route.duration,
      geometry: route.geometry
    };
  } catch (error) {
    console.error('Mapbox Directions API error:', error);
    throw new Error(`Failed to calculate route: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get distance and duration between two locations
 *
 * @param from - Starting location
 * @param to - Destination location
 * @param profile - Routing profile (default: 'driving-traffic')
 * @returns Object with distance_m and duration_s
 */
export async function getDistance(
  from: Location,
  to: Location,
  profile: MapboxProfile = 'driving-traffic'
): Promise<{ distance_m: number; duration_s: number }> {
  const route = await getRoute(from, to, profile);
  return {
    distance_m: route.distance_m,
    duration_s: route.duration_s
  };
}

/**
 * Get driving time between two locations in milliseconds
 *
 * @param from - Starting location
 * @param to - Destination location
 * @param profile - Routing profile (default: 'driving-traffic')
 * @returns Duration in milliseconds
 */
export async function getDrivingTime(
  from: Location,
  to: Location,
  profile: MapboxProfile = 'driving-traffic'
): Promise<number> {
  const route = await getRoute(from, to, profile);
  return route.duration_s * 1000; // Convert to milliseconds
}

/**
 * Get driving distance between two locations in meters
 *
 * @param from - Starting location
 * @param to - Destination location
 * @param profile - Routing profile (default: 'driving-traffic')
 * @returns Distance in meters
 */
export async function getDrivingDistance(
  from: Location,
  to: Location,
  profile: MapboxProfile = 'driving-traffic'
): Promise<number> {
  const route = await getRoute(from, to, profile);
  return route.distance_m;
}

/**
 * Get duration in seconds between two locations
 *
 * @param from - Starting location
 * @param to - Destination location
 * @param profile - Routing profile (default: 'driving-traffic')
 * @returns Duration in seconds
 */
export async function getDurationSeconds(
  from: Location,
  to: Location,
  profile: MapboxProfile = 'driving-traffic'
): Promise<number> {
  const route = await getRoute(from, to, profile);
  return route.duration_s;
}

/**
 * Calculate distance matrix between multiple locations using Mapbox Matrix API
 *
 * @param locations - Array of locations
 * @param profile - Routing profile (default: 'driving-traffic')
 * @returns Matrix of distances and durations
 */
export async function getDistanceMatrix(
  locations: Location[],
  profile: MapboxProfile = 'driving-traffic'
): Promise<{
  distances: number[][];
  durations: number[][];
}> {
  try {
    if (locations.length < 2) {
      throw new Error('At least 2 locations are required for distance matrix');
    }

    if (locations.length > 25) {
      throw new Error('Maximum 25 locations allowed for distance matrix');
    }

    const response = await matrixClient.getMatrix({
      points: locations.map(loc => ({
        coordinates: [loc.lng, loc.lat]
      })),
      profile,
      annotations: ['distance', 'duration']
    }).send();

    if (!response.body.distances || !response.body.durations) {
      throw new Error('Invalid response from Mapbox Matrix API');
    }

    return {
      distances: response.body.distances,
      durations: response.body.durations
    };
  } catch (error) {
    console.error('Mapbox Matrix API error:', error);
    throw new Error(`Failed to calculate distance matrix: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Calculate route matrix between sources and destinations
 *
 * @param sources - Array of source locations
 * @param destinations - Array of destination locations
 * @param profile - Routing profile (default: 'driving-traffic')
 * @returns Matrix of distances and durations
 */
export async function getRouteMatrix(
  sources: Location[],
  destinations: Location[],
  profile: MapboxProfile = 'driving-traffic'
): Promise<{
  distances: number[][];
  durations: number[][];
}> {
  try {
    const allLocations = [...sources, ...destinations];

    if (allLocations.length > 25) {
      throw new Error('Total locations (sources + destinations) cannot exceed 25');
    }

    const sourceIndices = sources.map((_, index) => index);
    const destinationIndices = destinations.map((_, index) => index + sources.length);

    const response = await matrixClient.getMatrix({
      points: allLocations.map(loc => ({
        coordinates: [loc.lng, loc.lat]
      })),
      profile,
      sources: sourceIndices,
      destinations: destinationIndices,
      annotations: ['distance', 'duration']
    }).send();

    if (!response.body.distances || !response.body.durations) {
      throw new Error('Invalid response from Mapbox Matrix API');
    }

    return {
      distances: response.body.distances,
      durations: response.body.durations
    };
  } catch (error) {
    console.error('Mapbox Matrix API error:', error);
    throw new Error(`Failed to calculate route matrix: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Format distance from meters to human-readable string
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(2)}km`;
}

/**
 * Format duration from seconds to human-readable string
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

/**
 * Calculate estimated time of arrival
 */
export function calculateETA(durationSeconds: number, departureTime: Date = new Date()): Date {
  const eta = new Date(departureTime);
  eta.setSeconds(eta.getSeconds() + durationSeconds);
  return eta;
}
