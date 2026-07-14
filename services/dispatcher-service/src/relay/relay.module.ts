import { Module } from '@nestjs/common';
import { RelayWebhookController } from './relay-webhook.controller';
import { DispatcherService } from '../dispatcher/dispatcher.service';
import { StoreModule } from '../store/store.module';
import { ExecutorModule } from '../executor/executor.module';
import { PreflightModule } from '../preflight/preflight.module';

@Module({
  imports: [PreflightModule, StoreModule, ExecutorModule],
  controllers: [RelayWebhookController],
  providers: [DispatcherService],
})
export class RelayModule {}
