import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Reads one value: quoted ("..." with escapes, '...' literal) or bare (up to an inline ` #` comment). */
function parseValue(raw: string): string {
  const value = raw.trim();
  const quote = value[0];

  if (quote === '"' || quote === "'") {
    for (let i = 1; i < value.length; i++) {
      if (value[i] === '\\' && quote === '"') {
        i++; // skip the escaped character
      } else if (value[i] === quote) {
        const inner = value.slice(1, i);
        return quote === "'"
          ? inner
          : inner.replace(/\\(["\\nr])/g, (_m, c: string) => ({ n: '\n', r: '\r' })[c] ?? c);
      }
    }
    // No closing quote: fall through and treat it as a bare value.
  }

  const comment = value.search(/\s#/);
  return (comment === -1 ? value : value.slice(0, comment)).trim();
}

/** Parses .env text into a key/value map. Later definitions of a key win. */
export function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const match = ASSIGNMENT.exec(line);
    if (match) env[match[1]] = parseValue(match[2]);
  }
  return env;
}

/** Formats a value so parseEnv (and dotenv) read back exactly the same string. */
export function formatValue(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]*$/.test(value)) return value;
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
  return `"${escaped}"`;
}

/**
 * Sets `KEY=value` in .env text. Replaces the existing assignment; otherwise uncomments a
 * placeholder such as `# KEY=`; otherwise appends. Other lines are left untouched.
 */
export function upsertEnvVar(text: string, key: string, value: string): string {
  const line = `${key}=${formatValue(value)}`;
  const lines = text.split('\n');
  const name = escapeRegExp(key);

  const active = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`);
  const placeholder = new RegExp(`^\\s*#\\s*${name}\\s*=`);
  let index = lines.findIndex((l) => active.test(l));
  if (index === -1) index = lines.findIndex((l) => placeholder.test(l));

  if (index !== -1) {
    lines[index] = line;
    return lines.join('\n');
  }
  const base = text.length > 0 && !text.endsWith('\n') ? `${text}\n` : text;
  return `${base}${line}\n`;
}

export function readEnvFile(path: string): Record<string, string> {
  return existsSync(path) ? parseEnv(readFileSync(path, 'utf-8')) : {};
}

/**
 * Writes the file readable by the owner only (these files hold secrets), through a temp
 * file + rename so a crash never leaves it half-written.
 */
export function writeEnvFile(path: string, text: string): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, text, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, path);
}

/** Sets several variables in a file (creating it if needed), keeping everything else. */
export function updateEnvFile(path: string, variables: Record<string, string>): void {
  let text = existsSync(path) ? readFileSync(path, 'utf-8') : '';
  for (const [key, value] of Object.entries(variables)) text = upsertEnvVar(text, key, value);
  writeEnvFile(path, text);
}

/**
 * The repo's single env file: `.env.local` in the directory that holds `pnpm-workspace.yaml`,
 * found by walking up from `startDir`. Falls back to `startDir` when no workspace root exists.
 */
export function rootEnvFile(startDir: string = process.cwd()): string {
  let dir = resolve(startDir);
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) return join(resolve(startDir), '.env.local');
    dir = parent;
  }
  return join(dir, '.env.local');
}
