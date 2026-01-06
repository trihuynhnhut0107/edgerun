import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  Index,
  CreateDateColumn,
  JoinColumn,
} from 'typeorm';
import { Point } from 'geojson';
import { Driver } from './Driver';

@Entity('driver_locations')
@Index(['driverId', 'timestamp'])
@Index(['driverId'])
@Index(['location'], { spatial: true })
export class DriverLocation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  driverId!: string;

  // Geographic location as PostGIS Point (lng, lat in GeoJSON order)
  @Column({
    type: 'geometry',
    spatialFeatureType: 'Point',
    srid: 4326,
    comment: 'Driver location as PostGIS Point (longitude, latitude in SRID 4326)',
  })
  location!: Point;

  // Heading and speed for trajectory analysis
  @Column({ type: 'float', nullable: true, comment: 'Heading in degrees (0-360)' })
  heading?: number;

  @Column({ type: 'float', nullable: true, comment: 'Speed in km/h' })
  speed?: number;

  @CreateDateColumn()
  timestamp!: Date;

  @ManyToOne(() => Driver, (driver) => driver.locations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'driverId' })
  driver?: Driver;
}
