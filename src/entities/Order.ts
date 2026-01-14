import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Point } from 'geojson';
import { OrderAssignment } from './OrderAssignment';
import { Customer } from './Customer';
import { OrderStatus } from '../enums/OrderStatus';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // CUSTOMER RELATIONSHIP
  @Column({ type: 'uuid', nullable: true })
  customerId?: string;

  @ManyToOne(() => Customer, (customer) => customer.orders, { nullable: true })
  @JoinColumn({ name: 'customerId' })
  customer?: Customer;

  // PICKUP LOCATION (required - from customer) - PostGIS Point geometry
  @Column({
    type: 'geometry',
    spatialFeatureType: 'Point',
    srid: 4326,
    comment: 'Pickup location as PostGIS Point (longitude, latitude in SRID 4326)',
  })
  pickupLocation!: Point;

  @Column({ type: 'varchar', length: 255 })
  pickupAddress!: string;

  // DROPOFF LOCATION (required - from customer) - PostGIS Point geometry
  @Column({
    type: 'geometry',
    spatialFeatureType: 'Point',
    srid: 4326,
    comment: 'Dropoff location as PostGIS Point (longitude, latitude in SRID 4326)',
  })
  dropoffLocation!: Point;

  @Column({ type: 'varchar', length: 255 })
  dropoffAddress!: string;

  // DELIVERY REQUEST (minimal customer input)
  @Column({
    type: 'date',
    comment: 'Requested delivery date - system will generate optimal time window after route optimization'
  })
  requestedDeliveryDate!: Date;

  @Column({
    type: 'varchar',
    length: 50,
    nullable: true,
    comment: 'Optional time preference: morning | afternoon | evening | null (flexible)'
  })
  preferredTimeSlot?: string;

  // ORDER METADATA
  @Column({
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.PENDING,
  })
  status!: OrderStatus;

  @Column({ type: 'int', default: 5, comment: 'Priority 1-10, higher = more urgent' })
  priority!: number;

  @Column({ type: 'float', default: 0, comment: 'Order value in dollars' })
  value!: number;

  // DISTANCE CACHE - Calculated on order creation
  @Column({
    type: 'float',
    nullable: true,
    comment: 'Estimated distance from pickup to dropoff in meters',
  })
  estimatedDistance?: number;

  @Column({
    type: 'float',
    nullable: true,
    comment: 'Estimated duration from pickup to dropoff in seconds',
  })
  estimatedDuration?: number;

  // ASSIGNMENT TRACKING
  @Column({
    type: 'text',
    array: true,
    default: '{}',
    comment: 'Driver IDs that have rejected this order'
  })
  rejectedDriverIds!: string[];

  @Column({
    type: 'int',
    default: 0,
    comment: 'Total number of rejections for this order'
  })
  rejectionCount!: number;

  @Column({
    type: 'float',
    default: 1.0,
    comment: 'Priority multiplier - increases with rejections'
  })
  priorityMultiplier!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @OneToOne(() => OrderAssignment, (assignment) => assignment.order, {
    eager: true,
  })
  assignment?: OrderAssignment;

  // COMPUTED METHODS
  getPriorityScore(): number {
    return this.priority * this.priorityMultiplier;
  }
}
