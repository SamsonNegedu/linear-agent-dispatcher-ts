# Linear Dispatcher

Automatically run Claude on Linear issues assigned to you — no manual prompts, full audit trail.

A production-grade NestJS/AWS serverless dispatcher that routes Linear webhooks to Claude, with portable data layer (SQL/DynamoDB) and optional team-shared relay.

## Structure

```
linear-agent-ts/
├── sst.config.ts              # Infrastructure as code (SST v2)
├── packages/
│   └── webhook-verify/        # Shared: HMAC verification, envelope parsing
├── services/
│   ├── dispatcher-service/    # NestJS app: local dispatcher (connects to a relay, local or shared)
│   └── relay-service/         # Lambda handlers: serverless webhook relay
└── infra/
    └── relay-service.ts       # SST stack definition
```

## Key Features

✅ **Portable data layer** — SQL (SQLite/PostgreSQL) or DynamoDB, config-based switching
✅ **Webhook relay** — One relay subscription for whole team; events routed by Linear user assignment
✅ **Security** — Linear OAuth authentication, HMAC webhook signatures, audit logging
✅ **Local & team modes** — Connect to a relay you run yourself (solo dev) or one deployed once for the team
✅ **Real-time** — HTTP webhook push from relay to local dispatcher endpoints

## Quick Start

### Prerequisites

- Node.js 24+
- pnpm 9+
- Linear OAuth app (create at https://linear.app/settings/api)
- Claude CLI (`claude` on your PATH, authenticated)

### Get Running in 5 Steps

```bash
# 1. Install & configure
pnpm install
cp .env.example services/relay-service/.env.local
cp .env.example services/dispatcher-service/.env.local

# 2. Edit services/relay-service/.env.local with Linear OAuth credentials:
#   LINEAR_OAUTH_CLIENT_ID=...
#   LINEAR_OAUTH_CLIENT_SECRET=...
#   LINEAR_WEBHOOK_SECRET=...
#    (from https://linear.app/settings/api)

# 3. Start both services
pnpm dev

# 4. Register dispatcher with relay (different terminal)
cd services/dispatcher-service
pnpm connect-relay --relay-url=http://localhost:3001 --local-endpoint=http://localhost:3000

# 5. Verify health
curl http://localhost:3000/status
```

Done. Assign yourself a Linear issue and it dispatches to Claude.

For detailed step-by-step, env var reference, and troubleshooting, see [services/dispatcher-service/GETTING_STARTED.md](services/dispatcher-service/GETTING_STARTED.md).

### Testing without Linear

To dispatch a webhook without assigning a Linear issue:

```bash
cd services/dispatcher-service
pnpm test-webhook -- --issue-id=TEST-1 --label=agent-implement
```

This sends a test webhook directly to the local dispatcher.

### Deployment: Relay to AWS

```bash
# Set Linear OAuth credentials (from https://linear.app/settings/api)
export LINEAR_OAUTH_CLIENT_ID="your_linear_client_id"
export LINEAR_OAUTH_CLIENT_SECRET="your_linear_client_secret"
export LINEAR_WEBHOOK_SECRET="your_linear_webhook_secret"

# Deploy
pnpm sst:deploy
```

The command outputs your relay URL. Then connect your dispatcher from `services/dispatcher-service`:

```bash
pnpm connect-relay --relay-url=<output-url> --local-endpoint=<your-dispatcher-url>
```

For local testing against a deployed relay, expose your dispatcher via a tunnel (e.g., [ngrok](https://ngrok.com/)) and use its URL as `--local-endpoint`.

## Relay Service API

The relay service (`services/relay-service/`) is a serverless webhook router. Linear sends one webhook to the relay; the relay fans out to all matching local dispatcher instances.

### Endpoints

**1. Start OAuth Flow**

```
GET /subscribers/auth/start?localEndpoint=<url>

Response:
{
  "redirect": "https://linear.app/oauth/authorize?client_id=..."
}
```

Redirects the user to Linear's OAuth screen. The `localEndpoint` is stored in the OAuth state for later retrieval.

**2. OAuth Callback (Auto-register All Teams)**

```
GET /callback?code=<code>&state=<state>

Response:
{
  "success": true,
  "teamCount": 2,
  "teams": [
    { "teamKey": "LIN-ABC123", "teamName": "Engineering" },
    { "teamKey": "LIN-XYZ789", "teamName": "Retros" }
  ],
  "subscriberSecret": "random_32_byte_hex",
  "localEndpoint": "http://localhost:3000/webhooks/relay",
  "env": "RELAY_SUBSCRIBER_SECRET=...",
  "message": "Registered with 2 team(s)! Dispatcher will receive webhooks from all registered teams."
}
```

Completes OAuth flow: exchanges code for token, fetches user's teams, auto-registers the dispatcher endpoint for **all** teams with one shared secret. Dispatcher receives webhooks from any team the user is assigned to.

**3. Register Subscriber (Manual)**

```
POST /subscribers/register

Body:
{
  "linearUserId": "user_123",
  "teamKey": "LIN-ABC123",
  "localEndpoint": "https://my-dispatcher.example.com/webhooks/relay",
  "subscriberSecret": "32_byte_hex_secret",
  "domains": ["linear"]  // optional
}

Response:
{
  "registered": true,
  "subscriberId": "lin_user_123:abc123:uuid",
  "teamKey": "LIN-ABC123",
  "message": "Subscription registered..."
}
```

**Note**: Usually called automatically by OAuth callback. Only use this endpoint if you need to register for a different team or update an existing subscription.

**4. Receive Webhook (automatic)**

```
POST /webhooks/linear

Headers:
  linear-signature: sha256=<hmac>

Body: <Linear webhook JSON>

Response:
{
  "received": true,
  "webhookId": "...",
  "delivered": 2,
  "failed": 0
}
```

Linear sends webhooks here. The relay verifies the signature, queries registered subscribers, and fans out to each one with per-subscriber HMAC signatures.

### OAuth Flow (3-step)

1. **User initiates**: Dispatcher calls `/subscribers/auth/start?localEndpoint=<dispatcher-url>`
2. **Linear redirects**: User authorizes, Linear redirects back to `/callback?code=...&state=...`
3. **Relay responds**: Returns `linearUserId` and `subscriberSecret` for manual registration

### Webhook Delivery

When Linear posts a webhook:

1. Relay verifies Linear's HMAC signature
2. Parses webhook to extract `teamKey` and `assigneeId` (Linear user assigned to the issue)
3. Queries subscribers: who's registered for this team + assignee?
4. For each subscriber:
   - Signs the payload with subscriber's secret
   - POSTs to subscriber's `localEndpoint`
   - Logs delivery result (success, timeout, unreachable, signature failure)
5. Returns summary: `{delivered: N, failed: M}`

### Environment Variables

```bash
# Linear OAuth (from Linear workspace settings)
LINEAR_OAUTH_CLIENT_ID=client_id
LINEAR_OAUTH_CLIENT_SECRET=client_secret
LINEAR_WEBHOOK_SECRET=webhook_signing_secret
LINEAR_ORGANIZATION_ID=org_id  # Optional, for workspace isolation

# Relay service
RELAY_BASE_URL=https://api.example.com  # For OAuth callback redirect
SUBSCRIBER_REGISTRY_TABLE=SubscriberRegistry  # DynamoDB table name (default)
WEBHOOK_DELIVERIES_TABLE=WebhookDeliveries    # DynamoDB table name (default)
```

## Implementation Plan

See `/Users/samsonnegedu/.claude/plans/twinkling-yawning-octopus.md` for the complete architecture, security model, and step-by-step implementation order.

## Development

```bash
# Install root + all workspaces
pnpm install

# Build all packages/services
pnpm build

# Run tests
pnpm test

# Format + lint
pnpm format
```

## Architecture

Every dispatcher sits behind a relay — the difference between "solo" and "team" setups is only whether that relay is local or deployed:

```
Linear webhook → Relay (local `pnpm dev`, or deployed Lambda) → HTTP POST → Dispatcher → Claude CLI → Linear API
```

## Security

- **Webhook verification**: HMAC-SHA256 (Linear → Relay)
- **Relay authentication**: Linear OAuth (user identity proof)
- **Event signing**: Per-subscriber HMAC (Relay → Dispatcher)
- **Audit trail**: WebhookDeliveries table (all deliveries logged, TTL 30 days)

## Admin API

The relay provides programmatic access to subscribers and delivery logs via the admin API (gated behind `ADMIN_API_TOKEN`):

- `GET /admin/api/subscribers?teamKey=<key>` — List subscribers
- `DELETE /admin/api/subscribers/:subscriberId` — Revoke subscriber
- `GET /admin/api/deliveries?teamKey=<key>&limit=50` — View delivery history

Set `ADMIN_API_TOKEN` to any secure string to enable these endpoints.
