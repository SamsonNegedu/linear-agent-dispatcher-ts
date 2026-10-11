#!/usr/bin/env node
import { existsSync } from 'fs';
import { readEnvFile, updateEnvFile } from '@linear-agent/env-file';
import { CliError, envFilePath, parseFlags, runCli } from './cli-utils';
import { errorMessage } from '../common/error-message';

const USAGE =
  'Usage: pnpm update-relay --local-endpoint=https://new.server.com [--relay-url=http://localhost:3001]';

runCli(async () => {
  const { values } = parseFlags({
    'relay-url': { type: 'string' },
    'local-endpoint': { type: 'string' },
  });
  const localEndpoint = values['local-endpoint'];
  if (!localEndpoint) throw new CliError(`Missing required --local-endpoint flag\n${USAGE}`);

  if (!existsSync(envFilePath()))
    throw new CliError('.env.local not found. Run pnpm connect-relay first.');
  const env = readEnvFile(envFilePath());
  const relayUrl = values['relay-url'] || env.RELAY_URL;
  if (!relayUrl) throw new CliError('RELAY_URL not found in .env.local. Pass --relay-url.');
  if (!env.RELAY_SUBSCRIBER_SECRET) {
    throw new CliError(
      'RELAY_SUBSCRIBER_SECRET not found in .env.local. Run pnpm connect-relay first.',
    );
  }

  console.log(`Updating the subscription on ${relayUrl} to ${localEndpoint}...`);
  let response: Response;
  try {
    response = await fetch(new URL('/subscribers', relayUrl), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscriberId: env.RELAY_SUBSCRIBER_ID,
        subscriberSecret: env.RELAY_SUBSCRIBER_SECRET,
        localEndpoint: `${localEndpoint}/webhooks/relay`,
      }),
    });
  } catch (error) {
    throw new CliError(`Could not reach the relay at ${relayUrl}: ${errorMessage(error)}`);
  }
  if (!response.ok) throw new CliError(`Failed: HTTP ${response.status}\n${await response.text()}`);

  const result = (await response.json()) as Record<string, unknown>;
  console.log(
    `Updated. Subscriber ${String(result.subscriberId)} now delivers to ${String(result.localEndpoint)}`,
  );

  try {
    updateEnvFile(envFilePath(), { RELAY_DISPATCHER_URL: localEndpoint });
  } catch (error) {
    console.error(`Could not save RELAY_DISPATCHER_URL to .env.local: ${errorMessage(error)}`);
  }
});
