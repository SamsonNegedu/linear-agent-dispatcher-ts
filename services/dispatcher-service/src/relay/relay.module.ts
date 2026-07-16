import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RelayWebhookController } from './relay-webhook.controller';
import { DispatcherService } from '../dispatcher/dispatcher.service';
import { WebhookQueueService } from './webhook-queue.service';
import { WebhookQueueEntity } from '../store/typeorm/webhook-queue.entity';
import { StoreModule } from '../store/store.module';
import { ExecutorModule } from '../executor/executor.module';
import { PreflightModule } from '../preflight/preflight.module';

@Module({
  imports: [PreflightModule, StoreModule, ExecutorModule, TypeOrmModule.forFeature([WebhookQueueEntity])],
  controllers: [RelayWebhookController],
  providers: [DispatcherService, WebhookQueueService],
})
export class RelayModule {}
