#!/usr/bin/env node
import * as path from 'path';
import { existsSync } from 'fs';
import { readEnvFile, updateEnvFile } from '@linear-agent/env-file';

interface UpdateConfig {
  relayUrl: string;
  subscriberSecret: string;
  subscriberId?: string;
  localEndpoint: string;
}

function parseArgs(): UpdateConfig {
  const args = process.argv.slice(2);
  const config: Partial<UpdateConfig> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Support both --flag=value and --flag value formats
    if (arg.startsWith('--relay-url=')) {
      config.relayUrl = arg.split('=')[1];
    } else if (arg === '--relay-url' && args[i + 1]) {
      config.relayUrl = args[++i];
    } else if (arg.startsWith('--local-endpoint=')) {
      config.localEndpoint = arg.split('=')[1];
    } else if (arg === '--local-endpoint' && args[i + 1]) {
      config.localEndpoint = args[++i];
    }
  }

  if (!config.localEndpoint) {
    console.error('❌ Missing required --local-endpoint flag');
    console.error(
      'Usage: pnpm update-relay --local-endpoint=https://new.server.com [--relay-url=http://localhost:3001]',
    );
    process.exit(1);
  }

  // Load relay URL from .env.local or use default
  const envPath = path.join(process.cwd(), '.env.local');
  if (!existsSync(envPath)) {
    console.error('❌ .env.local not found. Run pnpm connect-relay first.');
    process.exit(1);
  }

  const env = readEnvFile(envPath);
  const relayUrl = config.relayUrl || env.RELAY_URL;
  const subscriberSecret = env.RELAY_SUBSCRIBER_SECRET;
  const subscriberId = env.RELAY_SUBSCRIBER_ID;

  if (!relayUrl) {
    console.error(
      '❌ RELAY_URL not found in .env.local. Pass --relay-url or set it in your .env.local',
    );
    process.exit(1);
  }

  if (!subscriberSecret) {
    console.error(
      '❌ RELAY_SUBSCRIBER_SECRET not found in .env.local. Run pnpm connect-relay first.',
    );
    process.exit(1);
  }

  return {
    relayUrl,
    subscriberSecret,
    subscriberId: subscriberId || undefined,
    localEndpoint: config.localEndpoint,
  };
}

function saveDispatcherUrl(dispatcherUrl: string): void {
  try {
    updateEnvFile(path.join(process.cwd(), '.env.local'), { RELAY_DISPATCHER_URL: dispatcherUrl });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`⚠️  Failed to persist RELAY_DISPATCHER_URL to .env.local: ${errorMsg}`);
  }
}

async function updateRelay(config: UpdateConfig): Promise<void> {
  const url = new URL('/subscribers', config.relayUrl);

  console.log('\n🔄 Updating relay subscription endpoint...\n');
  console.log(`  Relay URL: ${config.relayUrl}`);
  console.log(`  New endpoint: ${config.localEndpoint}`);
  console.log(`  Secret (last 8 chars): ...${config.subscriberSecret.slice(-8)}\n`);

  try {
    const webhookUrl = `${config.localEndpoint}/webhooks/relay`;
    const body: Record<string, string> = {
      subscriberSecret: config.subscriberSecret,
      localEndpoint: webhookUrl,
    };
    if (config.subscriberId) {
      body.subscriberId = config.subscriberId;
    }

    const response = await fetch(url.toString(), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`❌ Failed: HTTP ${response.status}`);
      console.error(body);
      process.exit(1);
    }

    const result = (await response.json()) as Record<string, unknown>;

    console.log('✅ Subscription endpoint updated successfully!\n');
    console.log(`  Subscriber ID: ${String(result.subscriberId)}`);
    console.log(`  New endpoint: ${String(result.localEndpoint)}`);
    console.log(`  Message: ${String(result.message)}\n`);

    saveDispatcherUrl(config.localEndpoint);
  } catch (error) {
    console.error('❌ Connection error:', error instanceof Error ? error.message : error);
    console.error('Make sure the relay service is running and accessible at:', config.relayUrl);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  try {
    const config = parseArgs();
    await updateRelay(config);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('❌ Error:', errorMsg);
    process.exit(1);
  }
}

void main();
