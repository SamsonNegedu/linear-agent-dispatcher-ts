import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LOG_MAX_LINES, LOG_TAIL_BYTES, readLogTail, stripAnsi, tailLines } from './logs';

describe('stripAnsi', () => {
  test('removes colors, cursor moves, erase-line and OSC titles', () => {
    expect(stripAnsi('\x1b[32mLOG\x1b[39m ok')).toBe('LOG ok');
    expect(stripAnsi('a\x1b[2K\x1b[1Gb')).toBe('ab');
    expect(stripAnsi('\x1b]0;title\x07text')).toBe('text');
    expect(stripAnsi('\x1b[38;5;3m[Nest]\x1b[39m')).toBe('[Nest]');
  });

  test('leaves plain text alone', () => {
    expect(stripAnsi('plain [text] 100%')).toBe('plain [text] 100%');
  });
});

describe('tailLines', () => {
  const bytes = (text: string) => Buffer.from(text, 'utf-8');

  test('splits lines, handles CRLF and drops the empty line after a trailing newline', () => {
    expect(tailLines(bytes('a\r\nb\nc\n'), false)).toEqual(['a', 'b', 'c']);
  });

  test('keeps a blank line in the middle', () => {
    expect(tailLines(bytes('a\n\nb\n'), false)).toEqual(['a', '', 'b']);
  });

  test('drops the first, partial line when the read started mid-file', () => {
    expect(tailLines(bytes('rtial line\nfull 1\nfull 2\n'), true)).toEqual(['full 1', 'full 2']);
  });

  test('does not show a garbled line when the cut lands inside a multi-byte character', () => {
    const emoji = Buffer.from('🚀 launch\nnext\n', 'utf-8');
    const cutInsideEmoji = emoji.subarray(2); // starts on a continuation byte
    expect(tailLines(cutInsideEmoji, true)).toEqual(['next']);
  });

  test('keeps only the most recent lines', () => {
    const text = Array.from({ length: LOG_MAX_LINES + 50 }, (_, i) => `line ${i}`).join('\n');
    const lines = tailLines(bytes(text), false);
    expect(lines).toHaveLength(LOG_MAX_LINES);
    expect(lines.at(-1)).toBe(`line ${LOG_MAX_LINES + 49}`);
  });
});

describe('readLogTail', () => {
  const tempLog = (content: string) => {
    const file = join(mkdtempSync(join(tmpdir(), 'logs-')), 'server.log');
    writeFileSync(file, content);
    return file;
  };

  test('returns [] for a missing file', () => {
    expect(readLogTail('/nonexistent/server.log')).toEqual([]);
  });

  test('reads a small file in full', () => {
    expect(readLogTail(tempLog('\x1b[32mone\x1b[39m\ntwo\n'))).toEqual(['one', 'two']);
  });

  test('reads only the tail of a large file and starts on a whole line', () => {
    const line = 'x'.repeat(99);
    const lines = readLogTail(tempLog(`${(line + '\n').repeat(2000)}`));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(LOG_MAX_LINES);
    expect(lines.every((l) => l === line)).toBe(true);
    expect(LOG_TAIL_BYTES).toBeGreaterThan(0);
  });
});
