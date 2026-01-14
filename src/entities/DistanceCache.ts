import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';
import { Point } from 'geojson';

@Entity('distance_cache')
export class DistanceCache {
  @PrimaryColumn({
    type: 'varchar',
    length: 100,
    comment: 'Hash of origin + destination + profile'
  })
  id!: string;

  @Column({
    type: 'geometry',
    spatialFeatureType: 'Point',
    srid: 4326,
    comment: 'Origin location as PostGIS Point'
  })
  origin!: Point;

  @Column({
    type: 'geometry',
    spatialFeatureType: 'Point',
    srid: 4326,
    comment: 'Destination location as PostGIS Point'
  })
  destination!: Point;

  @Column({
    type: 'varchar',
    length: 50,
    comment: 'Mapbox routing profile (e.g., driving-traffic, cycling)'
  })
  profile!: string;

  @Column({
    type: 'float',
    comment: 'Distance in meters'
  })
  distance!: number;

  @Column({
    type: 'float',
    comment: 'Duration in seconds'
  })
  duration!: number;

  @Column({
    type: 'jsonb',
    nullable: true,
    comment: 'Optional GeoJSON route geometry'
  })
  routeGeometry?: any;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({
    type: 'timestamp',
    comment: 'Cache expiration time (TTL)'
  })
  expiresAt!: Date;
}
