import { isLocalhostUrl, isValidRelayUrl, isValidWebhookEndpoint } from '../endpoint-validation';

describe('isValidWebhookEndpoint', () => {
  it.each([
    'https://dispatcher.example.com/webhooks/relay',
    'https://my-machine.tailnet.ts.net/webhooks/relay',
    'http://localhost:3000/webhooks/relay',
    'https://172.15.0.1/x', // just outside 172.16.0.0/12
    'https://172.32.0.1/x',
  ])('accepts %s', (url) => {
    expect(isValidWebhookEndpoint(url)).toBe(true);
  });

  it.each([
    'http://example.com/webhooks/relay', // plain http to a remote host
    'http://127.0.0.1:3000/x', // only the name localhost is allowed over http
    'https://127.0.0.1/x',
    'https://localhost/x',
    'https://10.0.0.5/x',
    'https://172.16.0.1/x',
    'https://172.31.255.255/x',
    'https://192.168.1.10/x',
    'https://169.254.169.254/latest/meta-data', // cloud metadata endpoint
    'https://0.0.0.0/x',
    'https://[::1]/x',
    'https://[fd12:3456::1]/x',
    'https://[fe80::1]/x',
    'https://2130706433/x', // decimal spelling of 127.0.0.1
    'ftp://example.com/x',
    'javascript:alert(1)',
    'not a url',
    '',
  ])('rejects %s', (url) => {
    expect(isValidWebhookEndpoint(url)).toBe(false);
  });
});

describe('isLocalhostUrl / isValidRelayUrl', () => {
  it('accepts only http://localhost for a CLI callback', () => {
    expect(isLocalhostUrl('http://localhost:3333/relay-callback')).toBe(true);
    expect(isLocalhostUrl('https://localhost:3333/x')).toBe(false);
    expect(isLocalhostUrl('http://evil.example.com/x')).toBe(false);
    expect(isLocalhostUrl('nope')).toBe(false);
  });

  it('accepts https anywhere, or http://localhost, as a relay base URL', () => {
    expect(isValidRelayUrl('https://relay.example.com')).toBe(true);
    expect(isValidRelayUrl('http://localhost:3001')).toBe(true);
    expect(isValidRelayUrl('http://relay.example.com')).toBe(false);
    expect(isValidRelayUrl('nope')).toBe(false);
  });
});
