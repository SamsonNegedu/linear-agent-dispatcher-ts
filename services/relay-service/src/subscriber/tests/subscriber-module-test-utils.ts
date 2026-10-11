import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { DynamoDBModule } from '@dynamodb/client';
import { SubscriberModule } from '../subscriber.module';
import { ConfigModule } from '../../config/config.module';
import { FakeDynamoDBModule } from '../../test-utils/fake-dynamodb.module';
import type { RelayServiceConfig } from '../../config/relay-config';

export function makeRelayServiceConfig(
  overrides: Partial<RelayServiceConfig> = {},
): RelayServiceConfig {
  return {
    linear: {
      oauthClientId: 'client_1',
      oauthClientSecret: 'secret_1',
      webhookSecret: 'whsec_1',
    },
    relay: { baseUrl: 'https://relay.example.com' },
    dynamodb: { tableName: 'RelayTable' },
    ...overrides,
  };
}

/**
 * SubscriberModule pulls in DynamoDBModule (and its own controllers) — every
 * provider gets constructed on compile() regardless of which service a given
 * test cares about. This baseline keeps that safe: no real AWS call, no
 * throw on a missing env-derived config value.
 */
export function baseSubscriberModuleTestBuilder(
  configOverrides: Partial<RelayServiceConfig> = {},
): TestingModuleBuilder {
  return Test.createTestingModule({ imports: [SubscriberModule, ConfigModule] })
    .overrideModule(DynamoDBModule)
    .useModule(FakeDynamoDBModule)
    .overrideProvider('RelayServiceConfig')
    .useValue(makeRelayServiceConfig(configOverrides));
}
