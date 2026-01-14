import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
} from 'typeorm';
import { DraftAssignment } from './DraftAssignment';

@Entity('draft_groups')
export class DraftGroup {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({
    type: 'uuid',
    comment: 'Links groups from same optimization run'
  })
  sessionId!: string;

  @Column({
    type: 'float',
    comment: 'Sum of all travel times in minutes'
  })
  totalTravelTime!: number;

  @Column({
    type: 'float',
    comment: 'Sum of all distances in meters'
  })
  totalDistance!: number;

  @Column({
    type: 'float',
    comment: 'Average time to pickup across all orders'
  })
  averagePickupTime!: number;

  @Column({ type: 'int', comment: 'Number of orders in this draft group' })
  ordersCount!: number;

  @Column({ type: 'int', comment: 'Number of drivers in this draft group' })
  driversCount!: number;

  @Column({
    type: 'jsonb',
    comment: 'Algorithm metadata and performance metrics'
  })
  metadata!: {
    algorithm: 'clarke-wright' | 'insertion' | 'alns';
    computationTimeMs: number;
    qualityScore: number;
    constraintsViolated: string[];
  };

  @Column({
    type: 'boolean',
    default: false,
    comment: 'True if this is the selected/winning draft group'
  })
  isSelected!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @OneToMany(() => DraftAssignment, (assignment) => assignment.draftGroup, {
    cascade: true,
  })
  assignments!: DraftAssignment[];
}
