import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DriverLocation } from './DriverLocation';
import { OrderAssignment } from './OrderAssignment';
import { DriverStatus } from '../enums/DriverStatus';

@Entity('drivers')
export class Driver {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 20, unique: true })
  phone!: string;

  @Column({ type: 'varchar', length: 50 })
  vehicleType!: string; // 'bike', 'scooter', 'car'

  @Column({ type: 'int', default: 3 })
  maxOrders!: number;

  @Column({ type: 'enum', enum: DriverStatus, default: DriverStatus.OFFLINE })
  status!: DriverStatus;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @OneToMany(() => DriverLocation, (location) => location.driver, { cascade: true })
  locations!: DriverLocation[];

  @OneToMany(() => OrderAssignment, (assignment) => assignment.driver, { cascade: true })
  assignments!: OrderAssignment[];
}
