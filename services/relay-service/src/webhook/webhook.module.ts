import { Module } from '@nestjs/common';
import { DynamoDBModule } from '@dynamodb/client';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { webhookDeliveriesProvider, WEBHOOK_DELIVERIES_REPOSITORY } from './webhook-deliveries.provider';
import { SubscriberModule } from '../subscriber/subscriber.module';

@Module({
  imports: [DynamoDBModule, SubscriberModule],
  controllers: [WebhookController],
  providers: [webhookDeliveriesProvider, WebhookService, WebhookDeliveryService],
  exports: [WebhookService, WebhookDeliveryService, WEBHOOK_DELIVERIES_REPOSITORY],
})
export class WebhookModule {}
