import { Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LinearGraphQLClient, chooseAppCredential } from '@linear-agent/linear-client';
import { AdapterRegistry } from '@webhook-verify/core';
import type { DispatchAdapter } from '@webhook-verify/core';
import { RelayWebhookController } from './relay-webhook.controller';
import { DispatcherService } from '../dispatcher/dispatcher.service';
import { ScannerService } from '../scanner/scanner.service';
import { LINEAR_CLIENT } from '../linear-client.token';
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
const linearClientProvider: Provider = {
  provide: LINEAR_CLIENT,
  useFactory: (config: DispatcherConfig) => {
    const { apiKey, agentToken, oauthClientId, oauthClientSecret } = config.linear;
    const credential =
      apiKey ?? chooseAppCredential({ oauthClientId, oauthClientSecret, agentToken });
    return credential ? new LinearGraphQLClient(credential) : null;
  },
  inject: ['DispatcherConfig'],
};

const issueContextResolverRegistryProvider: Provider = {
  provide: ISSUE_CONTEXT_RESOLVER_REGISTRY,
  useFactory: (client: LinearGraphQLClient | null) => {
    const registry = new AdapterRegistry<IssueContextResolver>();
    registry.register(new LinearIssueContextResolver(client));
    return registry;
  },
  inject: [LINEAR_CLIENT],
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
    ScannerService,
    RelayHealthService,
    WebhookRetentionService,
    linearClientProvider,
    issueContextResolverRegistryProvider,
    dispatchAdapterRegistryProvider,
  ],
  exports: [RelayHealthService, ScannerService],
})
export class RelayModule {}
