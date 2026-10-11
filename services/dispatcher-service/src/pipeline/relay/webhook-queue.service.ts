import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { WebhookQueueEntity } from '../../store/typeorm/webhook-queue.entity';
import { DispatcherService } from '../dispatcher/dispatcher.service';
import type { NormalizedEvent } from '@webhook-verify/core';
import { randomUUID } from 'crypto';
import { errorMessage } from '../../common/error-message';

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
    void this.processNext();
  }

  async enqueue(payload: NormalizedEvent): Promise<void> {
    const id = randomUUID();
    const { webhookId, idempotencyKey } = payload;
    const payloadJson = JSON.stringify(payload);

    try {
      await this.queueRepository.insert({
        id,
        idempotencyKey,
        webhookId,
        payload: payloadJson,
        status: 'queued',
      });
      this.logger.debug(
        `webhook.queued issue=${payload.issueIdentifier} idempotencyKey=${idempotencyKey} webhookId=${webhookId} row=${id}`,
      );
    } catch {
      // Unique constraint violation on idempotencyKey: duplicate delivery, already queued or processing
      // Silently return — the relay's duplicate will be handled by our unique constraint
      this.logger.debug(
        `webhook.duplicate issue=${payload.issueIdentifier} idempotencyKey=${idempotencyKey}`,
      );
      return;
    }

    // Trigger processing, fire-and-forget
    void this.processNext();
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

        const payload = JSON.parse(row.payload) as NormalizedEvent;

        try {
          await this.dispatcherService.dispatchWebhook(payload);
          // Success: delete the row
          await this.queueRepository.delete(row.id);
          this.logger.log(
            `webhook.processed issue=${payload.issueIdentifier} idempotencyKey=${row.idempotencyKey} row=${row.id}`,
          );
        } catch (error) {
          // Failure: mark as failed (no retry, since dispatchWebhook already posted error feedback to Linear)
          const message = errorMessage(error);
          await this.queueRepository.update(row.id, {
            status: 'failed',
            lastError: message,
          });
          this.logger.error(
            `webhook.process_failed issue=${payload.issueIdentifier} idempotencyKey=${row.idempotencyKey} row=${row.id} error="${message}"`,
          );
          // Continue to the next queued row — this one is now 'failed', not
          // 'queued', so the next iteration's query won't re-select it. An
          // earlier version of this loop broke here entirely, which stalled
          // every other unrelated queued webhook behind a single failure
          // until a fresh delivery arrived to kick processing again.
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }
}
