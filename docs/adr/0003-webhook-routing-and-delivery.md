# ADR 0003: Webhook Routing and Delivery Strategy

## Status

Accepted

## Context

The relay receives Linear webhooks. For each webhook, the relay must:

1. Find the dispatchers that should receive the webhook
2. Deliver the webhook to each of them
3. Record every delivery for audit and debugging
4. Cope with a dispatcher that is slow or down

One Linear workspace webhook can match several dispatchers, for example two developers who share a team.

## Decision

Deliver synchronously, never retry, and log every attempt.

### Routing logic

1. Read the team key (`routingKey`) and the assignee (`ownerId`) from the normalized webhook event.
2. If the event lacks either value (an agent session webhook has no assignee), ask the provider's routing resolver to fill the gap. The Linear resolver fetches the issue from Linear's API. When `LINEAR_API_KEY` is not set, a null resolver logs a warning and the webhook is skipped.
3. If the team key or assignee is still missing, skip the webhook and log it.
4. Look up subscribers with `SubscriberService.getSubscribersByTeamAndAssignee(teamKey, assigneeId)`. Both values must match.
5. Deliver to every subscriber found.

### Delivery strategy

- **Synchronous**: the relay posts the webhook to each subscriber before it answers Linear.
- **Parallel**: the relay sends all requests at once with `Promise.all`.
- **Timeout**: 5 seconds per subscriber, hardcoded in `WebhookService`. A slow dispatcher fails fast.
- **Payload**: the relay forwards the parsed `NormalizedEvent` as JSON, not Linear's original body.
- **Signature**: the relay signs the payload with the subscriber's secret (HMAC-SHA256) and sends it in the `X-Relay-Signature` header as `sha256={hex}`.

### Reliability

- **Deduplication**: the event carries an `idempotencyKey`, so a dispatcher can drop repeated deliveries.
- **No retries**: the relay does not retry. If a dispatcher fails, the relay logs the failure and moves on.
- **No queue**: the relay does not queue webhooks. A dispatcher that missed an event must re-fetch it from Linear.
- **Always 200**: after Linear's signature, timestamp and organization checks pass, the relay answers `200` even when some deliveries fail. The response body reports how many succeeded and failed.

### Logging

The relay writes every delivery to the `webhook_deliveries` table in its SQLite database. It inserts a row before sending, then updates the row with the outcome. Columns:

- `delivery_id`: a random UUID
- `timestamp`, `subscriber_id`, `team_key`, `webhook_id`, `issue_id`, `issue_identifier`, `linear_assignee_id`
- `status`: `success`, `timeout`, `unreachable` or `verification_failed` (the dispatcher answered with a non-2xx status)
- `response_time`: latency in milliseconds
- `error_message`: set when the request threw an error

The relay also logs one `webhook.fanout` line per webhook and one `webhook.delivery.failed` line per failed delivery.

## Consequences

### Positive

- **Low latency**: the dispatcher gets the webhook right away.
- **Simple**: no message queue, dead-letter queue or retry service.
- **Observable**: the full delivery history sits in SQLite.
- **Cheap**: no queue infrastructure to run.

### Negative

- **No automatic retries**: a webhook is lost if its dispatcher is down.
  - The relay answers `200`, so Linear does not retry either.
  - The dispatcher must recover by re-fetching from Linear.
- **Timeout cost**: a slow dispatcher delays the relay's response, for up to 5 seconds.
- **No ordering guarantee**: parallel delivery does not preserve the order of events.

## Alternatives Considered

### Option A: Asynchronous queue

- **Pros**: guaranteed delivery, built-in retries, relay and dispatcher decoupled.
- **Cons**: extra latency and infrastructure, and too much for a local relay.

### Option B: Synchronous with relay-side retries

- **Pros**: better reliability.
- **Cons**: slower webhook handling, and the relay must track retry counts.

### Option C: Fan-out through a pub/sub topic

- **Pros**: many subscribers are easy to add.
- **Cons**: less control over signing per dispatcher.

## Implementation Notes

- Fan-out has no concurrency cap. This is fine for a handful of subscribers per team. Dozens of dispatchers on one team would need a limit.
- Delivery rows older than 30 days are deleted by the relay's daily housekeeping job (see [ADR 0001](0001-relay-service-architecture.md)).
- The relay has no dashboard or read API. To see failed deliveries, query the `webhook_deliveries` table directly with `sqlite3 data/relay.db`.
- After a successful delivery, the relay marks the subscriber as recently active so stale-subscriber cleanup spares it.
