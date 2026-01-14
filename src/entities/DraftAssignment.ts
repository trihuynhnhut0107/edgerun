import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from "typeorm";
import { DraftGroup } from "./DraftGroup";
import { Driver } from "./Driver";
import { Order } from "./Order";

@Entity("draft_assignments")
export class DraftAssignment {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "int", name: "draft_group_id" })
  draftGroupId!: number;

  @Column({ type: "uuid", name: "driver_id" })
  driverId!: string;

  @Column({ type: "uuid", name: "order_id" })
  orderId!: string;

  @Column({
    type: "int",
    comment: "Position in driver route sequence (1-based)",
  })
  sequence!: number;

  @Column({
    type: "timestamp",
    comment: "Estimated pickup time",
  })
  estimatedPickupTime!: Date;

  @Column({
    type: "timestamp",
    comment: "Estimated delivery time",
  })
  estimatedDeliveryTime!: Date;

  @Column({
    type: "float",
    comment: "Travel time from previous stop to pickup (minutes)",
  })
  travelTimeToPickup!: number;

  @Column({
    type: "float",
    comment: "Travel time from pickup to delivery (minutes)",
  })
  travelTimeToDelivery!: number;

  @Column({
    type: "jsonb",
    nullable: true,
    comment: "Additional metadata about this assignment",
  })
  metadata?: {
    insertionCost: number;
    distanceToPickup: number;
    distanceToDelivery: number;
    previousStopLocation?: { lat: number; lng: number };
  };

  @CreateDateColumn()
  createdAt!: Date;

  // Relations
  @ManyToOne(() => DraftGroup, (group) => group.assignments, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "draft_group_id" })
  draftGroup!: DraftGroup;

  @ManyToOne(() => Driver, { onDelete: "CASCADE" })
  @JoinColumn({ name: "driver_id" })
  driver!: Driver;

  @ManyToOne(() => Order, { onDelete: "CASCADE" })
  @JoinColumn({ name: "order_id" })
  order!: Order;
}
