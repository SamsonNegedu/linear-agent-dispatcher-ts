import { Module } from '@nestjs/common';
import { DynamoDBModule } from '@dynamodb/client';
import { SubscriberController } from './subscriber.controller';
import { OAuthCallbackController } from './oauth-callback.controller';
import { SubscriberService } from './subscriber.service';
import { OAuthService } from './oauth.service';
import { subscriberRegistryProvider, SUBSCRIBER_REGISTRY_REPOSITORY } from './subscriber-registry.provider';

@Module({
  imports: [DynamoDBModule],
  controllers: [SubscriberController, OAuthCallbackController],
  providers: [subscriberRegistryProvider, SubscriberService, OAuthService],
  exports: [SubscriberService, SUBSCRIBER_REGISTRY_REPOSITORY],
})
export class SubscriberModule {}
