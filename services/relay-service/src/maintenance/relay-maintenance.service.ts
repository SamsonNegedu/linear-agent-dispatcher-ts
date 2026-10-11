import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SUBSCRIBER_REGISTRY_REPOSITORY } from '../subscriber/subscriber-registry.provider';
import type { SubscriberRegistry } from '../subscriber/subscriber-registry.repository';
import { WEBHOOK_DELIVERIES_REPOSITORY } from '../webhook/webhook-deliveries.provider';
import type { WebhookDeliveries } from '../webhook/webhook-deliveries.repository';

const DAY_MS = 24 * 60 * 60 * 1000;
export const SUBSCRIBER_INACTIVE_MS = 14 * DAY_MS;
export const DELIVERY_RETENTION_MS = 30 * DAY_MS;

/** Housekeeping, once at startup and then daily: drop inactive subscribers and old delivery logs. */
@Injectable()
export class RelayMaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RelayMaintenanceService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(SUBSCRIBER_REGISTRY_REPOSITORY) private readonly subscribers: SubscriberRegistry,
    @Inject(WEBHOOK_DELIVERIES_REPOSITORY) private readonly deliveries: WebhookDeliveries,
  ) {}

  onModuleInit(): void {
    void this.run();
    this.timer = setInterval(() => void this.run(), DAY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async run(): Promise<void> {
    try {
      const subscribers = await this.subscribers.deleteStaleSubscribers(SUBSCRIBER_INACTIVE_MS);
      const deliveries = await this.deliveries.deleteOlderThan(DELIVERY_RETENTION_MS);
      if (subscribers || deliveries) {
        this.logger.log(
          `Deleted ${subscribers} inactive subscribers, ${deliveries} old delivery logs`,
        );
      }
    } catch (error) {
      this.logger.error(`Maintenance failed: ${error instanceof Error ? error.message : error}`);
    }
  }
}
