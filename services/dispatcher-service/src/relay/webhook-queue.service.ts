import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { WebhookQueueEntity } from '../store/typeorm/webhook-queue.entity';
import { DispatcherService } from '../dispatcher/dispatcher.service';
import type { VerifiedEvent } from '@webhook-verify/core';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class WebhookQueueService implements OnModuleInit {
  private readonly logger = new Logger(WebhookQueueService.name);
  private isProcessing = false;

  constructor(
    @InjectRepository(WebhookQueueEntity)
    private readonly queueRepository: Repository<WebhookQueueEntity>,
    private readonly dispatcherService: DispatcherService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Reset any rows stuck in 'processing' state from a crash
    await this.queueRepository.update({ status: 'processing' }, { status: 'queued' });
    // Pick up any queued rows left from restart
    this.processNext();
  }

  async enqueue(payload: VerifiedEvent): Promise<void> {
    const id = uuidv4();
    const webhookId = payload.webhookId;
    const payloadJson = JSON.stringify(payload);

    try {
      await this.queueRepository.insert({
        id,
        webhookId,
        payload: payloadJson,
        status: 'queued',
        attempts: 0,
      });
      this.logger.debug(`Enqueued webhook ${webhookId} (row: ${id})`);
    } catch (err) {
      // Unique constraint violation on webhookId: duplicate delivery, already queued or processing
      // Silently return — the relay's duplicate will be handled by our unique constraint
      this.logger.debug(`Webhook ${webhookId} already queued or processed (duplicate delivery)`);
      return;
    }

    // Trigger processing, fire-and-forget
    this.processNext();
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (true) {
        const row = await this.queueRepository.findOne({
          where: { status: 'queued' },
          order: { createdAt: 'ASC' },
        });

        if (!row) break;

        // Mark as processing
        await this.queueRepository.update(row.id, { status: 'processing' });

        try {
          const payload: VerifiedEvent = JSON.parse(row.payload);
          await this.dispatcherService.dispatchWebhook(payload);
          // Success: delete the row
          await this.queueRepository.delete(row.id);
          this.logger.log(`Processed webhook ${row.webhookId} (row: ${row.id})`);
        } catch (err) {
          // Failure: mark as failed (no retry, since dispatchWebhook already posted error feedback to Linear)
          const errorMessage = err instanceof Error ? err.message : String(err);
          await this.queueRepository.update(row.id, {
            status: 'failed',
            lastError: errorMessage,
            attempts: row.attempts + 1,
          });
          this.logger.error(`Failed to process webhook ${row.webhookId} (row: ${row.id}): ${errorMessage}`);
          // Stop processing to avoid hammering on the same error repeatedly
          break;
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }
}
