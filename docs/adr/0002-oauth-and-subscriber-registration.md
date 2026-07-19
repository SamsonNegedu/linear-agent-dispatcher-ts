# ADR 0002: OAuth Flow and Subscriber Registration

## Status

Accepted

## Context

Local dispatchers need to:

1. Prove they own/control a workspace to register with the relay
2. Authenticate securely without sharing credentials with Linear
3. Subscribe to webhook events for specific domains

The relay needs to:

1. Authorize registrations (only valid dispatchers can register)
2. Manage per-dispatcher secrets for HMAC signing
3. Track which teams/domains each dispatcher serves

## Decision

Implement a two-stage OAuth + HMAC flow:

### Stage 1: OAuth with Linear (Relay → Linear)

- Relay registers as a single OAuth app with Linear
- Admin/user initiates registration from their local dispatcher
- Relay redirects to Linear OAuth, user logs in, grants webhook scope
- Linear returns authorization code to relay callback
- Relay exchanges code for OAuth token, used immediately to fetch the user's
  Linear team context (not persisted — see Implementation Notes)

### Stage 2: Dispatcher Registration (Dispatcher → Relay)

- Dispatcher receives OAuth token from relay (via browser callback)
- Dispatcher uses token to fetch Linear team context (team key, workspace info)
- Dispatcher registers with relay, providing:
  - team key (unique identifier from Linear)
  - local endpoint URL (https://my-dispatcher.example.com)
  - domain filters (which Linear issue domains to subscribe to)
- Relay returns a `subscriberSecret` (HMAC key for this dispatcher)
- Dispatcher stores secret securely for signature verification

### Stage 3: Webhook Delivery (Relay → Dispatcher)

- Relay receives Linear webhook (already signed by Linear with relay's key)
- Relay verifies Linear signature (using OAuth token)
- Relay looks up subscriber registry by domain/team
- Relay signs webhook payload with subscriber's secret
- Relay POST to dispatcher endpoint with HMAC-SHA256 signature header
- Dispatcher verifies signature using stored secret

## Consequences

### Positive

- **OAuth isolation**: relay holds Linear credentials, not duplicated across dispatchers
- **Per-dispatcher secrets**: compromising one dispatcher secret doesn't affect others
- **Traceable**: relay knows exactly which dispatcher receives which webhook
- **Revocable**: can disable a dispatcher without revoking Linear access
- **User-friendly**: team admin does OAuth flow once, dispatchers auto-register

### Negative

- **Complexity**: three-stage flow with two secrets (OAuth token + HMAC key)
- **Token rotation**: relay must handle OAuth token refresh
- **Operator burden**: need to securely manage AWS Secrets Manager and secret rotation policy

## Alternatives Considered

### Option A: Mutual TLS (mTLS) only

- **Pros**: No OAuth needed, simpler
- **Cons**: No way to know if dispatcher actually controls the Linear workspace; credential sprawl

### Option B: API key issued by relay admin

- **Pros**: Simpler than OAuth
- **Cons**: No connection to Linear; hard to validate ownership; manual key management

Each dispatcher running its own OAuth flow with Linear (instead of one
relay-managed integration) isn't re-litigated here — that's the relay's
existence itself, already decided and rejected in
[ADR 0001](0001-relay-service-architecture.md#alternatives-considered).

## Implementation Notes

- Relay's Linear OAuth app credentials (`LINEAR_OAUTH_CLIENT_ID`/`_SECRET`) are
  plain environment variables today, not AWS Secrets Manager — no rotation
  mechanism exists. Acceptable at current scale; revisit if this ever moves
  beyond a single-operator deployment.
- Subscriber secret is a randomly generated 32+ byte key
- Dispatcher stores secret in local environment (`.env.local`)
- Callback URL: `{relay_url}/callback` — a top-level route, not nested under
  `/subscribers`, so it can match whatever redirect URI is registered with
  the Linear OAuth application regardless of API path structure
- Registration endpoint: `POST {relay_url}/subscribers/register` (dispatcher-initiated)
- Webhook delivery includes `X-Linear-Signature` (from Linear) and `X-Dispatcher-Signature` (from relay)
