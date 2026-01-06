/**
 * Time Window Calculator Service
 *
 * Implements service time window design algorithms from research paper:
 * "Service Time Window Design in Last-Mile Delivery"
 * by Hosseini, Rostami, Araghi (2025)
 *
 * Three methods supported:
 * 1. Simple Heuristic: Conservative buffer-based (no historical data needed)
 * 2. Stochastic SAA: Quantile-based using historical observations (Proposition 2.4)
 * 3. Distributionally Robust: Worst-case guarantee with mean+covariance (future)
 */

import { RouteSegmentObservation } from '../../entities/RouteSegmentObservation';

/**
 * Time window calculation parameters
 * Based on paper's cost function: H^k = a_w·(u-ℓ) + a_ℓ·E[earliness] + a_u·E[lateness]
 */
export interface TimeWindowParams {
  // Service level target (e.g., 0.95 = 95% on-time probability)
  confidenceLevel: number;

  // Penalty parameters (paper's a_w, a_ℓ, a_u)
  penalties: {
    width: number;  // a_w: cost per second of window width
    early: number;  // a_ℓ: cost of early arrival
    late: number;   // a_u: cost of late arrival
  };

  // Method selection
  method: 'simple_heuristic' | 'stochastic_saa' | 'distributionally_robust';
}

/**
 * Calculated time window result
 */
export interface CalculatedTimeWindow {
  lowerBound: Date;
  upperBound: Date;
  windowWidthSeconds: number;
  expectedArrival: Date;
  confidenceLevel: number;
  violationProbability: number;
  method: string;

  // Method-specific metadata
  sampleCount?: number;
  travelTimeStdDev?: number;
  coefficientOfVariation?: number;
}

/**
 * Default parameters for time window calculation
 * Paper guidance: penalty ratios determine service guarantee level
 */
export const DEFAULT_TIME_WINDOW_PARAMS: TimeWindowParams = {
  confidenceLevel: 0.95, // 95% on-time target
  penalties: {
    width: 1.0,   // Base cost of wide windows
    early: 2.0,   // Early arrival less problematic
    late: 5.0,    // Late arrival very costly
  },
  method: 'simple_heuristic', // Start conservative, upgrade to SAA later
};

/**
 * Time Window Calculator
 * Generates optimal service time windows with confidence guarantees
 */
export class TimeWindowCalculator {
  /**
   * Calculate optimal time window using specified method
   */
  calculateTimeWindow(
    expectedArrival: Date,
    observations: RouteSegmentObservation[],
    params: TimeWindowParams = DEFAULT_TIME_WINDOW_PARAMS
  ): CalculatedTimeWindow {
    // Validate inputs
    this.validateInputs(expectedArrival, params);

    // Route to appropriate method
    switch (params.method) {
      case 'simple_heuristic':
        return this.calculateSimpleHeuristicWindow(expectedArrival, params);

      case 'stochastic_saa':
        if (observations.length < 30) {
          console.warn(
            `⚠️  Only ${observations.length} observations available, need 30+ for SAA. Falling back to heuristic.`
          );
          return this.calculateSimpleHeuristicWindow(expectedArrival, params);
        }
        return this.calculateSAAWindow(expectedArrival, observations, params);

      case 'distributionally_robust':
        throw new Error('Distributionally robust method not yet implemented');

      default:
        throw new Error(`Unknown method: ${params.method}`);
    }
  }

  /**
   * PHASE 1: Simple Heuristic Window (No historical data required)
   *
   * Conservative approach: expectedArrival ± buffer
   * Buffer size based on confidence level and penalty ratios
   *
   * Rationale: Better to overestimate than underestimate initially
   */
  private calculateSimpleHeuristicWindow(
    expectedArrival: Date,
    params: TimeWindowParams
  ): CalculatedTimeWindow {
    // Calculate buffer based on confidence level
    // Higher confidence → wider buffer
    const baseBufferMinutes = 15; // Conservative baseline
    const confidenceFactor = 1 + (params.confidenceLevel - 0.5) * 2; // 0.95 → 1.9x
    const bufferMinutes = baseBufferMinutes * confidenceFactor;

    // Asymmetric buffer based on early vs late penalties
    // If late penalty >> early penalty → make lower bound tighter
    const penaltyRatio = params.penalties.late / params.penalties.early;
    const asymmetryFactor = Math.sqrt(penaltyRatio); // e.g., 5/2 = 2.5 → 1.58x

    const lowerBufferMinutes = bufferMinutes / asymmetryFactor;
    const upperBufferMinutes = bufferMinutes * asymmetryFactor;

    const lowerBound = new Date(
      expectedArrival.getTime() - lowerBufferMinutes * 60 * 1000
    );
    const upperBound = new Date(
      expectedArrival.getTime() + upperBufferMinutes * 60 * 1000
    );

    const windowWidthSeconds = Math.round(
      (upperBound.getTime() - lowerBound.getTime()) / 1000
    );

    return {
      lowerBound,
      upperBound,
      windowWidthSeconds,
      expectedArrival,
      confidenceLevel: params.confidenceLevel,
      violationProbability: 1 - params.confidenceLevel,
      method: 'simple_heuristic',
    };
  }

  /**
   * PHASE 2: Sample Average Approximation (SAA) - Paper's Proposition 2.4
   *
   * Uses historical observations to calculate quantile-based bounds
   * "Optimal bounds = specific quantiles of sample distribution"
   *
   * Algorithm:
   * 1. Sort historical actual arrival times
   * 2. Calculate quantiles based on confidence level
   * 3. Lower bound = α/2 quantile, Upper bound = (1-α/2) quantile
   *
   * Example: 95% confidence (α=0.05)
   *   → Lower = 2.5th percentile
   *   → Upper = 97.5th percentile
   *
   * Robustness: Works even if expectedArrival estimate is poor!
   * The empirical distribution from samples is the ground truth.
   */
  private calculateSAAWindow(
    expectedArrival: Date,
    observations: RouteSegmentObservation[],
    params: TimeWindowParams
  ): CalculatedTimeWindow {
    // Extract actual travel times from observations
    const actualSeconds = observations.map(obs => obs.actualSeconds);

    // Calculate statistics
    const mean = this.calculateMean(actualSeconds);
    const stdDev = this.calculateStdDev(actualSeconds, mean);
    const cv = stdDev / mean; // Coefficient of variation

    // Sort for quantile calculation
    const sorted = [...actualSeconds].sort((a, b) => a - b);

    // Calculate quantiles based on confidence level
    // α = 1 - confidence (e.g., 0.95 confidence → α = 0.05)
    const alpha = 1 - params.confidenceLevel;

    // Symmetric bounds around confidence interval
    const lowerQuantile = alpha / 2;      // e.g., 0.025 for 95%
    const upperQuantile = 1 - alpha / 2;  // e.g., 0.975 for 95%

    // Calculate quantile indices
    const lowerIndex = Math.floor(sorted.length * lowerQuantile);
    const upperIndex = Math.ceil(sorted.length * upperQuantile) - 1;

    // Get quantile values (actual seconds from samples)
    const lowerSeconds = sorted[lowerIndex];
    const upperSeconds = sorted[upperIndex];

    // Convert to absolute timestamps
    // Use mean as the center (more robust than potentially bad expectedArrival)
    const baseTime = expectedArrival.getTime();
    const lowerBound = new Date(baseTime + (lowerSeconds - mean) * 1000);
    const upperBound = new Date(baseTime + (upperSeconds - mean) * 1000);

    const windowWidthSeconds = Math.round(
      (upperBound.getTime() - lowerBound.getTime()) / 1000
    );

    return {
      lowerBound,
      upperBound,
      windowWidthSeconds,
      expectedArrival,
      confidenceLevel: params.confidenceLevel,
      violationProbability: 1 - params.confidenceLevel,
      method: 'stochastic_saa',
      sampleCount: observations.length,
      travelTimeStdDev: stdDev,
      coefficientOfVariation: cv,
    };
  }

  /**
   * Validate inputs before calculation
   */
  private validateInputs(expectedArrival: Date, params: TimeWindowParams): void {
    if (!(expectedArrival instanceof Date) || isNaN(expectedArrival.getTime())) {
      throw new Error('Invalid expectedArrival date');
    }

    if (params.confidenceLevel < 0.5 || params.confidenceLevel > 0.99) {
      throw new Error('Confidence level must be between 0.5 and 0.99');
    }

    if (params.penalties.width <= 0 || params.penalties.early <= 0 || params.penalties.late <= 0) {
      throw new Error('All penalty values must be positive');
    }

    // Sanity check: expected arrival should be in reasonable future
    const now = new Date();
    const hoursUntilArrival = (expectedArrival.getTime() - now.getTime()) / (1000 * 3600);

    if (hoursUntilArrival < 0) {
      throw new Error('Expected arrival cannot be in the past');
    }

    if (hoursUntilArrival > 24) {
      console.warn(`⚠️  Expected arrival is ${hoursUntilArrival.toFixed(1)}h in future (>24h)`);
    }
  }

  /**
   * Calculate mean of array
   */
  private calculateMean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  /**
   * Calculate standard deviation
   */
  private calculateStdDev(values: number[], mean?: number): number {
    if (values.length === 0) return 0;

    const m = mean ?? this.calculateMean(values);
    const variance = values.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / values.length;

    return Math.sqrt(variance);
  }
}

/**
 * Singleton instance
 */
export const timeWindowCalculator = new TimeWindowCalculator();
