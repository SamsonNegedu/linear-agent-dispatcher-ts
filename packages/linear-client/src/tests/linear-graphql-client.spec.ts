import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { LinearClient } from '@linear/sdk';
import type { TokenSource } from '../app-token-provider.js';
import { LinearGraphQLClient } from '../linear-graphql.client.js';

const authError = () =>
  Object.assign(new Error('Authentication required, not authenticated'), {
    type: 'AuthenticationError',
  });

/** Hands out `tokens` in order, moving to the next one when the current one is invalidated. */
const rotatingTokens = (...tokens: string[]) => {
  let index = 0;
  const source: TokenSource & { invalidations: number } = {
    invalidations: 0,
    getToken: () => Promise.resolve(tokens[index]),
    invalidate() {
      this.invalidations++;
      index = Math.min(index + 1, tokens.length - 1);
    },
  };
  return source;
};

/** A fake SDK whose createComment only works for tokens in `accepted`. */
const fakeSdk = (accepted: string[], failure: () => Error = authError) => {
  const attempts: string[] = [];
  const createSdk = (token: string) =>
    ({
      createComment: () => {
        attempts.push(token);
        return accepted.includes(token)
          ? Promise.resolve({ commentId: 'comment_1' })
          : Promise.reject(failure());
      },
    }) as unknown as LinearClient;
  return { createSdk, attempts };
};

test('retries once on a fresh token when Linear rejects the cached one', async () => {
  const tokens = rotatingTokens('lin_oauth_old', 'lin_oauth_new');
  const { createSdk, attempts } = fakeSdk(['lin_oauth_new']);

  const result = await new LinearGraphQLClient(tokens, undefined, createSdk).createComment(
    'i',
    'hi',
  );

  assert.deepEqual(result, { id: 'comment_1' });
  assert.deepEqual(attempts, ['lin_oauth_old', 'lin_oauth_new']);
  assert.equal(tokens.invalidations, 1);
});

test('gives up after one retry when the fresh token is rejected too', async () => {
  const tokens = rotatingTokens('lin_oauth_a', 'lin_oauth_b');
  const { createSdk, attempts } = fakeSdk([]);

  await assert.rejects(
    new LinearGraphQLClient(tokens, undefined, createSdk).createComment('i', 'hi'),
    /Authentication required/,
  );

  assert.equal(attempts.length, 2);
  assert.equal(tokens.invalidations, 1);
});

test('does not retry an error that is not about authentication', async () => {
  const tokens = rotatingTokens('lin_oauth_a', 'lin_oauth_b');
  const { createSdk, attempts } = fakeSdk([], () => new Error('Entity not found'));

  await assert.rejects(
    new LinearGraphQLClient(tokens, undefined, createSdk).createComment('i', 'hi'),
    /Entity not found/,
  );

  assert.equal(attempts.length, 1);
  assert.equal(tokens.invalidations, 0);
});

test('does not retry with a fixed credential, since there is no fresh token to try', async () => {
  const { createSdk, attempts } = fakeSdk([]);

  await assert.rejects(
    new LinearGraphQLClient('lin_api_fixed', undefined, createSdk).createComment('i', 'hi'),
    /Authentication required/,
  );

  assert.equal(attempts.length, 1);
});

test('reuses one SDK client while the token stays the same, and builds a new one when it changes', async () => {
  const tokens = rotatingTokens('lin_oauth_old', 'lin_oauth_new');
  const built: string[] = [];
  const { createSdk } = fakeSdk(['lin_oauth_old', 'lin_oauth_new']);
  const client = new LinearGraphQLClient(tokens, undefined, (token) => {
    built.push(token);
    return createSdk(token);
  });

  await client.createComment('i', 'one');
  await client.createComment('i', 'two');
  tokens.invalidate();
  await client.createComment('i', 'three');

  assert.deepEqual(built, ['lin_oauth_old', 'lin_oauth_new']);
});

/** A fake SDK whose issue is in `state_now`, carries the label `agent-triage` (id `label_t`), and has this history. */
const sdkWithHistory = (
  history: Array<{ toStateId?: string; addedLabelIds?: string[]; createdAt: Date }>,
) =>
  (() =>
    ({
      issue: () =>
        Promise.resolve({
          stateId: 'state_now',
          labels: () => Promise.resolve({ nodes: [{ id: 'label_t', name: 'agent-triage' }] }),
          history: () => Promise.resolve({ nodes: history }),
        }),
    }) as unknown as LinearClient) as (token: string) => LinearClient;

const watchStartedAt = (history: Parameters<typeof sdkWithHistory>[0]) =>
  new LinearGraphQLClient('lin_api_x', undefined, sdkWithHistory(history)).getWatchStartedAt(
    'i',
    'agent-triage',
  );

test('getWatchStartedAt returns when the watched label was last added', async () => {
  const started = await watchStartedAt([
    { addedLabelIds: ['label_other'], createdAt: new Date('2026-11-06T09:00:00Z') },
    { addedLabelIds: ['label_t'], createdAt: new Date('2026-11-05T09:00:00Z') },
    { addedLabelIds: ['label_t'], createdAt: new Date('2026-11-01T09:00:00Z') },
  ]);

  assert.equal(started?.toISOString(), '2026-11-05T09:00:00.000Z');
});

test('getWatchStartedAt returns the later of the label being added and the state being entered', async () => {
  const started = await watchStartedAt([
    { toStateId: 'state_now', createdAt: new Date('2026-11-06T09:00:00Z') },
    { addedLabelIds: ['label_t'], createdAt: new Date('2026-11-05T09:00:00Z') },
  ]);

  assert.equal(started?.toISOString(), '2026-11-06T09:00:00.000Z');
});

test('getWatchStartedAt is undefined when neither the label nor the state was ever set in history', async () => {
  const started = await watchStartedAt([
    { toStateId: 'state_other', createdAt: new Date() },
    { addedLabelIds: ['label_other'], createdAt: new Date() },
  ]);

  assert.equal(started, undefined);
});
