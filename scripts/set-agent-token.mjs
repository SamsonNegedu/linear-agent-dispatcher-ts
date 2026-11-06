#!/usr/bin/env node
/**
 * One-off: copy the old relay-service LINEAR_API_KEY (a lin_oauth_ app token) into the root
 * .env.local as LINEAR_AGENT_TOKEN. Prints no values. Run: node scripts/set-agent-token.mjs
 */
import { join } from 'node:path';
import { loadEnvFile, root } from './lib/stack.mjs';

const { readEnvFile, updateEnvFile } = loadEnvFile();
const old = readEnvFile(join(root, 'services/relay-service/.env.local')).LINEAR_API_KEY;
if (!old?.startsWith('lin_oauth_')) {
  console.error(
    'The old relay .env.local has no lin_oauth_ LINEAR_API_KEY. Add LINEAR_AGENT_TOKEN to .env.local yourself.',
  );
  process.exit(1);
}
updateEnvFile(join(root, '.env.local'), { LINEAR_AGENT_TOKEN: old });
console.log('Set LINEAR_AGENT_TOKEN in .env.local. Restart pnpm dev:up.');
