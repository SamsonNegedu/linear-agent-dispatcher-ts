import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { ProcessedWebhookEntity } from '../../store/typeorm/processed-webhook.entity';
import { WebhookQueueEntity } from '../../store/typeorm/webhook-queue.entity';
import { errorMessage } from '../../common/error-message';

export const WEBHOOK_RETENTION_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 60_000;

/**
 * Deletes `failed` queue rows and `processed_webhooks` keys older than
 * WEBHOOK_RETENTION_DAYS, so neither table grows without bound. Runs once
 * shortly after startup, then daily.
 */
@Injectable()
export class WebhookRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookRetentionService.name);
  private firstRun?: ReturnType<typeof setTimeout>;
  private daily?: ReturnType<typeof setInterval>;

  constructor(
    @InjectRepository(WebhookQueueEntity)
    private readonly queueRepository: Repository<WebhookQueueEntity>,
    @InjectRepository(ProcessedWebhookEntity)
    private readonly processedRepository: Repository<ProcessedWebhookEntity>,
  ) {}

  onModuleInit(): void {
    this.firstRun = setTimeout(() => void this.cleanup(), FIRST_RUN_DELAY_MS);
    this.firstRun.unref?.();
    this.daily = setInterval(() => void this.cleanup(), DAY_MS);
    this.daily.unref?.();
  }

  onModuleDestroy(): void {
    if (this.firstRun) clearTimeout(this.firstRun);
    if (this.daily) clearInterval(this.daily);
  }

  async cleanup(now: Date = new Date()): Promise<void> {
    const cutoff = new Date(now.getTime() - WEBHOOK_RETENTION_DAYS * DAY_MS);
    try {
      const failed = await this.queueRepository.delete({
        status: 'failed',
        updatedAt: LessThan(cutoff),
      });
      const processed = await this.processedRepository.delete({ processedAt: LessThan(cutoff) });
      this.logger.log(
        `webhook.retention failedRows=${failed.affected ?? 0} processedKeys=${processed.affected ?? 0} olderThanDays=${WEBHOOK_RETENTION_DAYS}`,
      );
    } catch (error) {
      this.logger.error(`webhook.retention_failed error="${errorMessage(error)}"`);
    }
  }
}
