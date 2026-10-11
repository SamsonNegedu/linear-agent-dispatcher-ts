import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { RelayDatabaseModule } from '../../database/relay-database.module';
import { WebhookModule } from '../webhook.module';
import { ConfigModule } from '../../config/config.module';
import { FakeRelayDatabaseModule } from '../../test-utils/fake-relay-database.module';
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
    database: { path: ':memory:' },
    ...overrides,
  };
}

/**
 * WebhookModule pulls in SubscriberModule (controllers, OAuthService) and
 * RelayDatabaseModule alongside its own providers — every one of those gets
 * constructed on compile() regardless of which service a given test cares
 * about. This sets the baseline overrides so nothing opens a real database
 * or throws on a missing env-derived config value.
 */
export function baseWebhookModuleTestBuilder(
  configOverrides: Partial<RelayServiceConfig> = {},
): TestingModuleBuilder {
  return Test.createTestingModule({ imports: [WebhookModule, ConfigModule] })
    .overrideModule(RelayDatabaseModule)
    .useModule(FakeRelayDatabaseModule)
    .overrideProvider('RelayServiceConfig')
    .useValue(makeRelayServiceConfig(configOverrides));
}
