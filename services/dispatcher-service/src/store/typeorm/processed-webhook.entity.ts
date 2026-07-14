import { Entity, PrimaryColumn, Column, CreateDateColumn, Index, Unique } from 'typeorm';

@Entity('processed_webhooks')
@Index(['processedAt'])
@Unique('UQ_webhook_id', ['webhookId'])
export class ProcessedWebhookEntity {
  @PrimaryColumn('varchar', { length: 255 })
  idempotencyKey!: string;

  @Column('varchar', { length: 255 })
  webhookId!: string;

  @CreateDateColumn()
  processedAt!: Date;
}
