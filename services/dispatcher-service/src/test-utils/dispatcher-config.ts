import type { DispatcherConfig } from '../config/config';

/** A valid DispatcherConfig for tests; pass only the sections a test cares about. */
export function makeDispatcherConfig(overrides: Partial<DispatcherConfig> = {}): DispatcherConfig {
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
