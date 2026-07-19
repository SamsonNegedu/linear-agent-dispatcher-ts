import { Entity, PrimaryColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('processed_webhooks')
@Index(['processedAt'])
export class ProcessedWebhookEntity {
  @PrimaryColumn('varchar', { length: 255 })
  idempotencyKey!: string;

  // Subscription/session ID, kept for reference/debugging only — it repeats
  // across distinct events so it must never carry a uniqueness constraint.
  @Column('varchar', { length: 255 })
  webhookId!: string;

  @CreateDateColumn()
  processedAt!: Date;
}
