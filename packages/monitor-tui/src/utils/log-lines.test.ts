import { describe, expect, test } from 'bun:test';
import { matchesLevel, nextLevelFilter, parseLogLine } from './log-lines';

describe('parseLogLine', () => {
  test('splits a Nest log line into time, level, context and message', () => {
    expect(
      parseLogLine(
        '\x1b[32m[Nest] 42205  - 10/11/2026, 10:21:04 PM     LOG\x1b[39m [DispatcherService] Dispatching webhook: wh_1',
      ),
    ).toEqual({
      time: '10:21:04 PM',
      level: 'LOG',
      context: 'DispatcherService',
      message: 'Dispatching webhook: wh_1',
    });
  });

  test('reads warnings and errors', () => {
    expect(
      parseLogLine('[Nest] 1  - 10/11/2026, 9:05:00 AM   ERROR [Executor] Run failed').level,
    ).toBe('ERROR');
    expect(
      parseLogLine('[Nest] 1  - 10/11/2026, 9:05:00 AM    WARN [Config] Missing key').level,
    ).toBe('WARN');
  });

  test('keeps non-Nest lines as plain text, treating obvious errors as errors', () => {
    expect(parseLogLine('    at Object.<anonymous> (file.ts:10:5)')).toEqual({
      level: 'OTHER',
      message: '    at Object.<anonymous> (file.ts:10:5)',
    });
    expect(parseLogLine('Error: GraphQL request failed').level).toBe('ERROR');
  });
});

describe('level filter', () => {
  const line = (level: 'LOG' | 'WARN' | 'ERROR') => ({ level, message: '' });

  test('all shows everything, warn hides plain logs, error shows only errors', () => {
    expect([line('LOG'), line('WARN'), line('ERROR')].map((l) => matchesLevel(l, 'all'))).toEqual([
      true,
      true,
      true,
    ]);
    expect([line('LOG'), line('WARN'), line('ERROR')].map((l) => matchesLevel(l, 'warn'))).toEqual([
      false,
      true,
      true,
    ]);
    expect([line('LOG'), line('WARN'), line('ERROR')].map((l) => matchesLevel(l, 'error'))).toEqual(
      [false, false, true],
    );
  });

  test('cycles all -> warn -> error -> all', () => {
    expect(nextLevelFilter('all')).toBe('warn');
    expect(nextLevelFilter('warn')).toBe('error');
    expect(nextLevelFilter('error')).toBe('all');
  });
});
