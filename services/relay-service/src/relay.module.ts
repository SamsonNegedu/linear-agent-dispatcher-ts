import { Module } from '@nestjs/common';
import { WebhookModule } from './webhook/webhook.module';
import { SubscriberModule } from './subscriber/subscriber.module';
import { ConfigModule } from './config/config.module';
import { ConfigValidatorService } from './config/config-validator.service';

@Module({
  imports: [ConfigModule, WebhookModule, SubscriberModule],
  providers: [ConfigValidatorService],
  exports: [SubscriberModule],
})
export class RelayModule {}
