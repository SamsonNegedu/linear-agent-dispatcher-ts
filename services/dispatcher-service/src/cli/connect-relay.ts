#!/usr/bin/env node
import { spawn } from 'child_process';
import { createServer } from 'http';
import { updateEnvFile } from '@linear-agent/env-file';
import { CliError, envFilePath, errorMessage, parseFlags, runCli } from './cli-utils';

const DEFAULT_CALLBACK_PORT = 3333;
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

const USAGE = `Usage: pnpm connect-relay --relay-url=<url> --local-endpoint=<url> [--port=${DEFAULT_CALLBACK_PORT}]

  --relay-url        the relay, e.g. http://localhost:3001 or https://relay.example.com
  --local-endpoint   where the relay reaches this dispatcher; /webhooks/relay is appended
  --port             local port for the OAuth callback`;

interface Team {
  teamKey: string;
  teamName: string;
  subscriberId?: string;
}

interface ConnectRelayOptions {
  relayUrl: string;
  localEndpoint: string;
  port?: number;
}

const page = (title: string, body: string): string =>
  `<html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family: sans-serif; margin: 40px; text-align: center;"><h1>${title}</h1><p>${body}</p></body></html>`;

/**
 * Registers this dispatcher with a relay through Linear OAuth: asks the relay for an
 * authorization URL, opens it in the browser, receives the subscriber secret on a local
 * callback, and saves it to .env.local. Every Linear team the user belongs to is registered.
 */
export async function connectRelay(options: ConnectRelayOptions): Promise<void> {
  const relayUrl = options.relayUrl.replace(/\/$/, '');
  const webhookUrl = `${options.localEndpoint.replace(/\/$/, '')}/webhooks/relay`;
  const port = options.port ?? DEFAULT_CALLBACK_PORT;

  console.log(`Relay: ${relayUrl}\nDispatcher webhook: ${webhookUrl}\n`);

  const authUrl = await requestAuthUrl(
    relayUrl,
    webhookUrl,
    `http://localhost:${port}/relay-callback`,
  );
  const callback = waitForCallback(port); // listening before the browser can redirect to it
  openBrowser(authUrl);
  console.log(`Authorize on Linear in the browser. If it did not open, visit:\n  ${authUrl}\n`);
  const { secret, teams } = await callback;

  try {
    updateEnvFile(envFilePath(), {
      RELAY_ENABLED: 'true',
      RELAY_SUBSCRIBER_SECRET: secret,
      RELAY_URL: relayUrl,
      RELAY_DISPATCHER_URL: options.localEndpoint,
      ...(teams[0]?.subscriberId ? { RELAY_SUBSCRIBER_ID: teams[0].subscriberId } : {}),
    });
  } catch (error) {
    console.error(`Could not write .env.local (${errorMessage(error)}). Add these yourself:`);
    console.error(
      `  RELAY_ENABLED=true\n  RELAY_SUBSCRIBER_SECRET=${secret}\n  RELAY_URL=${relayUrl}`,
    );
  }

  console.log(`Connected to the relay. Teams (${teams.length}):`);
  teams.forEach((team) => console.log(`  - ${team.teamName} (${team.teamKey})`));
  console.log(`\nSecret: ${secret.slice(0, 8)}...${secret.slice(-8)}`);
  console.log('Start (or restart) the dispatcher; `pnpm dev:up` from the repo root does it all.');
}

async function requestAuthUrl(
  relayUrl: string,
  webhookUrl: string,
  cliCallback: string,
): Promise<string> {
  const params = new URLSearchParams({ localEndpoint: webhookUrl, cliCallback, relayUrl });
  let response: Response;
  try {
    response = await fetch(`${relayUrl}/subscribers/auth/start?${params}`);
  } catch (error) {
    throw new CliError(`Could not reach the relay at ${relayUrl}: ${errorMessage(error)}`);
  }
  if (!response.ok)
    throw new CliError(`The relay answered ${response.status} to the authorization request`);
  return ((await response.json()) as { redirect: string }).redirect;
}

/** Serves the one-shot OAuth callback; resolves with the secret, rejects on a bad callback or timeout. */
function waitForCallback(port: number): Promise<{ secret: string; teams: Team[] }> {
  return new Promise((resolve, reject) => {
    const finish = (settle: () => void): void => {
      clearTimeout(timer);
      server.close();
      server.closeAllConnections();
      settle();
    };

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);
      if (url.pathname !== '/relay-callback') {
        res.writeHead(404).end('Not found');
        return;
      }

      const secret = url.searchParams.get('secret');
      if (!secret) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page('Authorization failed', 'The relay did not return a subscriber secret.'));
        finish(() =>
          reject(new CliError('Authorization failed: the relay returned no subscriber secret')),
        );
        return;
      }

      let teams: Team[] = [];
      try {
        teams = JSON.parse(url.searchParams.get('teams') ?? '[]') as Team[];
      } catch {
        // teams are only for the summary
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        page('Authorization successful', 'You can close this window and return to your terminal.'),
      );
      finish(() => resolve({ secret, teams }));
    });

    const timer = setTimeout(
      () => finish(() => reject(new CliError('Authorization timed out after 5 minutes'))),
      AUTH_TIMEOUT_MS,
    );

    server.on('error', (error: NodeJS.ErrnoException) =>
      finish(() =>
        reject(
          new CliError(
            error.code === 'EADDRINUSE'
              ? `Port ${port} is already in use; pass --port=<other port>`
              : errorMessage(error),
          ),
        ),
      ),
    );
    server.listen(port);
  });
}

/** Opens the URL in the default browser. Array-form spawn avoids shell injection. */
function openBrowser(url: string): void {
  const [command, ...args] =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : ['xdg-open', url];
  spawn(command, args, { detached: true, stdio: 'ignore' })
    .on('error', () => {}) // the URL is printed for manual use
    .unref();
}

if (require.main === module) {
  runCli(async () => {
    const { values } = parseFlags({
      'relay-url': { type: 'string' },
      'local-endpoint': { type: 'string' },
      port: { type: 'string' },
    });
    if (!values['relay-url'] || !values['local-endpoint']) throw new CliError(USAGE);
    await connectRelay({
      relayUrl: values['relay-url'],
      localEndpoint: values['local-endpoint'],
      port: values.port ? Number(values.port) : undefined,
    });
  });
}
