import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { formatValue, parseEnv, readEnvFile, updateEnvFile, upsertEnvVar } from './env-file';

test('parseEnv reads plain, exported and spaced assignments and ignores comments', () => {
  const env = parseEnv('# comment\nA=1\nexport B = two\n\n  C=3  \n#D=4\n');
  assert.deepEqual(env, { A: '1', B: 'two', C: '3' });
});

test('parseEnv keeps "=" inside values and handles quotes and inline comments', () => {
  const env = parseEnv(
    ['URL=https://x.test/?a=b&c=d', 'Q1="has space # not a comment"', "Q2='lit\\n'", 'BARE=value # trailing', 'ESC="a\\"b\\\\c\\nd"'].join('\n'),
  );
  assert.equal(env.URL, 'https://x.test/?a=b&c=d');
  assert.equal(env.Q1, 'has space # not a comment');
  assert.equal(env.Q2, 'lit\\n');
  assert.equal(env.BARE, 'value');
  assert.equal(env.ESC, 'a"b\\c\nd');
});

test('parseEnv lets a later definition win and tolerates CRLF', () => {
  assert.deepEqual(parseEnv('A=1\r\nA=2\r\n'), { A: '2' });
});

test('formatValue quotes only when needed, and round-trips through parseEnv', () => {
  assert.equal(formatValue('abc123'), 'abc123');
  for (const value of ['has space', 'with "quote"', 'back\\slash', 'multi\nline', '#hash', '', "it's", '$HOME']) {
    assert.equal(parseEnv(`K=${formatValue(value)}`).K, value, JSON.stringify(value));
  }
});

test('upsertEnvVar replaces an existing assignment and leaves other lines alone', () => {
  const out = upsertEnvVar('A=1\nB=2\nC=3\n', 'B', 'new');
  assert.equal(out, 'A=1\nB=new\nC=3\n');
});

test('upsertEnvVar uncomments a placeholder, and appends when the key is absent', () => {
  assert.equal(upsertEnvVar('A=1\n# KEY=\n', 'KEY', 'v'), 'A=1\nKEY=v\n');
  assert.equal(upsertEnvVar('A=1', 'KEY', 'v'), 'A=1\nKEY=v\n');
  assert.equal(upsertEnvVar('', 'KEY', 'v'), 'KEY=v\n');
});

test('upsertEnvVar treats the key literally (no regex surprises) and does not touch longer keys', () => {
  assert.equal(upsertEnvVar('A.B=1\nAXB=2\n', 'A.B', 'x'), 'A.B=x\nAXB=2\n');
  assert.equal(upsertEnvVar('RELAY_URL_OLD=1\n', 'RELAY_URL', 'x'), 'RELAY_URL_OLD=1\nRELAY_URL=x\n');
});

test('updateEnvFile creates the file readable only by its owner and keeps existing content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'env-file-'));
  const path = join(dir, '.env.local');
  writeFileSync(path, 'KEEP=1\n', { mode: 0o644 });

  updateEnvFile(path, { SECRET: 'a b', OTHER: 'x' });

  assert.equal(readFileSync(path, 'utf-8'), 'KEEP=1\nSECRET="a b"\nOTHER=x\n');
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(readEnvFile(path), { KEEP: '1', SECRET: 'a b', OTHER: 'x' });
});

test('readEnvFile returns an empty object for a missing file', () => {
  assert.deepEqual(readEnvFile('/nonexistent/path/.env'), {});
});
