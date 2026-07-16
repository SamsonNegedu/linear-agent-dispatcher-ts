export interface DispatcherConfig {
  relay: {
    enabled: boolean;
    subscriberSecret?: string;
  };
  server: {
    port: number;
    globalPrefix: string;
  };
  executor: {
    claudeBinPath: string;
    claudePermissionMode?: string;
    allowedEnvVars: string[];
    repoPath?: string;
    timeout: number;
  };
  database: {
    path: string;
    synchronize: boolean;
    logging: boolean;
  };
  linear: {
    apiKey?: string;
    labelFallbackEnabled: boolean;
    minLabelCountForFallback: number;
  };
  preflight: {
    skip: boolean;
  };
}

export const loadConfig = (): DispatcherConfig => {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const permissionMode = process.env.CLAUDE_PERMISSION_MODE;

  // Validate permission mode if set
  if (permissionMode && !['auto', 'ask'].includes(permissionMode)) {
    throw new Error(`Invalid CLAUDE_PERMISSION_MODE: ${permissionMode}. Must be 'auto' or 'ask'.`);
  }

  return {
    relay: {
      enabled: process.env.RELAY_ENABLED === 'true',
      subscriberSecret: process.env.RELAY_SUBSCRIBER_SECRET,
    },
    server: {
      port: parseInt(process.env.PORT || '3000', 10),
      globalPrefix: '',
    },
    executor: {
      claudeBinPath: process.env.CLAUDE_BIN_PATH || 'claude',
      claudePermissionMode: permissionMode,
      repoPath: process.env.DISPATCHER_REPO_PATH || process.cwd(),
      timeout: parseInt(process.env.MAX_RUN_DURATION || String(30 * 60 * 1000), 10),
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
      labelFallbackEnabled: process.env.LINEAR_LABEL_FALLBACK !== 'false',
      minLabelCountForFallback: parseInt(process.env.LINEAR_MIN_LABELS || '2', 10),
    },
    preflight: {
      skip: process.env.PREFLIGHT_SKIP === '1',
    },
  };
};
