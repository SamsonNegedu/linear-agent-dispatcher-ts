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
    // Built-in tools Claude may use without a prompt. Unattended runs cannot answer
    // permission prompts, so anything not allowed (here, in the repo's settings, or
    // via MCP below) is denied. Repo `deny` rules still apply.
    allowedTools?: string[];
    // Also allow every MCP server configured for the repo (discovered per repo).
    allowAllMcp?: boolean;
    permissionMode?: string;
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

const DEFAULT_ALLOWED_TOOLS = 'Read,Edit,Write,Glob,Grep,Bash,Skill,Task,TodoWrite,NotebookEdit';

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
      port: parseInt(process.env.PORT || process.env.DISPATCHER_PORT || '3000', 10),
      globalPrefix: '',
    },
    executor: {
      claudeBinPath: process.env.CLAUDE_BIN_PATH || 'claude',
      timeout: parseInt(process.env.MAX_RUN_DURATION || String(DEFAULT_MAX_RUN_DURATION_MS), 10),
      allowedTools: (process.env.CLAUDE_ALLOWED_TOOLS ?? DEFAULT_ALLOWED_TOOLS)
        .split(/[\s,]+/)
        .filter(Boolean),
      allowAllMcp: process.env.CLAUDE_ALLOW_ALL_MCP !== 'false',
      // dontAsk: deny whatever is not allowed instead of prompting (nobody is there to answer).
      permissionMode: process.env.CLAUDE_PERMISSION_MODE ?? 'dontAsk',
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
