export interface DispatcherConfig {
  relay: {
    enabled: boolean;
    subscriberSecret?: string;
    url?: string;
    subscriberId?: string;
  };
  server: {
    port: number;
    globalPrefix: string;
  };
  executor: {
    claudeBinPath: string;
    allowedEnvVars: string[];
    timeout: number;
  };
  database: {
    path: string;
    synchronize: boolean;
    logging: boolean;
  };
  linear: {
    apiKey?: string;
  };
  preflight: {
    skip: boolean;
  };
}

// Default max duration for a single Claude run (MAX_RUN_DURATION env var
// overrides). Also the threshold StaleRunReconciliationService uses to
// decide a run is stuck, so it isn't purely a per-run execution limit.
const DEFAULT_MAX_RUN_DURATION_MS = 30 * 60 * 1000;

export const loadConfig = (): DispatcherConfig => {
  const nodeEnv = process.env.NODE_ENV || 'development';

  return {
    relay: {
      enabled: process.env.RELAY_ENABLED === 'true',
      subscriberSecret: process.env.RELAY_SUBSCRIBER_SECRET,
      url: process.env.RELAY_URL,
      subscriberId: process.env.RELAY_SUBSCRIBER_ID,
    },
    server: {
      port: parseInt(process.env.PORT || '3000', 10),
      globalPrefix: '',
    },
    executor: {
      claudeBinPath: process.env.CLAUDE_BIN_PATH || 'claude',
      timeout: parseInt(process.env.MAX_RUN_DURATION || String(DEFAULT_MAX_RUN_DURATION_MS), 10),
      // Whitelist env vars to pass to handler
      // NOTE: ANTHROPIC_API_KEY is NOT included. Claude CLI uses ~/.claude/auth instead.
      allowedEnvVars: ['PATH', 'HOME', 'ANTHROPIC_BASE_URL', 'USER', 'LANG', 'LC_ALL'],
    },
    database: {
      path: process.env.DISPATCHER_DB_PATH || './data/dispatcher.db',
      synchronize: nodeEnv !== 'production',
      logging: process.env.TYPEORM_LOGGING === 'true',
    },
    linear: {
      apiKey: process.env.LINEAR_API_KEY,
    },
    preflight: {
      skip: process.env.PREFLIGHT_SKIP === '1',
    },
  };
};
