import { Module } from '@nestjs/common';
import { WebhookModule } from './webhook/webhook.module';
import { SubscriberModule } from './subscriber/subscriber.module';
import { ConfigModule } from './config/config.module';
import { ConfigValidatorService } from './config/config-validator.service';
import { RelayMaintenanceService } from './maintenance/relay-maintenance.service';

@Module({
  imports: [ConfigModule, WebhookModule, SubscriberModule],
  providers: [ConfigValidatorService, RelayMaintenanceService],
  exports: [SubscriberModule],
})
export class RelayModule {}
