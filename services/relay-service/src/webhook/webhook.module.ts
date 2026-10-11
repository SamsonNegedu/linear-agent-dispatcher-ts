import { Module, Provider } from '@nestjs/common';
import { DynamoDBModule } from '@dynamodb/client';
import { AdapterRegistry } from '@webhook-verify/core';
import type { WebhookIngestAdapter, RoutingResolver } from '@webhook-verify/core';
import { LinearIngestAdapter } from '@webhook-verify/core/linear';
import { LinearGraphQLClient } from '@linear-agent/linear-client';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import {
  webhookDeliveriesProvider,
  WEBHOOK_DELIVERIES_REPOSITORY,
} from './webhook-deliveries.provider';
import { SubscriberModule } from '../subscriber/subscriber.module';
import { LinearRoutingResolver } from './linear-routing.resolver';
import { NullRoutingResolver } from './null-routing.resolver';
import type { RelayServiceConfig } from '../config/relay-config';

// Register one WebhookIngestAdapter per provider here. Each provider still
// gets its own route on WebhookController (distinct signature headers/URL
// shapes), which resolves its adapter from this registry by provider key.
const ingestAdapterRegistryProvider: Provider = {
  provide: 'IngestAdapterRegistry',
  useFactory: () => {
    const registry = new AdapterRegistry<WebhookIngestAdapter<Buffer>>();
    registry.register(new LinearIngestAdapter());
    return registry;
  },
};

// Register one RoutingResolver per provider that needs to backfill missing
// routing info via an API call. A provider whose webhooks always carry
// full routing info doesn't need one registered.
const routingResolverRegistryProvider: Provider = {
  provide: 'RoutingResolverRegistry',
  useFactory: (config: RelayServiceConfig) => {
    const registry = new AdapterRegistry<RoutingResolver>();
    registry.register(
      config.linear.apiKey
        ? new LinearRoutingResolver(new LinearGraphQLClient(config.linear.apiKey))
        : new NullRoutingResolver(),
    );
    return registry;
  },
  inject: ['RelayServiceConfig'],
};

@Module({
  imports: [DynamoDBModule, SubscriberModule],
  controllers: [WebhookController],
  providers: [
    webhookDeliveriesProvider,
    WebhookService,
    WebhookDeliveryService,
    ingestAdapterRegistryProvider,
    routingResolverRegistryProvider,
  ],
  exports: [WebhookService, WebhookDeliveryService, WEBHOOK_DELIVERIES_REPOSITORY],
})
export class WebhookModule {}
