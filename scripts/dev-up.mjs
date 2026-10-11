#!/usr/bin/env node
/**
 * One-command local startup: DynamoDB Local + cloudflared tunnel (docker compose),
 * table setup, relay, one-time Linear connect, then dispatcher + monitor TUI in the foreground.
 * Ctrl-C (or quitting the TUI) stops everything.
 * Tunnel, in priority order:
 *   1. Cloudflare named tunnel (CLOUDFLARE_TUNNEL_TOKEN + TUNNEL_HOSTNAME in root .env)
 *   2. Tailscale Funnel (free, stable <machine>.<tailnet>.ts.net URL) when tailscale is running
 *   3. Cloudflare quick tunnel (random URL each run)
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, copyFileSync, chmodSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';
import { isHttpUp, killGroup, loadEnvFile, root, startService, waitForHttp } from './lib/stack.mjs';

const { readEnvFile: readEnv, updateEnvFile } = loadEnvFile();
const relayDir = join(root, 'services/relay-service');
const dispatcherDir = join(root, 'services/dispatcher-service');

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });

// 1. Preflight
for (const bin of ['docker', 'claude']) {
  try {
    execFileSync('which', [bin], { stdio: 'ignore' });
  } catch {
    console.error(`Missing prerequisite: ${bin}`);
    process.exit(1);
  }
}
for (const dir of [relayDir, dispatcherDir]) {
  const target = join(dir, '.env.local');
  if (!existsSync(target)) {
    copyFileSync(join(root, '.env.example'), target);
    chmodSync(target, 0o600); // these files hold secrets
  }
}

// Prompt once for any Linear credential that is missing or still a placeholder.
{
  const relayFile = join(relayDir, '.env.local');
  const current = readEnv(relayFile);
  const missing = ['LINEAR_OAUTH_CLIENT_ID', 'LINEAR_OAUTH_CLIENT_SECRET', 'LINEAR_WEBHOOK_SECRET'].filter(
    (k) => !current[k] || current[k].startsWith('your_'),
  );
  if (missing.length) {
    console.log('Enter your Linear app credentials (saved to services/relay-service/.env.local):');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    for (const key of missing) updateEnvFile(relayFile, { [key]: (await rl.question(`  ${key}: `)).trim() });
    rl.close();
  }
}

const rootEnv = { ...readEnv(join(root, '.env')), ...process.env };
const named = Boolean(rootEnv.CLOUDFLARE_TUNNEL_TOKEN && rootEnv.TUNNEL_HOSTNAME);

const tailscaleBin = ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'].find((bin) => {
  try {
    execFileSync(bin, ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
});
const tailscaleHost = (() => {
  if (named || !tailscaleBin) return null;
  try {
    const st = JSON.parse(execFileSync(tailscaleBin, ['status', '--json'], { encoding: 'utf8' }));
    return st.BackendState === 'Running' ? st.Self.DNSName.replace(/\.$/, '') : null;
  } catch {
    return null;
  }
})();
const mode = named ? 'named' : tailscaleHost ? 'tailscale' : 'quick';
const tunnelService = named ? 'tunnel-named' : 'tunnel';

const relayEnv = readEnv(join(relayDir, '.env.local'));
const relayPort = process.env.RELAY_PORT || relayEnv.PORT || '3001';
const compose = ['compose', '-f', join(root, 'docker-compose.yml'), '--profile', named ? 'named' : 'quick'];
const composeEnv = { ...rootEnv, RELAY_PORT: relayPort };

const children = [];
let stopping = false;
const shutdown = (code = 0) => {
  if (stopping) return;
  stopping = true;
  console.log('\nShutting down...');
  children.forEach((c) => killGroup(c));
  if (mode === 'tailscale') {
    try {
      execFileSync(tailscaleBin, ['funnel', '--https=443', 'off'], { stdio: 'ignore' });
    } catch {}
  }
  try {
    execFileSync('docker', [...compose, 'down'], { stdio: 'ignore', env: composeEnv });
  } catch {}
  process.exit(code);
};
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());

// 2. Infra
console.log('Starting DynamoDB Local and tunnel...');
const services = mode === 'tailscale' ? ['dynamodb'] : ['dynamodb', tunnelService];
run('docker', [...compose, 'up', '-d', '--wait', ...services], { env: composeEnv });
if (mode === 'tailscale') {
  try {
    run(tailscaleBin, ['funnel', '--bg', relayPort]);
  } catch {
    console.error('Could not enable Tailscale Funnel. Enable it for your tailnet (admin console > Access controls > funnel) and retry.');
    shutdown(1);
  }
}

// 3. Tunnel URL
const tunnelUrl = named
  ? `https://${rootEnv.TUNNEL_HOSTNAME}`
  : tailscaleHost
    ? `https://${tailscaleHost}`
    : await new Promise((resolve, reject) => {
      const deadline = Date.now() + 60_000;
      const poll = () => {
        const logs = execFileSync('docker', [...compose, 'logs', '--no-color', 'tunnel'], {
          env: composeEnv,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const m = logs.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (m) return resolve(m[0]);
        if (Date.now() > deadline) return reject(new Error('Timed out waiting for tunnel URL'));
        setTimeout(poll, 1000);
      };
      poll();
    }).catch((e) => {
      console.error(e.message);
      shutdown(1);
    });

const dynamoEnv = { DYNAMODB_ENDPOINT: 'http://localhost:8000', DYNAMODB_REGION: 'us-east-1' };
const childEnv = { ...process.env, ...dynamoEnv, RELAY_BASE_URL: tunnelUrl, PORT: relayPort };

// 4. Table
run('node', ['scripts/setup-local-dynamodb.js'], { cwd: relayDir, env: childEnv });

// 5. Relay (logs to file so the TUI owns the terminal)
if (await isHttpUp(`http://localhost:${relayPort}/`)) {
  console.error(`Port ${relayPort} is already in use (leftover relay?). Stop it and retry: lsof -ti tcp:${relayPort} | xargs kill`);
  shutdown(1);
}
const relay = startService({
  command: 'pnpm',
  args: ['dev'],
  cwd: relayDir,
  env: childEnv,
  logFile: join(root, 'logs', 'relay.log'),
  onExit: (code) => {
    if (stopping) return;
    console.error(`relay exited (${code}); see logs/relay.log`);
    shutdown(1);
  },
});
children.push(relay);

console.log('Waiting for relay...');
if (!(await waitForHttp(`http://localhost:${relayPort}/`, { timeoutMs: 60_000, intervalMs: 1000, isAlive: () => !stopping }))) {
  console.error('Relay did not start; see logs/relay.log');
  shutdown(1);
}

console.log(`
Tunnel: ${tunnelUrl}
Set in your Linear app${mode === 'quick' ? ' (changes every run - install Tailscale for a fixed URL)' : ' (stable)'}:
  Webhook URL:    ${tunnelUrl}/webhooks/linear
  OAuth callback: ${tunnelUrl}/callback
`);

// 6. One-time connect (opens browser for Linear authorize)
const dispatcherEnvFile = join(dispatcherDir, '.env.local');
const dispatcherPort = readEnv(dispatcherEnvFile).PORT || '3000';
const saved = readEnv(dispatcherEnvFile);
// Reconnect if never connected, if the saved relay URL is stale (e.g. old ngrok/tunnel), or on --reconnect.
if (!saved.RELAY_SUBSCRIBER_SECRET || saved.RELAY_URL !== tunnelUrl || process.argv.includes('--reconnect')) {
  console.log('Connecting dispatcher to relay - authorize in the browser...');
  run('pnpm', ['connect-relay', `--relay-url=${tunnelUrl}`, `--local-endpoint=http://localhost:${dispatcherPort}`], {
    cwd: dispatcherDir,
    env: childEnv,
  });
}

// 7. Dispatcher + monitor TUI (monitor.js boots the server with logs in a file)
const tui = spawn('node', ['scripts/monitor.js'], {
  cwd: dispatcherDir,
  env: { ...process.env, PORT: dispatcherPort },
  stdio: 'inherit',
});
tui.on('exit', (code) => shutdown(code ?? 0));
// Not pushed to children: the TUI needs the controlling terminal (no detached group); it exits on its own.
