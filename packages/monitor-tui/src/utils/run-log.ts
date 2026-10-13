import * as fs from 'fs';
import * as path from 'path';
import { dispatcherDir } from './env';
import { readLogTail } from './logs';

const runsDir = path.join(dispatcherDir, 'logs', 'runs');

export interface RunLogEntry {
  path: string;
  issue: string;
  skill: string;
  mtime: number;
  active: boolean;
}

// A run that crashed never writes its `result` event, so stop calling it active after this.
const STALE_MS = 10 * 60_000;
const FILE_NAME = /^(.+)__(.+)__\d{4}-\d{2}-\d{2}T[\d-]+Z\.log$/;

const isFinished = (logPath: string): boolean =>
  readLogTail(logPath).some((line) => line.includes('"type":"result"'));

/** Run logs, newest first. `active` = still being written (no result event yet). */
export const listRunLogs = (dir: string = runsDir, now: number = Date.now()): RunLogEntry[] => {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => FILE_NAME.test(f))
      .map((f) => {
        const [, issue, skill] = FILE_NAME.exec(f)!;
        const full = path.join(dir, f);
        const mtime = fs.statSync(full).mtimeMs;
        return { path: full, issue, skill, mtime, active: false };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .map((e, i) =>
        // Only the freshest few can be live; skip reading the rest.
        i < 20 && now - e.mtime < STALE_MS ? { ...e, active: !isFinished(e.path) } : e,
      );
  } catch {
    return [];
  }
};

const oneLine = (value: unknown, max = 160): string => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

interface Block {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  is_error?: boolean;
}

/** Turns one stream-json line from `claude -p` into short readable lines. */
export const formatRunEvent = (raw: string): string[] => {
  let event: { type?: string; subtype?: string; message?: { content?: unknown }; result?: string };
  try {
    event = JSON.parse(raw);
  } catch {
    return raw.trim() ? [raw] : [];
  }
  if (event.type === 'system') return [`session ${event.subtype ?? 'event'}`];
  if (event.type === 'result') return [`DONE ${oneLine(event.result)}`];
  const content = event.message?.content;
  if (!Array.isArray(content)) return typeof content === 'string' ? [oneLine(content)] : [];
  return (content as Block[]).flatMap((b) => {
    if (b.type === 'text' && b.text) return [oneLine(b.text)];
    if (b.type === 'tool_use') return [`→ ${b.name} ${oneLine(b.input, 120)}`];
    if (b.type === 'tool_result') return [`${b.is_error ? '✗' : '←'} ${oneLine(b.content, 120)}`];
    return [];
  });
};

export const readRunLogTail = (logPath: string): string[] =>
  readLogTail(logPath).flatMap(formatRunEvent);
