import { Repository, MoreThan } from 'typeorm';
import { AppDataSource } from '../../config/ormconfig';
import { DistanceCache } from '../../entities/DistanceCache';
import { Location } from '../../interfaces/Location';
import {
  getDistance,
  getDistanceMatrix as mapboxGetDistanceMatrix,
  MapboxProfile,
} from './mapboxClient';

export class DistanceCacheService {
  private readonly CACHE_TTL_DAYS = 7;
  private readonly GRID_PRECISION = 0.001; // ~100m resolution
  private cacheRepo: Repository<DistanceCache>;

  constructor() {
    this.cacheRepo = AppDataSource.getRepository(DistanceCache);
  }

  /**
   * Get distance between two locations with caching
   */
  async getDistanceWithCache(
    origin: Location,
    destination: Location,
    profile: MapboxProfile = 'driving-traffic'
  ): Promise<{ distance: number; duration: number }> {
    // 1. Generate cache key
    const cacheKey = this.generateCacheKey(origin, destination, profile);

    // 2. Check cache
    const cached = await this.cacheRepo.findOne({
      where: {
        id: cacheKey,
        expiresAt: MoreThan(new Date()),
      },
    });

    if (cached) {
      return {
        distance: cached.distance,
        duration: cached.duration,
      };
    }

    // 3. Fetch from Mapbox if not cached
    const result = await getDistance(origin, destination, profile);

    // 4. Store in cache
    try {
      await this.cacheRepo.save({
        id: cacheKey,
        origin: {
          type: 'Point',
          coordinates: [origin.lng, origin.lat],
        },
        destination: {
          type: 'Point',
          coordinates: [destination.lng, destination.lat],
        },
        profile,
        distance: result.distance_m,
        duration: result.duration_s,
        expiresAt: new Date(
          Date.now() + this.CACHE_TTL_DAYS * 24 * 60 * 60 * 1000
        ),
      });
    } catch (error) {
      // Log error but don't fail the request if cache save fails
      console.error('Failed to save to distance cache:', error);
    }

    return {
      distance: result.distance_m,
      duration: result.duration_s,
    };
  }

  /**
   * Batch fetch distance matrix with caching
   */
  async getDistanceMatrixWithCache(
    locations: Location[],
    profile: MapboxProfile = 'driving-traffic'
  ): Promise<{
    distances: number[][];
    durations: number[][];
  }> {
    const n = locations.length;
    const distances: number[][] = Array(n)
      .fill(null)
      .map(() => Array(n).fill(0));
    const durations: number[][] = Array(n)
      .fill(null)
      .map(() => Array(n).fill(0));
    const uncachedPairs: Array<[number, number]> = [];

    // 1. Check cache for all pairs
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          distances[i][j] = 0;
          durations[i][j] = 0;
          continue;
        }

        try {
          const cached = await this.getDistanceWithCache(
            locations[i],
            locations[j],
            profile
          );

          distances[i][j] = cached.distance;
          durations[i][j] = cached.duration;
        } catch (error) {
          // If cache lookup fails, mark as uncached
          uncachedPairs.push([i, j]);
        }
      }
    }

    // 2. Batch fetch uncached pairs from Mapbox Matrix API if needed
    if (uncachedPairs.length > 0) {
      try {
        // Get all unique locations involved in uncached pairs
        const uniqueIndices = new Set<number>();
        uncachedPairs.forEach(([i, j]) => {
          uniqueIndices.add(i);
          uniqueIndices.add(j);
        });

        const uniqueLocations = Array.from(uniqueIndices)
          .sort((a, b) => a - b)
          .map((idx) => locations[idx]);

        // Fetch matrix for these locations
        const matrixResult = await mapboxGetDistanceMatrix(
          uniqueLocations,
          profile
        );

        // Map results back to original indices
        const indexMapping = new Map(
          Array.from(uniqueIndices)
            .sort((a, b) => a - b)
            .map((origIdx, newIdx) => [origIdx, newIdx])
        );

        for (const [i, j] of uncachedPairs) {
          const newI = indexMapping.get(i)!;
          const newJ = indexMapping.get(j)!;

          distances[i][j] = matrixResult.distances[newI][newJ];
          durations[i][j] = matrixResult.durations[newI][newJ];

          // Cache the result asynchronously (don't block on it)
          this.cacheDistancePair(
            locations[i],
            locations[j],
            profile,
            matrixResult.distances[newI][newJ],
            matrixResult.durations[newI][newJ]
          ).catch((err) =>
            console.error('Failed to cache distance pair:', err)
          );
        }
      } catch (error) {
        console.error('Failed to fetch uncached distances from Mapbox:', error);
        // Return partial results (cached only)
      }
    }

    return { distances, durations };
  }

  /**
   * Cache a single distance pair (async, non-blocking)
   */
  private async cacheDistancePair(
    origin: Location,
    destination: Location,
    profile: string,
    distance: number,
    duration: number
  ): Promise<void> {
    const cacheKey = this.generateCacheKey(origin, destination, profile);

    try {
      await this.cacheRepo.save({
        id: cacheKey,
        origin: {
          type: 'Point',
          coordinates: [origin.lng, origin.lat],
        },
        destination: {
          type: 'Point',
          coordinates: [destination.lng, destination.lat],
        },
        profile,
        distance,
        duration,
        expiresAt: new Date(
          Date.now() + this.CACHE_TTL_DAYS * 24 * 60 * 60 * 1000
        ),
      });
    } catch (error) {
      // Silent fail - caching is not critical
      console.error('Failed to cache distance pair:', error);
    }
  }

  /**
   * Generate stable cache key from locations
   */
  private generateCacheKey(
    origin: Location,
    destination: Location,
    profile: string
  ): string {
    // Grid-based hashing for nearby locations
    const originGrid = this.gridHash(origin.lat, origin.lng);
    const destGrid = this.gridHash(destination.lat, destination.lng);

    // Normalize order (A→B same as B→A for symmetric distances)
    const grids = [originGrid, destGrid].sort();

    return `${grids[0]}_${grids[1]}_${profile}`;
  }

  /**
   * Hash location to grid cell
   */
  private gridHash(lat: number, lng: number): string {
    const latGrid = Math.round(lat / this.GRID_PRECISION);
    const lngGrid = Math.round(lng / this.GRID_PRECISION);
    return `${latGrid}_${lngGrid}`;
  }

  /**
   * Pre-warm cache for common routes (run during off-peak hours)
   */
  async prewarmCache(
    locations: Location[],
    profile: MapboxProfile = 'driving-traffic'
  ): Promise<void> {
    await this.getDistanceMatrixWithCache(locations, profile);
  }

  /**
   * Clean expired cache entries
   */
  async cleanExpiredCache(): Promise<number> {
    const result = await this.cacheRepo
      .createQueryBuilder()
      .delete()
      .where('expiresAt < :now', { now: new Date() })
      .execute();

    return result.affected || 0;
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    totalEntries: number;
    validEntries: number;
    expiredEntries: number;
    oldestEntry: Date | null;
    newestEntry: Date | null;
  }> {
    const now = new Date();

    const [total, valid, oldest, newest] = await Promise.all([
      this.cacheRepo.count(),
      this.cacheRepo.count({ where: { expiresAt: MoreThan(now) } }),
      this.cacheRepo.findOne({
        order: { createdAt: 'ASC' },
        select: ['createdAt'],
      }),
      this.cacheRepo.findOne({
        order: { createdAt: 'DESC' },
        select: ['createdAt'],
      }),
    ]);

    return {
      totalEntries: total,
      validEntries: valid,
      expiredEntries: total - valid,
      oldestEntry: oldest?.createdAt || null,
      newestEntry: newest?.createdAt || null,
    };
  }
}

// Export singleton instance
export const distanceCacheService = new DistanceCacheService();
