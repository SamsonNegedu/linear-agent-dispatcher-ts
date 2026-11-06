import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { AppTokenProvider, APP_TOKEN_SCOPES } from '../app-token-provider.js';
import { chooseAppCredential } from '../credential.js';

const DAY_MS = 86_400_000;

const tokenResponse = (token: string, expiresIn = 30 * 86_400) =>
  new Response(JSON.stringify({ access_token: token, expires_in: expiresIn }), { status: 200 });

const fakeFetch = (...responses: Response[]) => {
  const calls: Array<{ url: string; body: URLSearchParams }> = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: init.body as URLSearchParams });
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra request');
    return next;
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
};

const provider = (fetchFn: typeof fetch, now: () => number) =>
  new AppTokenProvider({ clientId: 'id', clientSecret: 'shh', fetchFn, now });

test('requests an app token with client credentials and the shared scopes', async () => {
  const { fetchFn, calls } = fakeFetch(tokenResponse('lin_oauth_a'));

  assert.equal(await provider(fetchFn, () => 0).getToken(), 'lin_oauth_a');

  assert.equal(calls[0].url, 'https://api.linear.app/oauth/token');
  assert.equal(calls[0].body.get('grant_type'), 'client_credentials');
  assert.equal(calls[0].body.get('scope'), APP_TOKEN_SCOPES);
  assert.equal(calls[0].body.get('client_id'), 'id');
});

test('reuses the cached token until it is close to expiry, then fetches a new one', async () => {
  let now = 0;
  const { fetchFn, calls } = fakeFetch(tokenResponse('lin_oauth_a'), tokenResponse('lin_oauth_b'));
  const source = provider(fetchFn, () => now);

  assert.equal(await source.getToken(), 'lin_oauth_a');
  now = 29 * DAY_MS;
  assert.equal(await source.getToken(), 'lin_oauth_a');
  assert.equal(calls.length, 1);

  now = 30 * DAY_MS - 60_000; // inside the renewal margin
  assert.equal(await source.getToken(), 'lin_oauth_b');
  assert.equal(calls.length, 2);
});

test('invalidate forces a new token on the next call', async () => {
  const { fetchFn } = fakeFetch(tokenResponse('lin_oauth_a'), tokenResponse('lin_oauth_b'));
  const source = provider(fetchFn, () => 0);

  await source.getToken();
  source.invalidate();

  assert.equal(await source.getToken(), 'lin_oauth_b');
});

test('concurrent callers share one token request', async () => {
  const { fetchFn, calls } = fakeFetch(tokenResponse('lin_oauth_a'));
  const source = provider(fetchFn, () => 0);

  const tokens = await Promise.all([source.getToken(), source.getToken(), source.getToken()]);

  assert.deepEqual(tokens, ['lin_oauth_a', 'lin_oauth_a', 'lin_oauth_a']);
  assert.equal(calls.length, 1);
});

test('a refused request explains the fix and does not leak the client secret', async () => {
  const { fetchFn } = fakeFetch(
    new Response(JSON.stringify({ error: 'invalid_client', error_description: 'bad client' }), {
      status: 401,
    }),
  );

  await assert.rejects(provider(fetchFn, () => 0).getToken(), (error: Error) => {
    assert.match(error.message, /401/);
    assert.match(error.message, /client credentials tokens/);
    assert.doesNotMatch(error.message, /shh/);
    return true;
  });
});

test('a failed request does not poison later calls', async () => {
  const { fetchFn } = fakeFetch(new Response('{}', { status: 500 }), tokenResponse('lin_oauth_a'));
  const source = provider(fetchFn, () => 0);

  await assert.rejects(source.getToken());
  assert.equal(await source.getToken(), 'lin_oauth_a');
});

test('chooseAppCredential prefers client credentials, then the agent token, then the API key', () => {
  const creds = { oauthClientId: 'id', oauthClientSecret: 'shh' };

  assert.ok(
    chooseAppCredential({ ...creds, agentToken: 'lin_oauth_x', apiKey: 'lin_api_y' }) instanceof
      AppTokenProvider,
  );
  assert.equal(
    chooseAppCredential({ agentToken: 'lin_oauth_x', apiKey: 'lin_api_y' }),
    'lin_oauth_x',
  );
  assert.equal(chooseAppCredential({ apiKey: 'lin_api_y' }), 'lin_api_y');
  assert.equal(chooseAppCredential({ oauthClientId: 'id' }), undefined);
});
