import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Order } from './Order';
import { Driver } from './Driver';
import { AssignmentStatus } from '../enums/AssignmentStatus';

@Entity('order_assignments')
export class OrderAssignment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'order_id' })
  orderId!: string;

  @Column({ type: 'uuid', name: 'driver_id' })
  driverId!: string;

  // Route sequence position
  @Column({ type: 'int', comment: 'Position in driver route sequence (1-based)' })
  sequence!: number;

  // Assignment lifecycle tracking
  @Column({
    type: 'enum',
    enum: AssignmentStatus,
    default: AssignmentStatus.OFFERED,
    comment: 'Assignment status in the offer-accept-reject lifecycle'
  })
  status!: AssignmentStatus;

  @Column({
    type: 'timestamp',
    nullable: true,
    comment: 'When this offer expires (auto-reject after timeout)'
  })
  offerExpiresAt?: Date;

  @Column({
    type: 'text',
    nullable: true,
    comment: 'Reason provided by driver for rejection'
  })
  rejectionReason?: string;

  @Column({
    type: 'timestamp',
    nullable: true,
    comment: 'When driver accepted or rejected this assignment'
  })
  respondedAt?: Date;

  @Column({
    type: 'int',
    default: 1,
    comment: 'Which draft cycle created this assignment'
  })
  offerRound!: number;

  // Estimated times (simple heuristic for initial assignment)
  @Column({ type: 'timestamp', comment: 'Estimated pickup time (before time window optimization)' })
  estimatedPickup!: Date;

  @Column({ type: 'timestamp', comment: 'Estimated delivery time (before time window optimization)' })
  estimatedDelivery!: Date;

  // Actual performance tracking
  @Column({ type: 'timestamp', nullable: true })
  actualPickup?: Date;

  @Column({ type: 'timestamp', nullable: true })
  actualDelivery?: Date;

  @CreateDateColumn()
  assignedAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @OneToOne(() => Order, (order) => order.assignment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order?: Order;

  @ManyToOne(() => Driver, (driver) => driver.assignments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'driver_id' })
  driver?: Driver;

  // Optimized service time window (generated after Stage 4 algorithm)
  // Stores algorithm result: [ℓ, u] bounds, confidence level, expected arrival, etc.
  @Column({ type: 'jsonb', nullable: true, comment: 'Time window optimization result from algorithm' })
  timeWindow?: {
    lowerBound: Date;
    upperBound: Date;
    expectedArrival: Date;
    windowWidthSeconds: number;
    confidenceLevel: number;
    violationProbability: number;
    penaltyWidth: number;
    penaltyEarly: number;
    penaltyLate: number;
    calculationMethod: string;
    sampleCount?: number;
    travelTimeStdDev?: number;
    coefficientOfVariation?: number;
  };
}
