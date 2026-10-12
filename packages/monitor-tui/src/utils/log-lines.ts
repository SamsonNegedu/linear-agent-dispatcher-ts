import { stripAnsi } from './logs';

export type LogLevel = 'LOG' | 'WARN' | 'ERROR' | 'DEBUG' | 'VERBOSE' | 'OTHER';
export type LevelFilter = 'all' | 'warn' | 'error';

export interface LogLine {
  time?: string;
  level: LogLevel;
  context?: string;
  message: string;
}

// Nest's default format: `[Nest] 4242  - 10/11/2026, 10:21:04 PM     LOG [Context] message`
const NEST_LINE =
  /^\[Nest\]\s+\d+\s+-\s+\S+\s+(\d{1,2}:\d{2}:\d{2}\s*[AP]M)\s+(LOG|WARN|ERROR|DEBUG|VERBOSE)\s+(?:\[([^\]]+)\]\s+)?(.*)$/;

export const parseLogLine = (raw: string): LogLine => {
  const line = stripAnsi(raw);
  const match = NEST_LINE.exec(line);
  if (!match) {
    // Stack frames and other continuation lines inherit nothing; show them as plain text.
    return { level: /\b(error|exception|failed)\b/i.test(line) ? 'ERROR' : 'OTHER', message: line };
  }
  return { time: match[1], level: match[2] as LogLevel, context: match[3], message: match[4] };
};

const RANK: Record<LogLevel, number> = {
  OTHER: 0,
  VERBOSE: 0,
  DEBUG: 0,
  LOG: 0,
  WARN: 1,
  ERROR: 2,
};
const MIN_RANK: Record<LevelFilter, number> = { all: 0, warn: 1, error: 2 };

export const matchesLevel = (line: LogLine, filter: LevelFilter): boolean =>
  RANK[line.level] >= MIN_RANK[filter];

export const LEVEL_FILTERS: readonly LevelFilter[] = ['all', 'warn', 'error'];

export const nextLevelFilter = (current: LevelFilter): LevelFilter =>
  LEVEL_FILTERS[(LEVEL_FILTERS.indexOf(current) + 1) % LEVEL_FILTERS.length];
