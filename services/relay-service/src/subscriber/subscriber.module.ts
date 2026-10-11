import { Module } from '@nestjs/common';
import { RelayDatabaseModule } from '../database/relay-database.module';
import { SubscriberController } from './subscriber.controller';
import { OAuthCallbackController } from './oauth-callback.controller';
import { SubscriberService } from './subscriber.service';
import { OAuthService } from './oauth.service';
import {
  subscriberRegistryProvider,
  SUBSCRIBER_REGISTRY_REPOSITORY,
} from './subscriber-registry.provider';

@Module({
  imports: [RelayDatabaseModule],
  controllers: [SubscriberController, OAuthCallbackController],
  providers: [subscriberRegistryProvider, SubscriberService, OAuthService],
  exports: [SubscriberService, SUBSCRIBER_REGISTRY_REPOSITORY],
})
export class SubscriberModule {}
