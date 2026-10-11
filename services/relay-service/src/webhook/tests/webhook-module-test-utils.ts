import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { DynamoDBModule } from '@dynamodb/client';
import { WebhookModule } from '../webhook.module';
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
 * WebhookModule pulls in SubscriberModule (controllers, OAuthService) and
 * DynamoDBModule alongside its own providers — every one of those gets
 * constructed on compile() regardless of which service a given test cares
 * about. This sets the baseline overrides so nothing tries a real AWS call
 * or throws on a missing env-derived config value.
 */
export function baseWebhookModuleTestBuilder(
  configOverrides: Partial<RelayServiceConfig> = {},
): TestingModuleBuilder {
  return Test.createTestingModule({ imports: [WebhookModule, ConfigModule] })
    .overrideModule(DynamoDBModule)
    .useModule(FakeDynamoDBModule)
    .overrideProvider('RelayServiceConfig')
    .useValue(makeRelayServiceConfig(configOverrides));
}
