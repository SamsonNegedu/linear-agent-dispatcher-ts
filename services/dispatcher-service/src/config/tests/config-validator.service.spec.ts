import { ConfigValidatorService } from '../config-validator.service';
import type { DispatcherConfig } from '../config';

function makeConfig(overrides: Partial<DispatcherConfig> = {}): DispatcherConfig {
  return {
    relay: { enabled: false },
    server: { port: 3000, globalPrefix: '' },
    executor: { claudeBinPath: 'claude', allowedEnvVars: [], timeout: 1_800_000 },
    database: { path: './data/dispatcher.db', synchronize: true, logging: false },
    linear: { apiKey: 'key_1' },
    preflight: { skip: false },
    ...overrides,
  };
}

describe('ConfigValidatorService', () => {
  it('passes validation for a complete config', () => {
    const service = new ConfigValidatorService(makeConfig());

    expect(() => service.onModuleInit()).not.toThrow();
  });

  it('throws when relay is enabled but no subscriber secret is configured', () => {
    const service = new ConfigValidatorService(
      makeConfig({ relay: { enabled: true, subscriberSecret: undefined } }),
    );

    expect(() => service.onModuleInit()).toThrow(/RELAY_SUBSCRIBER_SECRET is required/);
  });

  it('throws when claudeBinPath is missing', () => {
    const service = new ConfigValidatorService(
      makeConfig({ executor: { claudeBinPath: '', allowedEnvVars: [], timeout: 1_800_000 } }),
    );

    expect(() => service.onModuleInit()).toThrow(/CLAUDE_BIN_PATH is required/);
  });

  it('does not throw when linear.apiKey is missing (only a warning)', () => {
    const service = new ConfigValidatorService(makeConfig({ linear: { apiKey: undefined } }));

    expect(() => service.onModuleInit()).not.toThrow();
  });
});
