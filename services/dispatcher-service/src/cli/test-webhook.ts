#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { randomUUID } from 'crypto';
import { signWebhookPayload } from '@webhook-verify/core';
import type { VerifiedEvent } from '@webhook-verify/core';

interface CLIArgs {
  issueId: string;
  label: string;
  teamKey?: string;
  port?: number;
  endpoint?: string;
}

function parseArgs(): CLIArgs {
  const args: CLIArgs = {
    issueId: '',
    label: '',
  };

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith('--issue-id=')) {
      args.issueId = arg.split('=')[1];
    } else if (arg.startsWith('--label=')) {
      args.label = arg.split('=')[1];
    } else if (arg.startsWith('--team-key=')) {
      args.teamKey = arg.split('=')[1];
    } else if (arg.startsWith('--port=')) {
      args.port = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--endpoint=')) {
      args.endpoint = arg.split('=')[1];
    }
  }

  if (!args.issueId || !args.label) {
    console.error(
      'Usage: test-webhook --issue-id=<ID> --label=<LABEL> [--team-key=<KEY>] [--port=<PORT>] [--endpoint=<URL>]',
    );
    console.error('');
    console.error('Examples:');
    console.error('  pnpm test-webhook -- --issue-id=LIN-123 --label=agent-implement');
    console.error('  pnpm test-webhook -- --issue-id=LIN-456 --label=agent-plan --team-key=ENG');
    process.exit(1);
  }

  return args;
}

function loadConfig() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error(
      '.env.local not found. Make sure you are in services/dispatcher-service directory.',
    );
    process.exit(1);
  }

  const env: Record<string, string> = {};
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [key, ...valueParts] = line.split('=');
    env[key.trim()] = valueParts.join('=').trim();
  }

  const secret = env['RELAY_SUBSCRIBER_SECRET'];
  if (!secret) {
    console.error(
      'RELAY_SUBSCRIBER_SECRET not found in .env.local. Run "pnpm connect-relay" first.',
    );
    process.exit(1);
  }

  return {
    secret,
    port: parseInt(env['PORT'] || '3000', 10),
    endpoint: env['DISPATCHER_WEBHOOK_ENDPOINT'] || 'http://localhost',
  };
}

function createVerifiedEvent(args: CLIArgs): VerifiedEvent {
  const issueId = args.issueId.includes('-') ? args.issueId : `TEST-${args.issueId}`;
  const issueIdentifier = issueId;

  const timestamp = Date.now();

  return {
    webhookId: randomUUID(),
    idempotencyKey: `issue:${issueId}:update:${timestamp}`,
    timestamp,
    teamId: `team_${args.teamKey || 'default'}`,
    teamKey: args.teamKey || 'DEFAULT',
    assigneeId: `user_test_${Date.now()}`,
    issueId,
    issueIdentifier,
    labels: [args.label],
    organizationId: 'org_test',
    type: 'Issue',
    action: 'update',
    labelChange: {
      added: [args.label],
      removed: [],
    },
    rawPayload: {},
  };
}

async function sendWebhook(
  event: VerifiedEvent,
  config: ReturnType<typeof loadConfig>,
): Promise<void> {
  const payload = JSON.stringify(event);
  const signature = signWebhookPayload(payload, config.secret);
  const url = new URL(`${config.endpoint}:${config.port}/webhooks/relay`);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'x-relay-signature': signature,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log(`✓ Webhook sent successfully (${res.statusCode})`);
          console.log(`  Response: ${data}`);
          console.log('');
          console.log('Watch logs:');
          console.log('  1. Check dispatcher logs (pnpm dev:watch): look for "Received webhook"');
          console.log(
            '  2. Check database: sqlite3 ./data/dispatcher.db "SELECT * FROM issue_runs ORDER BY startedAt DESC LIMIT 1;"',
          );
          resolve();
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  try {
    const args = parseArgs();
    const config = loadConfig();
    const event = createVerifiedEvent(args);

    console.log(
      `Sending test webhook for issue ${event.issueIdentifier} with label "${args.label}"...`,
    );
    await sendWebhook(event, config);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (require.main === module) {
  void main();
}
