import { Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LinearGraphQLClient } from '@linear-agent/linear-client';
import { RelayWebhookController } from './relay-webhook.controller';
import { DispatcherService } from '../dispatcher/dispatcher.service';
import { WebhookQueueService } from './webhook-queue.service';
import { RelayHealthService } from './relay-health.service';
import { WebhookQueueEntity } from '../../store/typeorm/webhook-queue.entity';
import { StoreModule } from '../../store/store.module';
import { ExecutorModule } from '../executor/executor.module';
import { PreflightModule } from '../../ops/preflight/preflight.module';
import { NullIssueContextResolver } from '../dispatcher/null-issue-context-resolver';
import type { DispatcherConfig } from '../../config/config';

const issueContextResolverProvider: Provider = {
  provide: 'IIssueContextResolver',
  useFactory: (config: DispatcherConfig) =>
    config.linear.apiKey ? new LinearGraphQLClient(config.linear.apiKey) : new NullIssueContextResolver(),
  inject: ['DispatcherConfig'],
};

@Module({
  imports: [PreflightModule, StoreModule, ExecutorModule, TypeOrmModule.forFeature([WebhookQueueEntity])],
  controllers: [RelayWebhookController],
  providers: [DispatcherService, WebhookQueueService, RelayHealthService, issueContextResolverProvider],
  exports: [RelayHealthService],
})
export class RelayModule {}
