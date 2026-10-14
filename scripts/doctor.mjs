#!/usr/bin/env node
/**
 * Checks every hop a Linear webhook takes and says which one is broken, with the fix. Read-only
 * apart from one signed test webhook for a team no subscriber has, which the relay drops.
 * Prints no secret values. Run with the stack up: pnpm doctor
 */
import { createHash, createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { loadEnvFile, root } from './lib/stack.mjs';

const { readEnvFile } = loadEnvFile();
const envFile = join(root, '.env.local');
const env = existsSync(envFile) ? readEnvFile(envFile) : {};

const results = [];
const check = async (name, run) => {
  try {
    const detail = await run();
    results.push({ name, ok: true, detail });
  } catch (error) {
    results.push({ name, ok: false, detail: error.message });
  }
};
const need = (condition, message) => {
  if (!condition) throw new Error(message);
};
const short = (value) => createHash('sha256').update(value).digest('hex').slice(0, 8);
const http = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(8000) });

const relayPort = env.RELAY_PORT || '3001';
const dispatcherPort = env.DISPATCHER_PORT || '3000';
const relayUrl = (env.RELAY_URL || '').replace(/\/$/, '');

await check('env file', () => {
  need(existsSync(envFile), '.env.local is missing. Run pnpm dev:up once to create it.');
  const mode = statSync(envFile).mode & 0o777;
  need(
    mode === 0o600,
    `.env.local is mode ${mode.toString(8)}; it holds secrets: chmod 600 .env.local`,
  );
  const missing = [
    'LINEAR_OAUTH_CLIENT_ID',
    'LINEAR_OAUTH_CLIENT_SECRET',
    'LINEAR_WEBHOOK_SECRET',
    'RELAY_URL',
    'RELAY_SUBSCRIBER_SECRET',
  ].filter((key) => !env[key]);
  need(!missing.length, `missing in .env.local: ${missing.join(', ')}`);
  return 'present, mode 600';
});

await check('shell overrides', () => {
  const stale = Object.keys(env).filter(
    (key) => process.env[key] !== undefined && process.env[key] !== env[key],
  );
  need(
    !stale.length,
    `exported in your shell and different from .env.local: ${stale.join(', ')}. Unset them (pnpm dev:up ignores them, but other commands may not).`,
  );
  return 'none';
});

await check('Linear app token', async () => {
  execFileSync('pnpm', ['--silent', '--filter', '@linear-agent/linear-client', 'build'], {
    cwd: root,
    stdio: 'ignore',
  });
  const { AppTokenProvider, LinearGraphQLClient } = createRequire(import.meta.url)(
    join(root, 'packages/linear-client/dist/index.js'),
  );
  const provider = new AppTokenProvider({
    clientId: env.LINEAR_OAUTH_CLIENT_ID,
    clientSecret: env.LINEAR_OAUTH_CLIENT_SECRET,
  });
  const viewer = await new LinearGraphQLClient(provider).getViewer();
  need(
    viewer.app,
    `the token acts as "${viewer.name}", not an app user. Re-install the app with actor=app.`,
  );
  return `mints and acts as the app user "${viewer.name}"`;
});

await check('relay running', async () => {
  const res = await http(`http://localhost:${relayPort}/`).catch(() => null);
  need(res, `nothing is listening on :${relayPort}. Start it with pnpm dev:up.`);
  return `listening on :${relayPort}`;
});

await check('dispatcher running', async () => {
  const res = await http(`http://localhost:${dispatcherPort}/health`).catch(() => null);
  need(res?.ok, `no healthy dispatcher on :${dispatcherPort}. Start it with pnpm dev:up.`);
  return `healthy on :${dispatcherPort}`;
});

await check('public URL reaches this relay', async () => {
  need(relayUrl, 'RELAY_URL is not set in .env.local');
  const res = await http(
    `${relayUrl}/subscribers/auth/start?localEndpoint=${encodeURIComponent(`http://localhost:${dispatcherPort}/webhooks/relay`)}`,
  ).catch((error) => {
    throw new Error(
      `${relayUrl} is not reachable (${error.cause?.code ?? error.message}). Is the tunnel up? tailscale funnel status`,
    );
  });
  const text = await res.text();
  need(
    text.includes('linear.app/oauth/authorize'),
    `${relayUrl} answered, but not like this relay (HTTP ${res.status}). Is the tunnel pointing at :${relayPort}?`,
  );
  return `${relayUrl} -> this relay`;
});

await check('signed webhook accepted (secret, replay check)', async () => {
  need(relayUrl && env.LINEAR_WEBHOOK_SECRET, 'needs RELAY_URL and LINEAR_WEBHOOK_SECRET');
  const now = Date.now();
  const body = JSON.stringify({
    webhookId: 'doctor',
    type: 'Issue',
    action: 'update',
    createdAt: new Date(now).toISOString(),
    webhookTimestamp: now,
    organizationId: 'doctor',
    data: {
      id: 'doctor',
      identifier: 'DOC-0',
      title: 'doctor',
      team: { id: 'doctor', key: 'DOCTOR' },
      assignee: { id: 'doctor' },
      labelIds: [],
      labels: [],
    },
  });
  const signature = createHmac('sha256', env.LINEAR_WEBHOOK_SECRET).update(body).digest('hex');
  const res = await http(`${relayUrl}/webhooks/linear`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'linear-signature': signature },
    body,
  });
  need(
    res.status !== 401,
    'the relay rejected the signature: LINEAR_WEBHOOK_SECRET differs from the secret on the Linear app.',
  );
  need(res.ok, `the relay answered HTTP ${res.status}. See logs/relay.log.`);
  return 'relay verified and accepted a signed test webhook';
});

await check('relay and dispatcher share the subscriber secret', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const dbPath = env.RELAY_DB_PATH || join(root, 'services/relay-service/data/relay.db');
  need(existsSync(dbPath), `relay database not found at ${dbPath}`);
  const rows = new DatabaseSync(dbPath, { readOnly: true })
    .prepare('SELECT subscriber_id, subscriber_secret FROM subscribers')
    .all();
  need(rows.length, 'the relay has no subscribers. Connect with pnpm dev:up --reconnect.');
  const mismatched = rows.filter((row) => row.subscriber_secret !== env.RELAY_SUBSCRIBER_SECRET);
  if (mismatched.length) {
    const ids = mismatched.map((row) => row.subscriber_id).join(', ');
    throw new Error(
      `the relay's secret for ${ids} (${short(mismatched[0].subscriber_secret)}) differs from RELAY_SUBSCRIBER_SECRET in .env.local (${short(env.RELAY_SUBSCRIBER_SECRET)}). Reconnect: pnpm dev:up --reconnect.`,
    );
  }
  return `${rows.length} subscriber(s), all match .env.local`;
});

for (const { name, ok, detail } of results)
  console.log(`${ok ? '  ok ' : 'FAIL '} ${name}: ${detail}`);
const failed = results.filter((result) => !result.ok).length;
console.log(
  failed
    ? `\n${failed} check(s) failed.`
    : '\nAll checks passed. If Linear still shows nothing, check the app webhook is enabled in Linear.',
);
process.exit(failed ? 1 : 0);
