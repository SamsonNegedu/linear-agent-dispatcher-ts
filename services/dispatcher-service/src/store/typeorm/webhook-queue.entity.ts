import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('webhook_queue')
@Index(['status', 'createdAt'])
@Index(['webhookId'], { unique: true })
export class WebhookQueueEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Column('varchar', { length: 255, unique: true })
  webhookId!: string;

  @Column('text')
  payload!: string;

  @Column('varchar', { length: 20, default: 'queued' })
  status!: 'queued' | 'processing' | 'failed';

  @Column('int', { default: 0 })
  attempts!: number;

  @Column('text', { nullable: true })
  lastError?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
