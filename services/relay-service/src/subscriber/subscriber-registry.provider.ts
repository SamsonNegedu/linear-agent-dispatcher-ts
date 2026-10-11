import { Provider } from '@nestjs/common';
import { RELAY_DATABASE, RelayDatabase } from '../database/relay-database';
import { SubscriberRegistry } from './subscriber-registry.repository';

export const SUBSCRIBER_REGISTRY_REPOSITORY = 'SUBSCRIBER_REGISTRY_REPOSITORY';

export const subscriberRegistryProvider: Provider = {
  provide: SUBSCRIBER_REGISTRY_REPOSITORY,
  useFactory: (db: RelayDatabase) => new SubscriberRegistry(db),
  inject: [RELAY_DATABASE],
};
