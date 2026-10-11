# ADR 0003: Webhook Routing and Delivery Strategy

## Status

Accepted

## Context

The relay receives Linear webhooks and must:

1. Route them to the correct local dispatcher(s) based on domain
2. Ensure delivery reliability (retries, error handling)
3. Log delivery state for audit and debugging
4. Handle dispatcher timeouts gracefully

A single Linear workspace webhook might need to reach multiple dispatchers (e.g., one for agent-side processing, one for data sync).

## Decision

Implement synchronous delivery with fallback logging:

### Routing Logic

1. Extract issue domain from Linear webhook (e.g., "ACME-123" → "ACME")
2. Query `SubscriberRegistry` by domain using `TeamIndex`
3. Filter subscribers by team key match
4. Collect all matching dispatcher endpoints

### Delivery Strategy

- **Synchronous**: POST webhook immediately to all matching dispatchers
- **Parallel**: Fire requests concurrently (not sequentially) to speed up response
- **Timeout**: 30 second timeout per dispatcher (fail fast if dispatcher is slow)
- **Signature**: Sign payload with dispatcher's secret (HMAC-SHA256)

### Reliability

- **Idempotent**: webhook delivery ID allows dispatchers to deduplicate retries
- **Fire-and-forget**: relay doesn't retry; if dispatcher fails, it logs and moves on
- **Async fallback**: failed deliveries are logged to the relay's SQLite database (inspect with `sqlite3 data/relay.db`)
- **No queuing**: webhooks aren't queued; if delivery fails, dispatcher must re-fetch from Linear

### Logging

All deliveries (success and failure) are logged to the `webhook_deliveries` table:

- deliveryId (hash of webhook ID + dispatcher ID)
- status (success, timeout, http_error)
- responseTime (latency in ms)
- errorMessage (if failed)

## Consequences

### Positive

- **Low latency**: synchronous delivery means webhook reaches dispatcher immediately
- **Simplicity**: no message queue, DLQ, or retry service needed
- **Observability**: full delivery history in SQLite for audit
- **Cost**: no extra queue infrastructure

### Negative

- **No automatic retries**: if dispatcher is temporarily down, webhook is lost
  - Mitigated: Linear retries webhook after 5 minutes if we return 5xx
  - Mitigated: dispatcher can re-fetch from Linear API (events API)
- **Timeout impact**: slow dispatcher affects relay response time
  - Mitigated: 30 second timeout is reasonable for most cases
- **No ordering guarantee**: concurrent delivery doesn't guarantee order
  - Acceptable: Linear webhooks for same issue are ordered by Linear's ID

## Alternatives Considered

### Option A: Async with SQS

- **Pros**: Guaranteed delivery, built-in retries, decouples relay from dispatcher
- **Cons**: Added latency, costs more (queue storage), overkill for fast dispatchers

### Option B: Synchronous with relay-side retries

- **Pros**: Better reliability
- **Cons**: Slows down webhook processing, requires state management (retry counts)

### Option C: Fan-out via SNS

- **Pros**: Multiple subscribers possible
- **Cons**: Less control over signature verification per dispatcher

## Implementation Notes

- Delivery timeout: 30 seconds (configurable)
- Fan-out is a plain `Promise.all` over matching subscribers — no concurrency
  cap. Fine at current scale (a handful of subscribers per team); would need
  a real limit if a single team ever had dozens of active dispatchers
- Delivery signature header: `X-Dispatcher-Signature: sha256={hex_hmac}`
- Error codes: 2xx = success, 4xx = permanent failure (don't retry), 5xx = temporary (Linear will retry)
- Delivery log retention: 30 days; the relay's daily housekeeping deletes older rows (see [ADR 0001](0001-relay-service-architecture.md))
- No relay dashboard or read API exists — failed deliveries are only visible by querying
  the `webhook_deliveries` table directly (`sqlite3 data/relay.db`)
