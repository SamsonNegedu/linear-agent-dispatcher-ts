// Hosts a webhook delivery must never target: loopback, private (RFC 1918), link-local and
// IPv6 unique-local addresses. Without this, a registered endpoint could make the relay call
// services on its own network. URL parsing already normalizes odd IPv4 spellings
// (http://2130706433 -> 127.0.0.1) and wraps IPv6 hosts in brackets.
const PRIVATE_HOST =
  /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[(::1?|f[cd][0-9a-f]{2}:.*|fe80:.*)\]$)/i;

const parse = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const isLocalhost = (url: URL): boolean => url.protocol === 'http:' && url.hostname === 'localhost';

/** Where the relay may deliver webhooks: https to a public host, or http://localhost for dev. */
export const isValidWebhookEndpoint = (value: string): boolean => {
  const url = parse(value);
  if (!url) return false;
  if (isLocalhost(url)) return true;
  return (
    url.protocol === 'https:' && !PRIVATE_HOST.test(url.hostname) && url.hostname !== 'localhost'
  );
};

/** A local CLI listener the OAuth callback may redirect to. */
export const isLocalhostUrl = (value: string): boolean => {
  const url = parse(value);
  return !!url && isLocalhost(url);
};

/** A base URL for OAuth redirects: https anywhere, or http://localhost. */
export const isValidRelayUrl = (value: string): boolean => {
  const url = parse(value);
  return !!url && (url.protocol === 'https:' || isLocalhost(url));
};
