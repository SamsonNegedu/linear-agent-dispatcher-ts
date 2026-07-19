import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('webhook_queue')
@Index(['status', 'createdAt'])
@Index(['idempotencyKey'], { unique: true })
export class WebhookQueueEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Column('varchar', { length: 255 })
  idempotencyKey!: string;

  // Subscription/session ID, kept for reference/debugging only — repeats
  // across distinct events so it must never carry a uniqueness constraint.
  @Column('varchar', { length: 255 })
  webhookId!: string;

  @Column('text')
  payload!: string;

  @Column('varchar', { length: 20, default: 'queued' })
  status!: 'queued' | 'processing' | 'failed';

  @Column('text', { nullable: true })
  lastError?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
