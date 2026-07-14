import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminAuthGuard } from './admin-auth.guard';
import { SubscriberModule } from '../subscriber/subscriber.module';
import { WebhookModule } from '../webhook/webhook.module';

@Module({
  imports: [SubscriberModule, WebhookModule],
  controllers: [AdminController],
  providers: [AdminAuthGuard],
})
export class AdminModule {}
