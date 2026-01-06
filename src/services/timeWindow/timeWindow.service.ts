/**
 * Time Window Service
 *
 * High-level service for managing time windows:
 * - Generate optimal time windows for orders
 * - Save time windows to database
 * - Update performance metrics after delivery
 * - Query time windows
 */

import { AppDataSource } from '../../config/ormconfig';
import { TimeWindow } from '../../entities/TimeWindow';
import { Location } from '../../interfaces/Location';
import { getDistance } from '../routing/mapboxClient';
import {
  timeWindowCalculator,
  TimeWindowParams,
  DEFAULT_TIME_WINDOW_PARAMS,
  CalculatedTimeWindow,
} from './timeWindowCalculator';
import { observationQueryService } from './observationQuery';

/**
 * Input for generating a time window
 */
export interface GenerateTimeWindowInput {
  orderId: string;
  driverId: string;
  expectedArrival: Date;
  routeSegment: {
    from: Location;
    to: Location;
  };
  params?: Partial<TimeWindowParams>;
  /**
   * Optional: Explicitly provide routed distance (from Google Maps)
   * If provided, uses this instead of querying observations
   * Allows time windows to use actual road distances
   */
  routedDistanceMeters?: number;
}

/**
 * Time Window Service
 */
export class TimeWindowService {
  private repository = AppDataSource.getRepository(TimeWindow);

  /**
   * Generate and save optimal time window for an order
   * Automatically selects best method based on data availability
   * Supports Google Maps distances for more accurate travel time estimation
   */
  async generateTimeWindow(input: GenerateTimeWindowInput): Promise<TimeWindow> {
    // Query historical observations for this route segment
    const observations = await observationQueryService.findObservationsForSegment({
      from: input.routeSegment.from,
      to: input.routeSegment.to,
      radiusKm: 1.0,
      maxAge: 30,
    });

    // Determine method based on data availability
    const params: TimeWindowParams = {
      ...DEFAULT_TIME_WINDOW_PARAMS,
      ...input.params,
      method: observations.length >= 30 ? 'stochastic_saa' : 'simple_heuristic',
    };

    console.log(
      `🎯 Generating time window for order ${input.orderId} using ${params.method} (${observations.length} observations)`
    );

    // Calculate optimal window
    const calculated = timeWindowCalculator.calculateTimeWindow(
      input.expectedArrival,
      observations,
      params
    );

    // Create entity
    const timeWindow = this.repository.create({
      orderId: input.orderId,
      driverId: input.driverId,
      lowerBound: calculated.lowerBound,
      upperBound: calculated.upperBound,
      windowWidthSeconds: calculated.windowWidthSeconds,
      expectedArrival: calculated.expectedArrival,
      confidenceLevel: calculated.confidenceLevel,
      violationProbability: calculated.violationProbability,
      penaltyWidth: params.penalties.width,
      penaltyEarly: params.penalties.early,
      penaltyLate: params.penalties.late,
      calculationMethod: calculated.method,
      sampleCount: calculated.sampleCount,
      travelTimeStdDev: calculated.travelTimeStdDev,
      coefficientOfVariation: calculated.coefficientOfVariation,
    });

    // Save to database
    const saved = await this.repository.save(timeWindow);

    console.log(
      `✅ Time window saved: [${calculated.lowerBound.toISOString()}] - [${calculated.upperBound.toISOString()}] (${(calculated.windowWidthSeconds / 60).toFixed(1)} min)`
    );

    return saved;
  }

  /**
   * Generate time window using Mapbox distance for accurate travel time
   * Uses actual routed distance instead of observations
   * Better for real-time route generation
   */
  async generateTimeWindowWithMapbox(input: GenerateTimeWindowInput): Promise<TimeWindow> {
    let routedDistance: number | undefined = input.routedDistanceMeters;
    let distanceSource = 'provided';

    // If routed distance not explicitly provided, calculate from Mapbox API
    if (!routedDistance) {
      try {
        const result = await getDistance(
          input.routeSegment.from,
          input.routeSegment.to
        );
        routedDistance = result.distance_m;
        distanceSource = 'Mapbox';
      } catch (error) {
        console.error(
          `❌ Mapbox distance calculation failed for order ${input.orderId}:`,
          error
        );
        throw error;
      }
    }

    // If we have a routed distance, use it to refine expected arrival
    let refinedExpectedArrival = input.expectedArrival;
    if (routedDistance) {
      // Average urban delivery speed: 35 km/h
      const averageSpeedKmPerHour = 35;
      const estimatedTravelTimeMinutes = (routedDistance / 1000) * (60 / averageSpeedKmPerHour);
      const serviceTimeMinutes = 5; // Pickup/dropoff time

      // Refine expected arrival based on actual distance
      refinedExpectedArrival = new Date(
        input.expectedArrival.getTime() +
          (estimatedTravelTimeMinutes + serviceTimeMinutes) * 60 * 1000
      );

      console.log(
        `📍 Using Mapbox distance (${routedDistance}m via ${distanceSource}) for time window calculation`
      );
    }

    // Query historical observations for variance estimates
    const observations = await observationQueryService.findObservationsForSegment({
      from: input.routeSegment.from,
      to: input.routeSegment.to,
      radiusKm: 1.0,
      maxAge: 30,
    });

    // Determine method based on data availability
    const params: TimeWindowParams = {
      ...DEFAULT_TIME_WINDOW_PARAMS,
      ...input.params,
      method: observations.length >= 30 ? 'stochastic_saa' : 'simple_heuristic',
    };

    console.log(
      `🎯 Generating Mapbox-aware time window for order ${input.orderId} using ${params.method}`
    );

    // Calculate optimal window with refined arrival time
    const calculated = timeWindowCalculator.calculateTimeWindow(
      refinedExpectedArrival,
      observations,
      params
    );

    // Create entity with Mapbox metadata
    const timeWindow = this.repository.create({
      orderId: input.orderId,
      driverId: input.driverId,
      lowerBound: calculated.lowerBound,
      upperBound: calculated.upperBound,
      windowWidthSeconds: calculated.windowWidthSeconds,
      expectedArrival: calculated.expectedArrival,
      confidenceLevel: calculated.confidenceLevel,
      violationProbability: calculated.violationProbability,
      penaltyWidth: params.penalties.width,
      penaltyEarly: params.penalties.early,
      penaltyLate: params.penalties.late,
      calculationMethod: `${calculated.method}_Mapbox`,
      sampleCount: calculated.sampleCount,
      travelTimeStdDev: calculated.travelTimeStdDev,
      coefficientOfVariation: calculated.coefficientOfVariation,
    });

    // Save to database
    const saved = await this.repository.save(timeWindow);

    console.log(
      `✅ Mapbox time window saved: [${calculated.lowerBound.toISOString()}] - [${calculated.upperBound.toISOString()}] (${(calculated.windowWidthSeconds / 60).toFixed(1)} min, distance: ${routedDistance}m)`
    );

    return saved;
  }

  /**
   * Update time window with actual performance
   * Called after delivery completion
   */
  async updatePerformance(
    orderId: string,
    actualArrival: Date
  ): Promise<TimeWindow | null> {
    const timeWindow = await this.repository.findOne({ where: { orderId } });

    if (!timeWindow) {
      console.warn(`⚠️  Time window not found for order ${orderId}`);
      return null;
    }

    // Calculate deviation
    const expectedTime = timeWindow.expectedArrival.getTime();
    const actualTime = actualArrival.getTime();
    const deviationSeconds = Math.round((actualTime - expectedTime) / 1000);

    // Check if within window
    const wasWithinWindow =
      actualTime >= timeWindow.lowerBound.getTime() &&
      actualTime <= timeWindow.upperBound.getTime();

    // Update entity
    timeWindow.actualArrival = actualArrival;
    timeWindow.wasWithinWindow = wasWithinWindow;
    timeWindow.deviationSeconds = deviationSeconds;

    await this.repository.save(timeWindow);

    const status = wasWithinWindow ? '✅' : '❌';
    console.log(
      `${status} Time window performance: order ${orderId}, deviation ${(deviationSeconds / 60).toFixed(1)} min, within window: ${wasWithinWindow}`
    );

    return timeWindow;
  }

  /**
   * Get time window for an order
   */
  async getTimeWindow(orderId: string): Promise<TimeWindow | null> {
    return await this.repository.findOne({ where: { orderId } });
  }

  /**
   * Get time windows for a driver
   */
  async getDriverTimeWindows(driverId: string): Promise<TimeWindow[]> {
    return await this.repository.find({
      where: { driverId },
      order: { expectedArrival: 'ASC' },
    });
  }

  /**
   * Calculate violation rate for a driver or globally
   */
  async calculateViolationRate(driverId?: string): Promise<{
    total: number;
    violations: number;
    rate: number;
    avgDeviationSeconds: number;
  }> {
    const queryBuilder = this.repository
      .createQueryBuilder('tw')
      .where('tw.actualArrival IS NOT NULL'); // Only completed deliveries

    if (driverId) {
      queryBuilder.andWhere('tw.driverId = :driverId', { driverId });
    }

    const timeWindows = await queryBuilder.getMany();

    if (timeWindows.length === 0) {
      return { total: 0, violations: 0, rate: 0, avgDeviationSeconds: 0 };
    }

    const violations = timeWindows.filter(tw => !tw.wasWithinWindow).length;
    const rate = violations / timeWindows.length;

    const totalDeviation = timeWindows.reduce(
      (sum, tw) => sum + Math.abs(tw.deviationSeconds ?? 0),
      0
    );
    const avgDeviationSeconds = totalDeviation / timeWindows.length;

    return {
      total: timeWindows.length,
      violations,
      rate,
      avgDeviationSeconds,
    };
  }

  /**
   * Get performance metrics summary
   */
  async getPerformanceMetrics(): Promise<{
    totalWindows: number;
    violationRate: number;
    avgWindowWidthMinutes: number;
    avgDeviationMinutes: number;
    methodDistribution: Record<string, number>;
  }> {
    const allWindows = await this.repository.find({
      where: { actualArrival: Not(null) as any },
    });

    if (allWindows.length === 0) {
      return {
        totalWindows: 0,
        violationRate: 0,
        avgWindowWidthMinutes: 0,
        avgDeviationMinutes: 0,
        methodDistribution: {},
      };
    }

    const violations = allWindows.filter(tw => !tw.wasWithinWindow).length;
    const violationRate = violations / allWindows.length;

    const avgWindowWidthMinutes =
      allWindows.reduce((sum, tw) => sum + tw.windowWidthSeconds, 0) /
      allWindows.length /
      60;

    const avgDeviationMinutes =
      allWindows.reduce((sum, tw) => sum + Math.abs(tw.deviationSeconds ?? 0), 0) /
      allWindows.length /
      60;

    const methodDistribution: Record<string, number> = {};
    allWindows.forEach(tw => {
      methodDistribution[tw.calculationMethod] =
        (methodDistribution[tw.calculationMethod] ?? 0) + 1;
    });

    return {
      totalWindows: allWindows.length,
      violationRate,
      avgWindowWidthMinutes,
      avgDeviationMinutes,
      methodDistribution,
    };
  }
}

// Import Not from typeorm for the query
import { Not } from 'typeorm';

/**
 * Singleton instance
 */
export const timeWindowService = new TimeWindowService();
