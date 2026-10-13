#!/usr/bin/env node
/**
 * One-off migration: merge services/relay-service/.env.local and
 * services/dispatcher-service/.env.local (and the root .env) into the root .env.local.
 * Prints key names only, never values. Leaves the old files in place; delete them once
 * `pnpm dev:up` works. Run: node scripts/merge-env.mjs
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvFile, root } from './lib/stack.mjs';

const { readEnvFile } = loadEnvFile();
const target = join(root, '.env.local');
const sources = [
  join(root, '.env'),
  join(root, 'services/relay-service/.env.local'),
  join(root, 'services/dispatcher-service/.env.local'),
];
// Left over from the removed AWS/DynamoDB setup and the removed admin API; ports are now RELAY_PORT/DISPATCHER_PORT.
const dropped = new Set(['RELAY_TABLE_NAME', 'DYNAMODB_ENDPOINT', 'DYNAMODB_REGION', 'ADMIN_API_TOKEN', 'NODE_ENV']);

const merged = {};
const notes = [];
for (const file of sources.filter(existsSync)) {
  const vars = readEnvFile(file);
  const isRelay = file.includes('relay-service');
  for (const [key, value] of Object.entries(vars)) {
    if (dropped.has(key)) continue;
    let name = key;
    if (key === 'PORT') name = isRelay ? 'RELAY_PORT' : 'DISPATCHER_PORT';
    if (key === 'LINEAR_API_KEY' && merged[key] !== undefined && merged[key] !== value) {
      // Both services had a key. Prefer a personal key (lin_api_), which works for every call.
      if (!value.startsWith('lin_api_')) {
        notes.push('LINEAR_API_KEY differed: kept the lin_api_ key');
        continue;
      }
      notes.push('LINEAR_API_KEY differed: kept the lin_api_ key');
    }
    merged[name] = value;
  }
}

const quote = (v) => (/^[A-Za-z0-9_./:@+-]*$/.test(v) ? v : JSON.stringify(v));
const existing = existsSync(target) ? readFileSync(target, 'utf8') : '';
if (existing.trim()) {
  console.error(`${target} already exists and is not empty; refusing to overwrite.`);
  process.exit(1);
}
writeFileSync(target, Object.entries(merged).map(([k, v]) => `${k}=${quote(v)}`).join('\n') + '\n');
chmodSync(target, 0o600);
console.log(`Wrote ${target} (mode 0600) with ${Object.keys(merged).length} keys:`);
console.log('  ' + Object.keys(merged).join(', '));
for (const note of new Set(notes)) console.log(`Note: ${note}`);
console.log('Old files were not touched. Delete them after `pnpm dev:up` works.');
