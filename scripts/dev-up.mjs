#!/usr/bin/env node
/**
 * One-command local startup: public tunnel, relay, one-time Linear connect, then the dispatcher
 * and monitor TUI in the foreground. Ctrl-C (or quitting the TUI) stops everything.
 * `--reconnect` forces the Linear authorize step again. Tunnel choice: see lib/tunnel.mjs.
 */
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { isHttpUp, killGroup, loadEnvFile, root, startService, waitForHttp } from './lib/stack.mjs';
import { startTunnel } from './lib/tunnel.mjs';

const { readEnvFile: readEnv, updateEnvFile } = loadEnvFile();
const relayDir = join(root, 'services/relay-service');
const dispatcherDir = join(root, 'services/dispatcher-service');
const relayEnvFile = join(relayDir, '.env.local');
const dispatcherEnvFile = join(dispatcherDir, '.env.local');
const logsDir = join(root, 'logs');

let tunnel = null;
let relay = null;
let stopping = false;
const shutdown = (code = 0) => {
  if (stopping) return;
  stopping = true;
  console.log('\nShutting down...');
  killGroup(relay);
  tunnel?.stop();
  process.exit(code);
};
const fail = (message) => {
  console.error(message);
  shutdown(1);
};
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());

// 1. Preflight: the claude CLI, and env files (created from the template, owner-only: they hold secrets)
try {
  execFileSync('which', ['claude'], { stdio: 'ignore' });
} catch {
  fail('Missing prerequisite: claude (the Claude CLI)');
}
for (const file of [relayEnvFile, dispatcherEnvFile]) {
  if (!existsSync(file)) {
    copyFileSync(join(root, '.env.example'), file);
    chmodSync(file, 0o600);
  }
}

// Prompt once for any Linear credential that is missing or still a placeholder.
const credentials = [
  'LINEAR_OAUTH_CLIENT_ID',
  'LINEAR_OAUTH_CLIENT_SECRET',
  'LINEAR_WEBHOOK_SECRET',
];
const missing = credentials.filter((key) => {
  const value = readEnv(relayEnvFile)[key];
  return !value || value.startsWith('your_');
});
if (missing.length) {
  console.log('Enter your Linear app credentials (saved to services/relay-service/.env.local):');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  for (const key of missing)
    updateEnvFile(relayEnvFile, { [key]: (await rl.question(`  ${key}: `)).trim() });
  rl.close();
}

// 2. Tunnel
const relayPort = process.env.RELAY_PORT || readEnv(relayEnvFile).PORT || '3001';
const relayUrl = `http://localhost:${relayPort}`;
if (await isHttpUp(`${relayUrl}/`)) {
  fail(
    `Port ${relayPort} is already in use (leftover relay?). Stop it and retry: lsof -ti tcp:${relayPort} | xargs kill`,
  );
}
console.log('Starting tunnel...');
try {
  tunnel = await startTunnel({
    port: relayPort,
    env: { ...readEnv(join(root, '.env')), ...process.env },
    logFile: join(logsDir, 'tunnel.log'),
  });
} catch (error) {
  fail(error.message);
}
const tunnelUrl = tunnel.url;

// 3. Relay (logs to a file so the TUI owns the terminal)
relay = startService({
  command: 'pnpm',
  args: ['dev'],
  cwd: relayDir,
  env: { ...process.env, RELAY_BASE_URL: tunnelUrl, PORT: relayPort },
  logFile: join(logsDir, 'relay.log'),
  onExit: (code) => !stopping && fail(`relay exited (${code}); see logs/relay.log`),
});
console.log('Waiting for relay...');
if (
  !(await waitForHttp(`${relayUrl}/`, {
    timeoutMs: 60_000,
    intervalMs: 1000,
    isAlive: () => !stopping,
  }))
) {
  fail('Relay did not start; see logs/relay.log');
}

console.log(`
Tunnel: ${tunnelUrl}
Set in your Linear app${tunnel.mode === 'quick' ? ' (changes every run; install Tailscale for a fixed URL)' : ' (stable)'}:
  Webhook URL:    ${tunnelUrl}/webhooks/linear
  OAuth callback: ${tunnelUrl}/callback
`);

// 4. Linear connect (opens the browser). Needed when never connected, when the relay URL changed,
// when the relay no longer knows the saved subscriber (e.g. its database was reset), or on --reconnect.
const saved = readEnv(dispatcherEnvFile);
const dispatcherPort = saved.PORT || '3000';
const subscriberKnown = async () =>
  Boolean(saved.RELAY_SUBSCRIBER_ID) &&
  (await fetch(`${relayUrl}/subscribers/${encodeURIComponent(saved.RELAY_SUBSCRIBER_ID)}`).then(
    (r) => r.ok,
    () => false,
  ));

if (
  !saved.RELAY_SUBSCRIBER_SECRET ||
  saved.RELAY_URL !== tunnelUrl ||
  process.argv.includes('--reconnect') ||
  !(await subscriberKnown())
) {
  console.log('Connecting dispatcher to relay - authorize in the browser...');
  execFileSync(
    'pnpm',
    [
      'connect-relay',
      `--relay-url=${tunnelUrl}`,
      `--local-endpoint=http://localhost:${dispatcherPort}`,
    ],
    { cwd: dispatcherDir, stdio: 'inherit' },
  );
}

// 5. Dispatcher + monitor TUI (monitor.js boots the server with its logs in a file). Not in
// `children`: the TUI needs the controlling terminal, so it is not detached; it exits on its own.
spawn('node', ['scripts/monitor.js'], {
  cwd: dispatcherDir,
  env: { ...process.env, PORT: dispatcherPort },
  stdio: 'inherit',
}).on('exit', (code) => shutdown(code ?? 0));
