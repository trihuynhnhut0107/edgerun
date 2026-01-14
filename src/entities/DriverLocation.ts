import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  JoinColumn,
} from 'typeorm';
import { Point } from 'geojson';
import { Driver } from './Driver';

@Entity('driver_locations')
export class DriverLocation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'driver_id' })
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
  @JoinColumn({ name: 'driver_id' })
  driver?: Driver;
}
