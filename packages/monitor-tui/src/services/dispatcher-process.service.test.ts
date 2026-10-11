import { describe, expect, test } from 'bun:test';
import { restartDispatcherServer } from './dispatcher-process.service';

describe('restartDispatcherServer', () => {
  test('refuses, without signalling anything, when no supervisor identified itself', () => {
    let error: Error | undefined;
    restartDispatcherServer('http://localhost:1/x', (e) => (error = e), undefined);

    expect(error?.message).toMatch(/pnpm monitor/);
  });

  test('refuses a malformed supervisor pid (never signals pid 0 / a process group)', () => {
    for (const bad of ['', '0', '-1', 'abc', '1.5']) {
      let error: Error | undefined;
      restartDispatcherServer('http://localhost:1/x', (e) => (error = e), bad);
      expect(error).toBeInstanceOf(Error);
    }
  });

  test('reports an error when the supervisor process does not exist', () => {
    let error: Error | undefined;
    restartDispatcherServer('http://localhost:1/x', (e) => (error = e), '2147483646');

    expect(error).toBeInstanceOf(Error);
  });
});
