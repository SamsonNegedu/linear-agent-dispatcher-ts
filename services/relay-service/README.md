# Relay Service

Serverless webhook router for Linear issues. Receives one webhook from Linear, fans out to all registered local dispatcher instances based on issue assignment.

## Architecture

```
Linear Webhook (single POST)
         ↓
   Relay Service (Lambda)
         ↓
   Verify HMAC signature
   Parse issue + assignee
         ↓
   Query SubscriberRegistry
   (who's listening for this team+user?)
         ↓
   Fan-out in parallel
   (POST to each dispatcher with per-subscriber HMAC)
         ↓
   Log deliveries to WebhookDeliveries
   (audit trail, 30-day TTL)
```

## Local Development

```bash
# Install
pnpm install

# Environment
cp ../../.env.example .env.local
export LINEAR_OAUTH_CLIENT_ID="..."
export LINEAR_OAUTH_CLIENT_SECRET="..."
export LINEAR_WEBHOOK_SECRET="..."
export RELAY_BASE_URL="http://localhost:3001"
export DYNAMODB_ENDPOINT="http://localhost:8000"  # DynamoDB Local

# Run locally with DynamoDB Local
pnpm dev

# Make test requests
curl "http://localhost:3001/subscribers/auth/start?localEndpoint=http://localhost:3000/webhooks/relay"
```

`localEndpoint` must be the **full delivery URL**, not just an origin — the relay has no knowledge of the receiver's route structure, so it POSTs to whatever you give it verbatim. For the dispatcher, that's `.../webhooks/relay`.

It must also be `https://`, or `http://localhost:<port>` specifically — `http://127.0.0.1:...` is rejected (see `isValidWebhookEndpoint` in `subscriber.controller.ts`). If you're pointing a deployed relay at a locally-running dispatcher, `localhost` isn't reachable from AWS either — tunnel it first (Tailscale Funnel, a Cloudflare tunnel or `ngrok http 3000`) and use the `https://` URL that prints. For a fully local relay, `pnpm dev:up` from the repo root starts everything, including a tunnel.

## Deployment

Deployed via SST to AWS Lambda + API Gateway v2 (HTTP API).

```bash
# Build
pnpm build

# Deploy from root
cd ../..
pnpm dlx sst deploy

# Environment variables injected by SST:
# - RELAY_TABLE_NAME
# - AWS_REGION (inferred)
```

## Key Concepts

### Single-table design

Subscribers and webhook deliveries share **one** DynamoDB table (`RELAY_TABLE_NAME`, see `infra/relay-service-table.definition.ts`), distinguished by a `pKey`/`sKey` prefix (`SUBSCRIBER#` / `DELIVERY#`). One shared GSI (`GSI1`) serves both entity types' team-scoped queries — there are no separate `SubscriberRegistry`/`WebhookDeliveries` tables despite the class names.

### Subscriber Registry

```typescript
interface SubscriberRecord {
  subscriberId: string; // `${teamKey}:${linearUserId}:${endpointHash}` — see buildSubscriberId()
  teamKey: string; // Linear team/workspace key
  linearUserId: string; // Linear user ID (assignee)
  domains: Set<string>;
  localEndpoint: string; // Full webhook delivery URL of local dispatcher
  subscriberSecret: string; // 32-byte hex secret (HMAC signing)
  registeredAt: string; // ISO timestamp
  lastSeenAt: string; // Last successful delivery
  version: number; // Optimistic locking
}

// Keys (within the shared table):
// - pKey/sKey: SUBSCRIBER#<subscriberId>
// - GSI1: GSI1pKey=TEAM#<teamKey>, GSI1sKey=SUBSCRIBER#<subscriberId>
//   (indexes by team only — matching a specific linearUserId is an
//   in-memory filter over that team's subscribers, not a native index key)
```

### Webhook Deliveries Log

```typescript
interface WebhookDeliveryRecord {
  deliveryId: string; // UUID
  timestamp: string; // ISO timestamp
  subscriberId: string; // Who received it
  teamKey: string; // Which team
  webhookId: string; // Linear webhook ID
  issueId: string;
  issueIdentifier: string;
  status: 'success' | 'timeout' | 'unreachable' | 'verification_failed';
  responseTime?: number; // ms
  errorMessage?: string; // If failed
  ttl?: number; // Expires after 30 days
}

// Keys (within the shared table):
// - pKey/sKey: DELIVERY#<deliveryId>
// - GSI1: GSI1pKey=TEAM#<teamKey>, GSI1sKey=DELIVERY#<timestamp>#<deliveryId>
//   (timestamp first, so querying by team sorts chronologically)
```

### OAuth Flow (Seamless Multi-Team Registration)

1. **Dispatcher initiates**: User clicks "Connect to Relay" → calls `/subscribers/auth/start?localEndpoint=<dispatcher-url>`
2. **Linear OAuth**: Browser redirects to Linear, user authorizes app
3. **Relay auto-registers for all teams** (`/callback`, top-level route to match the OAuth app's redirect URI):
   - Exchanges authorization code for access token
   - Queries Linear GraphQL to get all user's teams
   - Auto-registers dispatcher endpoint for **every team** user belongs to
   - All registrations share one secret (dispatcher receives webhooks from any team)
4. **User saves secret**: Callback returns `RELAY_SUBSCRIBER_SECRET` (one env var to copy-paste)

**Result**: Dispatcher now receives webhooks for every team the user belongs to, under one registration.

**Developer UX**: Click → Authorize → Done (30 seconds, all teams registered).

### Dependency Injection

Each feature module provides its own repository via a factory provider, reading the shared table name off `RelayServiceConfig`:

```typescript
// subscriber.module.ts
@Module({
  imports: [DynamoDBModule],
  controllers: [SubscriberController, OAuthCallbackController],
  providers: [subscriberRegistryProvider, SubscriberService, OAuthService],
  exports: [SubscriberService],
})

// subscriber-registry.provider.ts
export const subscriberRegistryProvider: Provider = {
  provide: SUBSCRIBER_REGISTRY_REPOSITORY,
  useFactory: (dynamoClient: DynamoClient, config: RelayServiceConfig) =>
    new SubscriberRegistry(dynamoClient, config.dynamodb.tableName),
  inject: [DynamoClient, 'RelayServiceConfig'],
};

// subscriber.service.ts
constructor(
  @Inject(SUBSCRIBER_REGISTRY_REPOSITORY) private readonly registry: SubscriberRegistry,
) {}
```

## API Reference

See [`../../README.md`](../../README.md) for endpoint documentation.

## Environment Variables

```bash
# Linear OAuth (all required)
LINEAR_OAUTH_CLIENT_ID=...
LINEAR_OAUTH_CLIENT_SECRET=...
LINEAR_WEBHOOK_SECRET=...

# Optional
LINEAR_ORGANIZATION_ID=...  # Restricts accepted webhooks to one workspace
LINEAR_API_KEY=...          # Used only to resolve assignee/team for AgentSession
                             # webhooks, which don't carry that info themselves

# Relay configuration
RELAY_BASE_URL=http://localhost:3001  # For OAuth callback redirect; warns if unset
RELAY_TABLE_NAME=RelayTable            # Single shared DynamoDB table (default: RelayTable)

# DynamoDB (local dev only)
DYNAMODB_ENDPOINT=http://localhost:8000
DYNAMODB_REGION=us-east-1
```

## Testing

### Unit Tests (pending)

```bash
pnpm test
```

### Integration Tests (pending)

End-to-end flow:

1. Start OAuth
2. Handle callback
3. Register subscriber
4. POST webhook
5. Verify delivery to subscriber endpoint

### Manual Testing

```bash
# 1. Start auth flow
curl "http://localhost:3001/subscribers/auth/start?localEndpoint=http://localhost:3000/webhooks/relay"

# 2. Simulate callback (get code from Linear)
curl "http://localhost:3001/callback?code=<code>&state=<state>"

# 3. Register subscriber
curl -X POST http://localhost:3001/subscribers/register \
  -H "Content-Type: application/json" \
  -d '{
    "linearUserId": "user_123",
    "teamKey": "LIN-ABC",
    "localEndpoint": "http://localhost:3000/webhooks/relay",
    "subscriberSecret": "<from callback>"
  }'

# 4. Simulate Linear webhook
curl -X POST http://localhost:3001/webhooks/linear \
  -H "linear-signature: sha256=<hmac>" \
  -H "Content-Type: application/json" \
  -d '<webhook JSON>'
```

## Production Considerations

- **Error logging**: All errors logged to CloudWatch
- **Delivery audit trail**: 30-day TTL on webhook delivery records
- **Stale subscriber cleanup**: Daily scheduled task removes subscribers inactive for 14+ days
- **Rate limiting**: Not yet implemented; consider adding if high-volume
- **Retry logic**: Not yet implemented; failed deliveries logged but not retried
