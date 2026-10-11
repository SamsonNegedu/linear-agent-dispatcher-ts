import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { RelayDatabaseModule } from '../../database/relay-database.module';
import { SubscriberModule } from '../subscriber.module';
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
 * SubscriberModule pulls in RelayDatabaseModule (and its own controllers) — every
 * provider gets constructed on compile() regardless of which service a given
 * test cares about. This baseline keeps that safe: no real AWS call, no
 * throw on a missing env-derived config value.
 */
export function baseSubscriberModuleTestBuilder(
  configOverrides: Partial<RelayServiceConfig> = {},
): TestingModuleBuilder {
  return Test.createTestingModule({ imports: [SubscriberModule, ConfigModule] })
    .overrideModule(RelayDatabaseModule)
    .useModule(FakeRelayDatabaseModule)
    .overrideProvider('RelayServiceConfig')
    .useValue(makeRelayServiceConfig(configOverrides));
}
