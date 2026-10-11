import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { updateEnvFile } from '@linear-agent/env-file';
import * as path from 'path';
import { spawn } from 'child_process';

interface ConnectRelayOptions {
  relayUrl: string;
  localEndpoint: string;
  port?: number;
}

interface CallbackData {
  secret: string | null;
  teams: Array<{ teamKey: string; teamName: string; subscriberId?: string }>;
  received: boolean;
  relayUrl?: string;
}

const DEFAULTS = {
  port: 3333,
  authTimeoutMs: 5 * 60 * 1000,
  pollIntervalMs: 100,
};

const ENV_PATH = path.join(process.cwd(), '.env.local');

/**
 * CLI command: connect-relay
 * Orchestrates OAuth flow with Linear relay service
 *
 * Usage:
 *   npx ts-node src/cli/connect-relay.ts \
 *     --relay-url=https://relay.example.com \
 *     --local-endpoint=https://my-dispatcher.example.com
 */
export async function connectRelay(opts: ConnectRelayOptions): Promise<void> {
  const config = buildConfig(opts);
  printHeader(config);

  const authUrl = await step1_requestAuthUrl(config);
  const server = step2_startCallbackServer(config);
  step3_openBrowser(authUrl);
  const callbackData = await step4_waitForCallback(server, config);
  const firstSubscriberId = callbackData.teams[0]?.subscriberId;
  step5_saveCredentials(
    callbackData.secret!,
    config.relayUrl,
    config.localEndpoint,
    firstSubscriberId,
  );
  step6_printSuccess(callbackData.teams, config, callbackData.secret!);
}

interface Config {
  relayUrl: string;
  localEndpoint: string;
  callbackPort: number;
  callbackUrl: string;
  webhookUrl: string;
}

function buildConfig(opts: ConnectRelayOptions): Config {
  const relayUrl = opts.relayUrl.replace(/\/$/, '');
  const localEndpoint = opts.localEndpoint.replace(/\/$/, '');
  const callbackPort = opts.port || DEFAULTS.port;
  const callbackUrl = `http://localhost:${callbackPort}/relay-callback`;
  const webhookUrl = `${localEndpoint}/webhooks/relay`;

  return { relayUrl, localEndpoint, callbackPort, callbackUrl, webhookUrl };
}

function printHeader(config: Config): void {
  console.log('\n🔗 Linear Relay Connection Flow\n');
  console.log(`Relay URL: ${config.relayUrl}`);
  console.log(`Dispatcher endpoint: ${config.localEndpoint}`);
  console.log(`Webhook URL (registered with relay): ${config.webhookUrl}`);
  console.log(`OAuth callback: ${config.callbackUrl}\n`);
}

async function step1_requestAuthUrl(config: Config): Promise<string> {
  console.log('1️⃣  Requesting authorization URL from relay...\n');

  try {
    const params = new URLSearchParams({
      localEndpoint: config.webhookUrl,
      cliCallback: config.callbackUrl,
      relayUrl: config.relayUrl,
    });
    const response = await fetch(`${config.relayUrl}/subscribers/auth/start?${params}`);
    if (!response.ok) {
      throw new Error(`Relay responded with ${response.status}`);
    }
    const data = (await response.json()) as { redirect: string };
    return data.redirect;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('❌ Failed to get authorization URL from relay');
    console.error(`   Error: ${errorMsg}`);
    process.exit(1);
  }
}

function step2_startCallbackServer(config: Config): Server {
  console.log(`2️⃣  Starting callback server on http://localhost:${config.callbackPort}\n`);

  const server = createServer((req, res) => {
    handleCallbackRequest(req, res, config.callbackPort, () => {});
  });

  server.listen(config.callbackPort);
  return server;
}

function handleCallbackRequest(
  req: IncomingMessage,
  res: ServerResponse,
  port: number,
  onCallback: (data: CallbackData) => void,
): void {
  if (!req.url?.startsWith('/relay-callback')) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const url = new URL(req.url, `http://localhost:${port}`);
  const secret = url.searchParams.get('secret');
  const teamsParam = url.searchParams.get('teams');
  const teams: CallbackData['teams'] = teamsParam
    ? (JSON.parse(teamsParam) as CallbackData['teams'])
    : [];

  if (secret) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(buildSuccessHtml());
  } else {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>❌ Authorization Failed</h1><p>Missing secret</p>');
  }

  onCallback({ secret, teams, received: true });
}

function buildSuccessHtml(): string {
  return `
    <html>
      <head><meta charset="utf-8"><title>Relay Connected</title></head>
      <body style="font-family: sans-serif; margin: 40px; text-align: center;">
        <h1>✅ Authorization Successful!</h1>
        <p>Your dispatcher is now connected to the relay.</p>
        <p>You can close this window and return to your terminal.</p>
      </body>
    </html>
  `;
}

function step3_openBrowser(authUrl: string): void {
  console.log('3️⃣  Opening browser for Linear authorization...\n');
  console.log(`If browser doesn't open, visit this URL manually:\n   ${authUrl}\n`);

  void openBrowser(authUrl).catch(() => {
    // Silently fail - user can open manually
  });
}

async function step4_waitForCallback(server: Server, config: Config): Promise<CallbackData> {
  console.log('4️⃣  Waiting for authorization callback...');
  console.log('    (authorize on Linear, then return here)\n');

  const callbackData = await pollForCallback(server, config);

  if (!callbackData.secret) {
    console.error('❌ Authorization failed: relay did not return a subscriber secret');
    process.exit(1);
  }

  // Store config data for future use (e.g., update-relay)
  callbackData.relayUrl = config.relayUrl;

  return callbackData;
}

function pollForCallback(server: Server, config: Config): Promise<CallbackData> {
  return new Promise((resolve) => {
    const callbackData: CallbackData = {
      secret: null,
      teams: [],
      received: false,
    };

    const onCallbackReceived = (data: CallbackData) => {
      Object.assign(callbackData, data);
    };

    const timeout = setTimeout(() => {
      clearInterval(pollInterval);
      console.error('❌ Authorization timeout (5 minutes)');
      server.close();
      process.exit(1);
    }, DEFAULTS.authTimeoutMs);

    const pollInterval = setInterval(() => {
      if (callbackData.received) {
        clearInterval(pollInterval);
        clearTimeout(timeout);
        server.close();
        resolve(callbackData);
      }
    }, DEFAULTS.pollIntervalMs);

    server.removeAllListeners('request');
    server.on('request', (req, res) => {
      handleCallbackRequest(req, res, config.callbackPort, onCallbackReceived);
    });
  });
}

function step5_saveCredentials(
  secret: string,
  relayUrl: string,
  dispatcherUrl: string,
  subscriberId?: string,
): void {
  console.log('5️⃣  Saving credentials to .env\n');

  try {
    updateEnvFile(ENV_PATH, {
      RELAY_ENABLED: 'true',
      RELAY_SUBSCRIBER_SECRET: secret,
      RELAY_URL: relayUrl,
      RELAY_DISPATCHER_URL: dispatcherUrl,
      ...(subscriberId ? { RELAY_SUBSCRIBER_ID: subscriberId } : {}),
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('⚠️  Failed to write .env.local');
    console.error(`   Error: ${errorMsg}`);
    console.log(
      `   Manual setup: Add to .env.local:\n   RELAY_ENABLED=true\n   RELAY_SUBSCRIBER_SECRET=${secret}\n   RELAY_URL=${relayUrl}\n   RELAY_DISPATCHER_URL=${dispatcherUrl}${subscriberId ? `\n   RELAY_SUBSCRIBER_ID=${subscriberId}` : ''}`,
    );
  }
}

function step6_printSuccess(
  teams: Array<{ teamKey: string; teamName: string }>,
  config: Config,
  secret: string,
): void {
  const secretDisplay = `${secret.substring(0, 8)}...${secret.substring(secret.length - 8)}`;

  console.log('✅ Successfully connected to relay!\n');
  console.log(`📋 Registration Summary:`);
  console.log(`   Teams: ${teams.length}`);
  teams.forEach((team) => {
    console.log(`     - ${team.teamName} (${team.teamKey})`);
  });
  console.log(`   Webhook URL: ${config.webhookUrl}`);
  console.log(`   Secret: ${secretDisplay}\n`);

  console.log('📝 Next steps:');
  console.log(
    '   Start (or restart) the dispatcher; it will receive webhooks from all registered teams.',
  );
  console.log('   Tip: from the repo root, `pnpm dev:up` does all of this for you.\n');
}

/**
 * Open URL in default browser (cross-platform)
 * Uses array-form spawn to avoid shell injection vulnerabilities
 */
async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;

  let command: string[];
  if (platform === 'darwin') {
    // macOS
    command = ['open', url];
  } else if (platform === 'win32') {
    // Windows
    command = ['cmd', '/c', 'start', url];
  } else {
    // Linux
    command = ['xdg-open', url];
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(command[0], command.slice(1), {
      detached: true,
      stdio: 'ignore',
    });
    proc.on('error', reject);
    proc.unref();
    resolve();
  });
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const relayUrl = args.find((arg) => arg.startsWith('--relay-url='))?.split('=')[1];
  const localEndpoint = args.find((arg) => arg.startsWith('--local-endpoint='))?.split('=')[1];
  const port = parseInt(args.find((arg) => arg.startsWith('--port='))?.split('=')[1] || '3333');

  if (!relayUrl || !localEndpoint) {
    console.error('Usage:');
    console.error('  npx ts-node src/cli/connect-relay.ts \\');
    console.error('    --relay-url=https://relay.example.com \\');
    console.error('    --local-endpoint=https://my-dispatcher.example.com \\');
    console.error('    [--port=3333]');
    process.exit(1);
  }

  connectRelay({ relayUrl, localEndpoint, port }).catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}
