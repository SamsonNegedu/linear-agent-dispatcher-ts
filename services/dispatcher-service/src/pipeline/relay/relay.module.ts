import { Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LinearGraphQLClient } from '@linear-agent/linear-client';
import { AdapterRegistry } from '@webhook-verify/core';
import type { DispatchAdapter } from '@webhook-verify/core';
import { RelayWebhookController } from './relay-webhook.controller';
import { DispatcherService } from '../dispatcher/dispatcher.service';
import { WebhookQueueService } from './webhook-queue.service';
import { RelayHealthService } from './relay-health.service';
import { WebhookRetentionService } from './webhook-retention.service';
import { ProcessedWebhookEntity } from '../../store/typeorm/processed-webhook.entity';
import { WebhookQueueEntity } from '../../store/typeorm/webhook-queue.entity';
import { StoreModule } from '../../store/store.module';
import { ExecutorModule } from '../executor/executor.module';
import { PreflightModule } from '../../ops/preflight/preflight.module';
import { LinearIssueContextResolver } from '../dispatcher/linear-issue-context-resolver';
import { LinearDispatchAdapter } from '../dispatcher/linear-dispatch.adapter';
import { RoutingConfigService } from '../../config/routing-config.service';
import { LinearRunReporter } from '../executor/linear-run-reporter';
import {
  ISSUE_CONTEXT_RESOLVER_REGISTRY,
  type IssueContextResolver,
} from '../dispatcher/issue-context-resolver.interface';
import type { DispatcherConfig } from '../../config/config';

// Register one IssueContextResolver per provider here. DispatcherService resolves the right one
// per event via event.provider.
const issueContextResolverRegistryProvider: Provider = {
  provide: ISSUE_CONTEXT_RESOLVER_REGISTRY,
  useFactory: (config: DispatcherConfig) => {
    const registry = new AdapterRegistry<IssueContextResolver>();
    const client = config.linear.apiKey ? new LinearGraphQLClient(config.linear.apiKey) : null;
    registry.register(new LinearIssueContextResolver(client));
    return registry;
  },
  inject: ['DispatcherConfig'],
};

// Register one DispatchAdapter per provider here. DispatcherService resolves
// the right one per-event via event.provider, since every provider funnels
// through the same /webhooks/relay endpoint from relay-service.
const dispatchAdapterRegistryProvider: Provider = {
  provide: 'DispatchAdapterRegistry',
  useFactory: (routingConfig: RoutingConfigService, feedback: LinearRunReporter) => {
    const registry = new AdapterRegistry<DispatchAdapter>();
    registry.register(new LinearDispatchAdapter(routingConfig, feedback));
    return registry;
  },
  inject: [RoutingConfigService, LinearRunReporter],
};

@Module({
  imports: [
    PreflightModule,
    StoreModule,
    ExecutorModule,
    TypeOrmModule.forFeature([WebhookQueueEntity, ProcessedWebhookEntity]),
  ],
  controllers: [RelayWebhookController],
  providers: [
    DispatcherService,
    WebhookQueueService,
    RelayHealthService,
    WebhookRetentionService,
    issueContextResolverRegistryProvider,
    dispatchAdapterRegistryProvider,
  ],
  exports: [RelayHealthService],
})
export class RelayModule {}
