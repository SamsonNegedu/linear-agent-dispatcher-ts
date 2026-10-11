import { Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LinearGraphQLClient } from '@linear-agent/linear-client';
import { AdapterRegistry } from '@webhook-verify/core';
import type { DispatchAdapter } from '@webhook-verify/core';
import { RelayWebhookController } from './relay-webhook.controller';
import { DispatcherService } from '../dispatcher/dispatcher.service';
import { WebhookQueueService } from './webhook-queue.service';
import { RelayHealthService } from './relay-health.service';
import { WebhookQueueEntity } from '../../store/typeorm/webhook-queue.entity';
import { StoreModule } from '../../store/store.module';
import { ExecutorModule } from '../executor/executor.module';
import { PreflightModule } from '../../ops/preflight/preflight.module';
import { NullIssueContextResolver } from '../dispatcher/null-issue-context-resolver';
import { LinearDispatchAdapter } from '../dispatcher/linear-dispatch.adapter';
import { RoutingConfigService } from '../../config/routing-config.service';
import { ActivityNotifierService } from '../executor/activity-notifier.service';
import { IssueCommentService } from '../executor/issue-comment.service';
import type { DispatcherConfig } from '../../config/config';

const issueContextResolverProvider: Provider = {
  provide: 'IIssueContextResolver',
  useFactory: (config: DispatcherConfig) =>
    config.linear.apiKey
      ? new LinearGraphQLClient(config.linear.apiKey)
      : new NullIssueContextResolver(),
  inject: ['DispatcherConfig'],
};

// Register one DispatchAdapter per provider here. DispatcherService resolves
// the right one per-event via event.provider, since every provider funnels
// through the same /webhooks/relay endpoint from relay-service.
const dispatchAdapterRegistryProvider: Provider = {
  provide: 'DispatchAdapterRegistry',
  useFactory: (
    routingConfig: RoutingConfigService,
    activityNotifier: ActivityNotifierService,
    issueComments: IssueCommentService,
  ) => {
    const registry = new AdapterRegistry<DispatchAdapter>();
    registry.register(new LinearDispatchAdapter(routingConfig, activityNotifier, issueComments));
    return registry;
  },
  inject: [RoutingConfigService, ActivityNotifierService, IssueCommentService],
};

@Module({
  imports: [
    PreflightModule,
    StoreModule,
    ExecutorModule,
    TypeOrmModule.forFeature([WebhookQueueEntity]),
  ],
  controllers: [RelayWebhookController],
  providers: [
    DispatcherService,
    WebhookQueueService,
    RelayHealthService,
    issueContextResolverProvider,
    dispatchAdapterRegistryProvider,
  ],
  exports: [RelayHealthService],
})
export class RelayModule {}
