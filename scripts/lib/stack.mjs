/**
 * Helpers shared by scripts/dev-up.mjs and services/dispatcher-service/scripts/monitor.js:
 * start a service in its own process group with its output going to a log file, wait for it
 * to answer HTTP, and stop the whole group. (Killing only the `pnpm`/`npx` wrapper leaves its
 * `node` child running and holding the port.)
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Builds and loads @linear-agent/env-file (parse/update .env files, 0600 permissions). */
export function loadEnvFile() {
  execFileSync('pnpm', ['--silent', '--filter', '@linear-agent/env-file', 'build'], {
    cwd: root,
    stdio: 'ignore',
  });
  return createRequire(import.meta.url)(join(root, 'packages/env-file/dist/index.js'));
}

/**
 * Starts `command` detached (own process group) with stdout/stderr appended to `logFile`.
 * `onExit(code)` runs when it exits on its own.
 */
export function startService({ command, args = [], cwd, env = process.env, logFile, onExit }) {
  mkdirSync(dirname(logFile), { recursive: true });
  const log = openSync(logFile, 'a');
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', log, log], detached: true });
  if (onExit) child.on('exit', onExit);
  return child;
}

/** Signals the service's whole process group; safe to call twice or on a dead process. */
export function killGroup(child, signal = 'SIGTERM') {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // already gone
  }
}

/** True if `url` answers at all (any status), e.g. to detect a port that is already taken. */
export async function isHttpUp(url) {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Polls `url` until `accept(response)` is true (default: any HTTP response).
 * Resolves false on timeout, or as soon as `isAlive()` returns false.
 */
export async function waitForHttp(
  url,
  { timeoutMs = 30_000, intervalMs = 300, accept = () => true, isAlive = () => true } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && isAlive()) {
    try {
      if (accept(await fetch(url))) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

/** Polls until `url` stops answering (e.g. the old server released its port). False on timeout. */
export async function waitForHttpDown(url, { timeoutMs = 15_000, intervalMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isHttpUp(url))) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}
