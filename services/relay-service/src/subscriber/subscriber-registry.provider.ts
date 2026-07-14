import { Provider } from '@nestjs/common';
import { DynamoClient } from '@dynamodb/client';
import { SubscriberRegistry } from './subscriber-registry.repository';
import { RelayServiceConfig } from '../config/relay-config';

export const SUBSCRIBER_REGISTRY_REPOSITORY = 'SUBSCRIBER_REGISTRY_REPOSITORY';

export const subscriberRegistryProvider: Provider = {
  provide: SUBSCRIBER_REGISTRY_REPOSITORY,
  useFactory: (dynamoClient: DynamoClient, config: RelayServiceConfig) => {
    return new SubscriberRegistry(dynamoClient, config.dynamodb.tableName);
  },
  inject: [DynamoClient, 'RelayServiceConfig'],
};
