/**
 * Route Segment Observation Query Service
 *
 * Retrieves historical travel time observations for time window calculation
 * Supports filtering by location, time of day, day of week for contextual accuracy
 */

import { AppDataSource } from '../../config/ormconfig';
import { RouteSegmentObservation } from '../../entities/RouteSegmentObservation';
import { Location } from '../../interfaces/Location';
import { Between, LessThan, MoreThan } from 'typeorm';

/**
 * Query parameters for finding relevant observations
 */
export interface ObservationQueryParams {
  from: Location;
  to: Location;
  radiusKm?: number;           // Search radius around from/to points (default: 1km)
  timeOfDay?: string;          // Filter by time bucket: morning, afternoon, evening, night
  dayOfWeek?: string;          // Filter by day: monday, tuesday, etc.
  minSamples?: number;         // Minimum observations required (default: 30)
  maxAge?: number;             // Max age in days (default: 30)
}

/**
 * Observation Query Service
 */
export class ObservationQueryService {
  private repository = AppDataSource.getRepository(RouteSegmentObservation);

  /**
   * Find observations for a route segment
   * Uses spatial proximity to find similar route segments
   */
  async findObservationsForSegment(
    params: ObservationQueryParams
  ): Promise<RouteSegmentObservation[]> {
    const radiusKm = params.radiusKm ?? 1.0; // 1km default radius
    const maxAgeDays = params.maxAge ?? 30;

    // Calculate bounding box for spatial query
    // Rough approximation: 1 degree ≈ 111km at equator
    const degreesRadius = radiusKm / 111;

    const fromLatMin = params.from.lat - degreesRadius;
    const fromLatMax = params.from.lat + degreesRadius;
    const fromLngMin = params.from.lng - degreesRadius;
    const fromLngMax = params.from.lng + degreesRadius;

    const toLatMin = params.to.lat - degreesRadius;
    const toLatMax = params.to.lat + degreesRadius;
    const toLngMin = params.to.lng - degreesRadius;
    const toLngMax = params.to.lng + degreesRadius;

    // Calculate minimum timestamp
    const minTimestamp = new Date();
    minTimestamp.setDate(minTimestamp.getDate() - maxAgeDays);

    // Build query
    const queryBuilder = this.repository
      .createQueryBuilder('obs')
      .where('obs.fromLat BETWEEN :fromLatMin AND :fromLatMax', { fromLatMin, fromLatMax })
      .andWhere('obs.fromLng BETWEEN :fromLngMin AND :fromLngMax', { fromLngMin, fromLngMax })
      .andWhere('obs.toLat BETWEEN :toLatMin AND :toLatMax', { toLatMin, toLatMax })
      .andWhere('obs.toLng BETWEEN :toLngMin AND :toLngMax', { toLngMin, toLngMax })
      .andWhere('obs.timestamp >= :minTimestamp', { minTimestamp });

    // Optional filters
    if (params.timeOfDay) {
      queryBuilder.andWhere('obs.timeOfDay = :timeOfDay', { timeOfDay: params.timeOfDay });
    }

    if (params.dayOfWeek) {
      queryBuilder.andWhere('obs.dayOfWeek = :dayOfWeek', { dayOfWeek: params.dayOfWeek });
    }

    // Order by most recent first
    queryBuilder.orderBy('obs.timestamp', 'DESC');

    // Execute query
    const observations = await queryBuilder.getMany();

    // Log query results
    console.log(
      `📊 Found ${observations.length} observations for segment (${params.from.lat.toFixed(4)}, ${params.from.lng.toFixed(4)}) → (${params.to.lat.toFixed(4)}, ${params.to.lng.toFixed(4)})`
    );

    return observations;
  }

  /**
   * Check if we have enough observations to use SAA method
   */
  async hasEnoughSamples(
    from: Location,
    to: Location,
    minSamples: number = 30
  ): Promise<boolean> {
    const observations = await this.findObservationsForSegment({
      from,
      to,
      minSamples,
    });

    return observations.length >= minSamples;
  }

  /**
   * Calculate statistics for observations
   */
  calculateStatistics(observations: RouteSegmentObservation[]): {
    count: number;
    meanSeconds: number;
    stdDevSeconds: number;
    minSeconds: number;
    maxSeconds: number;
    meanDeviation: number;
  } {
    if (observations.length === 0) {
      return {
        count: 0,
        meanSeconds: 0,
        stdDevSeconds: 0,
        minSeconds: 0,
        maxSeconds: 0,
        meanDeviation: 0,
      };
    }

    const actualTimes = observations.map(o => o.actualSeconds);
    const deviations = observations.map(o => o.deviationSeconds);

    const meanSeconds = actualTimes.reduce((sum, t) => sum + t, 0) / actualTimes.length;
    const variance =
      actualTimes.reduce((sum, t) => sum + Math.pow(t - meanSeconds, 2), 0) /
      actualTimes.length;
    const stdDevSeconds = Math.sqrt(variance);

    const meanDeviation = deviations.reduce((sum, d) => sum + d, 0) / deviations.length;

    return {
      count: observations.length,
      meanSeconds,
      stdDevSeconds,
      minSeconds: Math.min(...actualTimes),
      maxSeconds: Math.max(...actualTimes),
      meanDeviation,
    };
  }

  /**
   * Determine time of day bucket from timestamp
   */
  getTimeOfDay(date: Date): string {
    const hour = date.getHours();

    if (hour >= 6 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 18) return 'afternoon';
    if (hour >= 18 && hour < 22) return 'evening';
    return 'night';
  }

  /**
   * Get day of week from timestamp
   */
  getDayOfWeek(date: Date): string {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return days[date.getDay()];
  }

  /**
   * Save a new observation after delivery completion
   */
  async saveObservation(
    observation: Partial<RouteSegmentObservation>
  ): Promise<RouteSegmentObservation> {
    const entity = this.repository.create({
      ...observation,
      deviationSeconds: observation.actualSeconds! - observation.estimatedSeconds!,
      timeOfDay: observation.timestamp ? this.getTimeOfDay(observation.timestamp) : undefined,
      dayOfWeek: observation.timestamp ? this.getDayOfWeek(observation.timestamp) : undefined,
    });

    return await this.repository.save(entity);
  }
}

/**
 * Singleton instance
 */
export const observationQueryService = new ObservationQueryService();
