import * as fs from 'fs';
import * as path from 'path';
import { dispatcherDir } from './env';

const LOG_TAIL_BYTES = 65536;
const LOG_MAX_LINES = 200;

const serverLogPath = path.join(dispatcherDir, 'logs', 'server.log');

// eslint-disable-next-line no-control-regex
const ansiPattern = /\x1b\[[0-9;]*m/g;
const stripAnsi = (line: string): string => line.replace(ansiPattern, '');

export const readLogTail = (): string[] => {
  try {
    const stat = fs.statSync(serverLogPath);
    const start = Math.max(0, stat.size - LOG_TAIL_BYTES);
    const fd = fs.openSync(serverLogPath, 'r');
    const length = stat.size - start;
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    fs.closeSync(fd);
    const lines = buffer.toString('utf-8').split('\n').map(stripAnsi);
    return lines.slice(-LOG_MAX_LINES);
  } catch {
    return [];
  }
};

export { LOG_TAIL_BYTES, LOG_MAX_LINES, stripAnsi };
