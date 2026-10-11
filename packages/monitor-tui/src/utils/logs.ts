import * as fs from 'fs';
import * as path from 'path';
import { dispatcherDir } from './env';

const LOG_TAIL_BYTES = 65536;
const LOG_MAX_LINES = 200;

const serverLogPath = path.join(dispatcherDir, 'logs', 'server.log');

// Every escape sequence a logger may emit, not just colors: CSI (`ESC [ … final`, which
// includes cursor moves and erase-line), OSC (`ESC ] … BEL|ST`, e.g. window titles), and
// two-character escapes. Left in, they corrupt the TUI's layout.
// eslint-disable-next-line no-control-regex
const ansiPattern = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;
const stripAnsi = (line: string): string => line.replace(ansiPattern, '');

/**
 * Turns the raw tail of a log file into display lines. When the read started mid-file
 * (`startedMidFile`), the first line is a fragment, and may even begin inside a multi-byte
 * character, so it is dropped rather than shown garbled.
 */
export const tailLines = (bytes: Buffer, startedMidFile: boolean): string[] => {
  const lines = new TextDecoder('utf-8').decode(bytes).split(/\r?\n/);
  if (startedMidFile) lines.shift();
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop(); // trailing newline
  return lines.map(stripAnsi).slice(-LOG_MAX_LINES);
};

export const readLogTail = (logPath: string = serverLogPath): string[] => {
  let fd: number | undefined;
  try {
    fd = fs.openSync(logPath, 'r');
    const { size } = fs.fstatSync(fd);
    const start = Math.max(0, size - LOG_TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    return tailLines(buffer, start > 0);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
};

export { LOG_TAIL_BYTES, LOG_MAX_LINES, stripAnsi };
