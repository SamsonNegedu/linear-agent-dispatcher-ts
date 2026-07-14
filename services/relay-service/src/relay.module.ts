import { Module } from '@nestjs/common';
import { WebhookModule } from './webhook/webhook.module';
import { SubscriberModule } from './subscriber/subscriber.module';
import { AdminModule } from './admin/admin.module';
import { ConfigModule } from './config/config.module';
import { ConfigValidatorService } from './config/config-validator.service';

@Module({
  imports: [ConfigModule, WebhookModule, SubscriberModule, AdminModule],
  providers: [ConfigValidatorService],
  exports: [SubscriberModule],
})
export class RelayModule {}
