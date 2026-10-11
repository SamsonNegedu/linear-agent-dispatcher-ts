import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { safeEqual } from './safe-equal';

test('safeEqual accepts identical strings', () => {
  assert.equal(safeEqual('abc123', 'abc123'), true);
});

test('safeEqual rejects different strings of the same length', () => {
  assert.equal(safeEqual('abc123', 'abc124'), false);
});

test('safeEqual rejects strings of different length instead of throwing', () => {
  assert.equal(safeEqual('short', 'a-much-longer-expected-value'), false);
  assert.equal(safeEqual('', 'expected'), false);
});

test('safeEqual rejects a missing value', () => {
  assert.equal(safeEqual(undefined, 'expected'), false);
  assert.equal(safeEqual(null, 'expected'), false);
});
