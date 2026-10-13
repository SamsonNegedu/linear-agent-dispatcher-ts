# ADR 0002: OAuth Flow and Subscriber Registration

## Status

Accepted

## Context

Local dispatchers need to:

1. Prove they control a Linear workspace before the relay accepts them
2. Authenticate without sharing credentials with Linear
3. Receive webhook events for the teams of the user who registered them

The relay needs to:

1. Accept registrations only from real Linear users
2. Issue each dispatcher its own HMAC secret
3. Track which teams each dispatcher serves

## Decision

Use an OAuth flow for registration and per-dispatcher HMAC signing for delivery.

### Stage 1: OAuth with Linear (relay and Linear)

- The relay is the only OAuth app registered with Linear.
- The operator runs `connect-relay` on the dispatcher machine. The CLI calls `GET /subscribers/auth/start` on the relay and opens the returned Linear authorization URL.
- The user logs in to Linear and grants access. Linear redirects to the relay's `/callback` with an authorization code.
- The relay exchanges the code for an OAuth token. It uses the token once, to fetch the user's id and teams. It does not store the token.

### Stage 2: Subscriber registration (relay and dispatcher)

- The relay registers one subscriber for each of the user's Linear teams. All of them share the dispatcher's endpoint URL and one new `subscriberSecret`.
- The relay redirects the browser to the CLI's local listener with the secret and the team list.
- The CLI saves the secret and relay settings to `.env.local`.

### Stage 3: Webhook delivery (relay to dispatcher)

- Linear signs each webhook with the relay's `LINEAR_WEBHOOK_SECRET`. The relay verifies that signature.
- The relay looks up the subscribers for the event's team.
- The relay signs the payload with each subscriber's secret (HMAC-SHA256) and POSTs it to the subscriber's endpoint with an `X-Relay-Signature` header.
- The dispatcher verifies the signature with its stored secret.

## Consequences

### Positive

- **OAuth isolation**: only the relay holds Linear credentials. Dispatchers never see them.
- **Per-dispatcher secrets**: leaking one dispatcher's secret does not affect other dispatchers.
- **Traceable**: the relay knows which dispatcher receives which webhook.
- **Revocable**: the relay can drop a dispatcher without revoking Linear access.
- **Simple for users**: one browser login registers every team the user belongs to.

### Negative

- **Complexity**: the flow has three stages and two kinds of secret (the Linear app credentials and the subscriber HMAC secret).
- **No re-auth**: the relay keeps no OAuth token, so a user who loses their subscriber secret must run `connect-relay` again.
- **Operator burden**: the operator must keep the relay's OAuth credentials and the subscriber secrets safe.

## Alternatives Considered

### Option A: Mutual TLS (mTLS) only

- **Pros**: No OAuth needed, simpler
- **Cons**: Cannot show that a dispatcher controls the Linear workspace; credentials spread across machines

### Option B: API key issued by a relay admin

- **Pros**: Simpler than OAuth
- **Cons**: No link to Linear, so ownership is hard to validate; keys must be managed by hand

Having each dispatcher run its own OAuth flow with Linear is not re-decided here. That option is the case against having a relay at all, and
[ADR 0001](0001-relay-service-architecture.md#alternatives-considered) already rejected it.

## Implementation Notes

- The relay's Linear OAuth app credentials (`LINEAR_OAUTH_CLIENT_ID` and `LINEAR_OAUTH_CLIENT_SECRET`) are plain environment variables, loaded from `.env` and `.env.local`. The relay has no way to rotate them. This is acceptable for a single-operator deployment. Revisit it if the relay serves more operators.
- The OAuth request asks for Linear's `admin` scope.
- The OAuth `state` is signed and expires. It carries the dispatcher endpoint, the optional CLI callback URL and the relay base URL.
- The subscriber secret is 32 random bytes, hex-encoded.
- `connect-relay` writes the secret to the dispatcher's `.env.local` as `RELAY_SUBSCRIBER_SECRET`, with `RELAY_ENABLED`, `RELAY_URL`, `RELAY_DISPATCHER_URL` and `RELAY_SUBSCRIBER_ID`.
- The callback URL is `{relay_url}/callback`. It is a top-level route, not under `/subscribers`, so it can match whatever redirect URI is registered with the Linear OAuth app.
- Registration happens only through the OAuth callback. An earlier unauthenticated `POST /subscribers/register` was removed. Anyone who could reach the relay could use it to register as, or overwrite, any team's subscriber and receive that team's webhooks.
- `PATCH /subscribers` changes a subscriber's delivery URL. It requires the subscriber's id and secret, and compares the secret in constant time. Subscriber ids are guessable (`<team>:<linearUserId>`), so they identify a subscriber but do not authenticate one. An unknown id and a wrong secret both get the same 401.
- Delivery URLs must be `https://` to a public host, or `http://localhost`. The relay rejects private, loopback and link-local addresses so a registered URL cannot point the relay at internal services. The relay does not check DNS names that resolve to private addresses.
- Webhook delivery carries one signature header, `X-Relay-Signature`. The relay verifies Linear's own `linear-signature` header on the way in.
