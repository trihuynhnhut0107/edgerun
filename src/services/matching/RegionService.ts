/**
 * REGION SERVICE
 *
 * Uses PostGIS spatial queries to efficiently group drivers and orders
 * into geographic regions for optimized matching.
 *
 * Strategy:
 * 1. Use ST_ClusterDBSCAN or ST_DWithin to create dynamic regions
 * 2. Filter candidate drivers within routable distance (air distance pre-filter)
 * 3. Reduce Mapbox API calls by grouping spatially close entities
 */

import { AppDataSource } from "../../config/ormconfig";
import { Order } from "../../entities/Order";
import { Driver } from "../../entities/Driver";
import { Location } from "../../interfaces/Location";
import { DriverWithLocation } from "./matchingEngine";

/**
 * Region: Geographic grouping of orders and drivers
 */
export interface Region {
  id: string; // Region identifier (e.g., "region_1", "region_2")
  centroid: Location; // Geographic center of the region
  orders: Order[]; // Orders within this region
  drivers: DriverWithLocation[]; // Drivers within this region
  radiusKm: number; // Approximate radius of the region
}

/**
 * RegionService: PostGIS-based spatial grouping
 */
export class RegionService {
  /**
   * Group orders and drivers into regions using PostGIS spatial clustering
   *
   * Algorithm:
   * 1. Use ST_ClusterDBSCAN to create spatial clusters of orders
   * 2. Calculate centroid for each cluster using ST_Centroid
   * 3. Assign drivers to regions based on proximity to centroids
   * 4. Filter out drivers/orders beyond routable distance threshold
   *
   * @param orders - Orders to group
   * @param drivers - Drivers to group
   * @param maxDistanceKm - Maximum distance for region assignment (default: 50km)
   * @param minPointsPerCluster - Minimum orders per cluster (default: 2)
   * @returns Array of regions with associated orders and drivers
   */
  static async groupByRegion(
    orders: Order[],
    drivers: DriverWithLocation[],
    maxDistanceKm: number = 50,
    minPointsPerCluster: number = 2
  ): Promise<Region[]> {
    if (orders.length === 0 || drivers.length === 0) {
      return [];
    }

    console.log(
      `\n📍 REGION CLUSTERING: ${orders.length} orders, ${drivers.length} drivers (max ${maxDistanceKm}km radius)`
    );

    // Step 1: Cluster orders using PostGIS ST_ClusterDBSCAN
    const orderClusters = await this.clusterOrders(orders, maxDistanceKm, minPointsPerCluster);

    console.log(`  ✅ Created ${orderClusters.size} order clusters`);

    // Step 2: Build regions from clusters
    const regions: Region[] = [];
    let regionIndex = 0;

    for (const [clusterId, clusterOrders] of orderClusters.entries()) {
      // Calculate centroid of the cluster
      const centroid = this.calculateCentroid(
        clusterOrders.map((o) => {
          const coords = o.pickupLocation?.coordinates || [0, 0];
          return { lat: coords[1], lng: coords[0] };
        })
      );

      // Find drivers within routable distance of centroid
      const regionDrivers = drivers.filter((dw) => {
        const distance = this.haversineDistance(dw.location, centroid);
        return distance <= maxDistanceKm * 1000; // Convert km to meters
      });

      // Only create region if there are drivers available
      if (regionDrivers.length > 0) {
        regions.push({
          id: `region_${regionIndex++}`,
          centroid,
          orders: clusterOrders,
          drivers: regionDrivers,
          radiusKm: maxDistanceKm,
        });

        console.log(
          `  📦 Region ${regionIndex - 1}: ${clusterOrders.length} orders, ${regionDrivers.length} drivers, centroid (${centroid.lat.toFixed(4)}, ${centroid.lng.toFixed(4)})`
        );
      } else {
        console.warn(
          `  ⚠️  Cluster ${clusterId}: ${clusterOrders.length} orders but no nearby drivers (skipping)`
        );
      }
    }

    console.log(`  ✅ Created ${regions.length} active regions\n`);
    return regions;
  }

  /**
   * Cluster orders using PostGIS ST_ClusterDBSCAN
   *
   * Uses density-based spatial clustering to group orders within specified distance.
   * Orders that are isolated (not within distance of minPoints orders) get cluster -1.
   *
   * @param orders - Orders to cluster
   * @param maxDistanceKm - Maximum distance between orders in same cluster
   * @param minPoints - Minimum points per cluster (DBSCAN parameter)
   * @returns Map of cluster ID to orders
   */
  private static async clusterOrders(
    orders: Order[],
    maxDistanceKm: number,
    minPoints: number
  ): Promise<Map<number, Order[]>> {
    const query = `
      WITH order_locations AS (
        SELECT
          id,
          pickup_location,
          ST_ClusterDBSCAN(
            pickup_location::geometry,
            eps := $1,  -- Maximum distance in meters
            minpoints := $2
          ) OVER () AS cluster_id
        FROM orders
        WHERE id = ANY($3::uuid[])
      )
      SELECT id, cluster_id
      FROM order_locations
      ORDER BY cluster_id;
    `;

    const orderIds = orders.map((o) => o.id);
    const maxDistanceMeters = maxDistanceKm * 1000;

    try {
      const result = await AppDataSource.query(query, [
        maxDistanceMeters,
        minPoints,
        orderIds,
      ]);

      // Build map of cluster_id -> orders
      const clusters = new Map<number, Order[]>();

      for (const row of result) {
        const clusterId = row.cluster_id !== null ? row.cluster_id : -1;
        const order = orders.find((o) => o.id === row.id);

        if (order) {
          if (!clusters.has(clusterId)) {
            clusters.set(clusterId, []);
          }
          clusters.get(clusterId)!.push(order);
        }
      }

      // Handle isolated orders (cluster -1): assign each to its own cluster
      const isolatedOrders = clusters.get(-1);
      if (isolatedOrders) {
        clusters.delete(-1);
        isolatedOrders.forEach((order, index) => {
          const newClusterId = 1000 + index; // Use high numbers to avoid conflicts
          clusters.set(newClusterId, [order]);
        });
      }

      return clusters;
    } catch (error) {
      console.error("❌ PostGIS clustering failed:", error);

      // Fallback: Simple distance-based clustering using haversine
      return this.fallbackCluster(orders, maxDistanceKm);
    }
  }

  /**
   * Fallback clustering using simple haversine distance grouping
   * Used when PostGIS query fails
   */
  private static fallbackCluster(
    orders: Order[],
    maxDistanceKm: number
  ): Map<number, Order[]> {
    console.warn("  ⚠️  Using fallback clustering (haversine-based)");

    const clusters = new Map<number, Order[]>();
    let nextClusterId = 0;
    const assigned = new Set<string>();

    for (const order of orders) {
      if (assigned.has(order.id)) continue;

      const cluster: Order[] = [order];
      assigned.add(order.id);

      const orderCoords = order.pickupLocation?.coordinates || [0, 0];
      const orderLoc: Location = { lat: orderCoords[1], lng: orderCoords[0] };

      // Find nearby unassigned orders
      for (const other of orders) {
        if (assigned.has(other.id)) continue;

        const otherCoords = other.pickupLocation?.coordinates || [0, 0];
        const otherLoc: Location = { lat: otherCoords[1], lng: otherCoords[0] };

        const distance = this.haversineDistance(orderLoc, otherLoc);
        if (distance <= maxDistanceKm * 1000) {
          cluster.push(other);
          assigned.add(other.id);
        }
      }

      clusters.set(nextClusterId++, cluster);
    }

    return clusters;
  }

  /**
   * Calculate centroid (geographic center) of a set of locations
   */
  private static calculateCentroid(locations: Location[]): Location {
    if (locations.length === 0) {
      return { lat: 0, lng: 0 };
    }

    const sum = locations.reduce(
      (acc, loc) => ({
        lat: acc.lat + loc.lat,
        lng: acc.lng + loc.lng,
      }),
      { lat: 0, lng: 0 }
    );

    return {
      lat: sum.lat / locations.length,
      lng: sum.lng / locations.length,
    };
  }

  /**
   * Calculate Haversine distance between two locations (meters)
   */
  private static haversineDistance(from: Location, to: Location): number {
    const R = 6371000; // Earth's radius in meters
    const φ1 = (from.lat * Math.PI) / 180;
    const φ2 = (to.lat * Math.PI) / 180;
    const Δφ = ((to.lat - from.lat) * Math.PI) / 180;
    const Δλ = ((to.lng - from.lng) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Filter candidate drivers within specified distance of an order
   * Uses PostGIS ST_DWithin for efficient spatial query
   *
   * @param order - Order to find drivers for
   * @param drivers - Available drivers
   * @param maxDistanceKm - Maximum distance threshold
   * @returns Drivers within distance
   */
  static filterNearbyDrivers(
    order: Order,
    drivers: DriverWithLocation[],
    maxDistanceKm: number
  ): DriverWithLocation[] {
    const pickupCoords = order.pickupLocation?.coordinates || [0, 0];
    const orderLocation: Location = {
      lat: pickupCoords[1],
      lng: pickupCoords[0],
    };

    return drivers.filter((dw) => {
      const distance = this.haversineDistance(dw.location, orderLocation);
      return distance <= maxDistanceKm * 1000; // Convert km to meters
    });
  }
}
