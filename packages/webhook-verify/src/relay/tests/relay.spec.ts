import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { signWebhookPayload, verifyWebhookSignature } from '../index';

test('verifyWebhookSignature accepts what signWebhookPayload produced', () => {
  const signature = signWebhookPayload('{"x":1}', 'secret');
  assert.match(signature, /^sha256=[0-9a-f]{64}$/);
  assert.equal(verifyWebhookSignature('{"x":1}', signature, 'secret'), true);
});

test('verifyWebhookSignature rejects tampered, wrong-secret, malformed and missing signatures', () => {
  const signature = signWebhookPayload('{"x":1}', 'secret');
  assert.equal(verifyWebhookSignature('{"x":2}', signature, 'secret'), false);
  assert.equal(verifyWebhookSignature('{"x":1}', signature, 'other'), false);
  assert.equal(verifyWebhookSignature('{"x":1}', 'sha256=abc', 'secret'), false);
  assert.equal(verifyWebhookSignature('{"x":1}', '', 'secret'), false);
  assert.equal(verifyWebhookSignature('{"x":1}', undefined, 'secret'), false);
});
