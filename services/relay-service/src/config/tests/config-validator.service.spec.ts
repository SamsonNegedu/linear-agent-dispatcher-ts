import { ConfigValidatorService } from '../config-validator.service';
import type { RelayServiceConfig } from '../relay-config';

function makeConfig(overrides: Partial<RelayServiceConfig> = {}): RelayServiceConfig {
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

describe('ConfigValidatorService', () => {
  it('passes validation for a complete config', () => {
    const service = new ConfigValidatorService(makeConfig());

    expect(() => service.onModuleInit()).not.toThrow();
  });

  it('throws when the Linear webhook secret is missing', () => {
    const service = new ConfigValidatorService(
      makeConfig({
        linear: { oauthClientId: 'client_1', oauthClientSecret: 'secret_1', webhookSecret: '' },
      }),
    );

    expect(() => service.onModuleInit()).toThrow(/LINEAR_WEBHOOK_SECRET is required/);
  });

  it('throws when RELAY_BASE_URL is set but not a valid URL', () => {
    const service = new ConfigValidatorService(makeConfig({ relay: { baseUrl: 'not-a-url' } }));

    expect(() => service.onModuleInit()).toThrow(/RELAY_BASE_URL is not a valid URL/);
  });

  it('does not throw when RELAY_BASE_URL is empty (only a warning)', () => {
    const service = new ConfigValidatorService(makeConfig({ relay: { baseUrl: '' } }));

    expect(() => service.onModuleInit()).not.toThrow();
  });
});
