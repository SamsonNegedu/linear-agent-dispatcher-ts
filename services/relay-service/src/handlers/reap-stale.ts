import { ScheduledEvent } from 'aws-lambda';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { RelayModule } from '../relay.module';
import { SubscriberService } from '../subscriber/subscriber.service';

let app: INestApplicationContext | undefined;

async function bootstrap() {
  if (!app) {
    app = await NestFactory.createApplicationContext(RelayModule);
  }
  return app;
}

const STALE_THRESHOLD_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

/**
 * Scheduled Lambda handler: delete stale subscribers inactive for 14+ days
 * Triggered daily via CloudWatch Events
 */
export async function main(_event: ScheduledEvent): Promise<void> {
  const app = await bootstrap();

  try {
    const subscriberService = app.get(SubscriberService);
    const deleted = await subscriberService.deleteStaleSubscribers(STALE_THRESHOLD_MS);
    console.log(`[Reap Stale] Deleted ${deleted} inactive subscribers`);
  } catch (error) {
    console.error('[Reap Stale] Error:', error);
    throw error;
  }
}
