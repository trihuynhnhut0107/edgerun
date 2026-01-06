import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Designed service time window for a delivery stop
 * Generated using optimization algorithm from research paper
 *
 * Based on: "Service Time Window Design in Last-Mile Delivery"
 * by Hosseini, Rostami, Araghi (2025)
 *
 * Algorithm minimizes: H^k = a_w·(u-ℓ) + a_ℓ·E[earliness] + a_u·E[lateness]
 * Where [ℓ, u] are the designed lower/upper bounds
 *
 * Two approaches supported:
 * 1. Stochastic (SAA): Uses historical samples, quantile-based bounds
 * 2. Distributionally Robust: Uses mean+covariance, worst-case guarantee
 */
@Entity('time_windows')
@Index(['orderId'])
@Index(['driverId'])
@Index(['lowerBound', 'upperBound'])
@Index(['calculationMethod'])
export class TimeWindow {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Associated order and driver
  @Column({ type: 'uuid', unique: true })
  orderId!: string;

  @Column({ type: 'uuid' })
  driverId!: string;

  // Designed time window bounds [ℓ, u] (DECISION VARIABLES from paper)
  @Column({ type: 'timestamp', comment: 'Lower bound ℓ: earliest service time' })
  lowerBound!: Date;

  @Column({ type: 'timestamp', comment: 'Upper bound u: latest service time' })
  upperBound!: Date;

  // Window metrics
  @Column({ type: 'int', comment: 'Window width in seconds: u - ℓ' })
  windowWidthSeconds!: number;

  // Expected arrival time (mean of travel time distribution)
  @Column({ type: 'timestamp', comment: 'Expected arrival time E[T^k]' })
  expectedArrival!: Date;

  // Confidence and risk metrics
  @Column({
    type: 'float',
    comment: 'Service level guarantee (0-1): P(arrival ∈ [ℓ,u]). e.g., 0.95 = 95% on-time probability'
  })
  confidenceLevel!: number;

  @Column({ type: 'float', comment: 'Violation probability: 1 - confidenceLevel' })
  violationProbability!: number;

  // Optimization parameters (from paper's cost function)
  @Column({ type: 'float', comment: 'Penalty a_w: cost per second of window width' })
  penaltyWidth!: number;

  @Column({ type: 'float', comment: 'Penalty a_ℓ: cost of early arrival' })
  penaltyEarly!: number;

  @Column({ type: 'float', comment: 'Penalty a_u: cost of late arrival' })
  penaltyLate!: number;

  // Model metadata
  @Column({
    type: 'varchar',
    length: 50,
    comment: 'Method: stochastic_saa | distributionally_robust | simple_heuristic'
  })
  calculationMethod!: string;

  @Column({ type: 'int', nullable: true, comment: 'Number of historical observations used (SAA)' })
  sampleCount?: number;

  @Column({ type: 'float', nullable: true, comment: 'Travel time standard deviation (seconds)' })
  travelTimeStdDev?: number;

  @Column({ type: 'float', nullable: true, comment: 'Coefficient of variation: σ/μ' })
  coefficientOfVariation?: number;

  // Performance tracking (filled after delivery)
  @Column({ type: 'timestamp', nullable: true })
  actualArrival?: Date;

  @Column({ type: 'boolean', nullable: true, comment: 'Whether actual ∈ [ℓ, u]' })
  wasWithinWindow?: boolean;

  @Column({ type: 'int', nullable: true, comment: 'Deviation in seconds: negative=early, positive=late' })
  deviationSeconds?: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
