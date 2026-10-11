#!/usr/bin/env node
import { randomUUID } from 'crypto';
import { readEnvFile } from '@linear-agent/env-file';
import { signWebhookPayload } from '@webhook-verify/core';
import type { NormalizedEvent } from '@webhook-verify/core';
import { CliError, envFilePath, parseFlags, runCli } from './cli-utils';

const USAGE = `Usage: pnpm test-webhook --issue-id=<ID> --label=<REPO>,<MODE> [--team-key=<KEY>] [--port=<PORT>] [--endpoint=<URL>]

  pnpm test-webhook -- --issue-id=LIN-123 --label=my-repo,agent-implement

--label takes the repo label and one mode label, comma-separated (see \`pnpm routes\`).`;

function createEvent(issueId: string, labels: string[], teamKey: string): NormalizedEvent {
  const timestamp = Date.now();
  return {
    provider: 'linear',
    kind: 'issue',
    webhookId: randomUUID(),
    idempotencyKey: `issue:${issueId}:update:${timestamp}`,
    timestamp,
    organizationId: 'org_test',
    issueId,
    issueIdentifier: issueId,
    ownerId: `user_test_${timestamp}`,
    routingKey: teamKey,
    routingTags: labels,
    isTerminal: false,
    action: 'update',
    changedFields: ['labelIds'],
    labelChange: { added: labels, removed: [] },
    rawPayload: {},
  };
}

runCli(async () => {
  const { values } = parseFlags({
    'issue-id': { type: 'string' },
    label: { type: 'string' },
    'team-key': { type: 'string' },
    port: { type: 'string' },
    endpoint: { type: 'string' },
  });
  if (!values['issue-id'] || !values.label) throw new CliError(USAGE);

  const env = readEnvFile(envFilePath());
  const secret = env.RELAY_SUBSCRIBER_SECRET;
  if (!secret) {
    throw new CliError(
      'RELAY_SUBSCRIBER_SECRET not found in .env.local. Run "pnpm connect-relay" first.',
    );
  }

  const issueId = values['issue-id'].includes('-')
    ? values['issue-id']
    : `TEST-${values['issue-id']}`;
  const labels = values.label
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean);
  const event = createEvent(issueId, labels, values['team-key'] || 'DEFAULT');
  const base = values.endpoint || env.DISPATCHER_WEBHOOK_ENDPOINT || 'http://localhost';
  const url = `${base}:${values.port || env.PORT || '3000'}/webhooks/relay`;

  console.log(
    `Sending a test webhook for ${issueId} with labels ${labels.join(', ')} to ${url}...`,
  );
  const payload = JSON.stringify(event);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-relay-signature': signWebhookPayload(payload, secret),
    },
    body: payload,
  });
  const body = await response.text();
  if (!response.ok) throw new CliError(`HTTP ${response.status}: ${body}`);

  console.log(
    `Sent (${response.status}): ${body}\nWatch the dispatcher logs or the monitor TUI for the run.`,
  );
});
