import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { LineString } from 'geojson';

/**
 * Historical travel time observations for statistical modeling
 * Used for Sample Average Approximation (SAA) in time window calculation
 *
 * Each record captures one observed route segment with:
 * - What we estimated (from routing algorithm)
 * - What actually happened (real-world observation)
 * - Context (time of day, day of week, driver)
 *
 * Purpose: Build empirical distributions for travel time uncertainty
 * Algorithm: SAA quantile-based window bounds (Paper Proposition 2.4)
 */
@Entity('route_segment_observations')
@Index(['driverId'])
@Index(['timestamp'])
@Index(['timeOfDay', 'dayOfWeek'])
@Index(['routeSegment'], { spatial: true })
export class RouteSegmentObservation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Route segment as PostGIS LineString (from → to)
  // GeoJSON order: [lng, lat] for each coordinate point
  @Column({
    type: 'geometry',
    spatialFeatureType: 'LineString',
    srid: 4326,
    comment: 'Route segment as PostGIS LineString (start → end in SRID 4326)',
  })
  routeSegment!: LineString;

  // Travel time data
  @Column({ type: 'int', comment: 'Estimated travel time in seconds (from routing algorithm)' })
  estimatedSeconds!: number;

  @Column({ type: 'int', comment: 'Actual observed travel time in seconds' })
  actualSeconds!: number;

  @Column({ type: 'int', comment: 'Deviation: actual - estimated (seconds, can be negative)' })
  deviationSeconds!: number;

  // Distance calculated from PostGIS ST_Length (in meters)
  @Column({ type: 'float', comment: 'Distance calculated by PostGIS ST_Length using geography type (meters)' })
  distanceMeters!: number;

  // Contextual factors for segmentation
  @Column({ type: 'uuid', nullable: true })
  driverId?: string;

  @Column({
    type: 'varchar',
    length: 20,
    nullable: true,
    comment: 'Time bucket: morning (6-12), afternoon (12-18), evening (18-22), night (22-6)'
  })
  timeOfDay?: string;

  @Column({
    type: 'varchar',
    length: 20,
    nullable: true,
    comment: 'Day: monday, tuesday, wednesday, thursday, friday, saturday, sunday'
  })
  dayOfWeek?: string;

  @Column({
    type: 'varchar',
    length: 50,
    nullable: true,
    comment: 'Weather condition during travel (if available)'
  })
  weatherCondition?: string;

  @CreateDateColumn()
  timestamp!: Date;
}
