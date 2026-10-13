# ADR 0007: Persisted Webhook Queue

**Status:** Accepted

**Date:** 2026-10-13

## Context

[ADR 0003](0003-webhook-routing-and-delivery.md) has the relay deliver each webhook once, with no retry. The dispatcher must answer that delivery quickly, then do slow work: label validation, routing and starting a Claude run. A delivery must also survive a dispatcher restart between the answer and the work.

[ADR 0006](0006-dispatcher-run-reliability.md) covers a run after the dispatcher accepts it. This ADR covers the step before: how a delivery waits in the dispatcher store.

## Decision

### Persist the delivery, then answer

`RelayWebhookController` verifies the HMAC signature and calls `WebhookQueueService.enqueue`. `enqueue` inserts one row into the `webhook_queue` table. The controller then answers `{ received: true }`. The slow work happens later, off the request path.

Each row holds the full `NormalizedEvent` as JSON, plus `idempotencyKey`, `webhookId`, `status` and `lastError`. `status` is `queued`, `processing` or `failed`.

### Drain with one loop

`processNext` runs one loop at a time. The loop takes the oldest `queued` row, sets it to `processing`, and calls `DispatcherService.dispatchWebhook`. A success deletes the row. A thrown error sets the row to `failed` and stores the message in `lastError`. The loop then moves to the next row.

`dispatchWebhook` starts the Claude run in the background and returns once the run exists. So the queue serializes dispatch decisions, not runs.

A policy rejection (`ActiveRunError`, `RecentDuplicateRunError` or `DuplicatePayloadError`) is an expected outcome with nothing to retry. The loop deletes the row and logs `webhook.rejected`.

Any other thrown error leaves a `failed` row for inspection. Nothing retries it, which matches the no-retry stance in ADR 0006. `WebhookRetentionService` deletes `failed` rows older than 14 days.

### Return interrupted rows on restart

`onModuleInit` sets every `processing` row back to `queued`, then starts the loop. A `failed` row is left alone. A restart can dispatch a row twice if the first attempt did not finish; the run store's duplicate checks (below) limit the harm.

### Dedupe on idempotencyKey in two places

1. **The queue.** `webhook_queue` has a unique index on `idempotencyKey`. A unique-constraint violation is logged as `webhook.duplicate` and returns without error. Any other insert error (a full disk, a locked database) propagates to the caller, so the relay sees a failure instead of a false success. This covers only rows still in the table, because a successful dispatch deletes the row.
2. **The run store.** `TypeOrmStoreRepository.enqueueRun` looks up the key in `processed_webhooks`. A match throws `DuplicatePayloadError`. The store records the key in the same transaction that creates the run.

`WebhookRetentionService` deletes `processed_webhooks` keys older than 14 days. It runs 60 seconds after startup, then daily.

The 60-second `duplicateRunWindowMs` from ADR 0006 is a separate check on issue, domain and skill, not on the key.

`packages/webhook-verify` builds the key: `issue:<issueId>:<action>:<ts>` for issue events, `session:<sessionId>:<action>:<ts>` for agent sessions.

## Consequences

**Advantages:**

- A delivery survives a dispatcher crash once the insert succeeds.
- The relay gets a fast answer, whatever the dispatch costs.
- A repeated key does not start a second run, whether the first copy is queued or done.
- One failed row does not block the rows behind it.

**Disadvantages:**

- A `failed` row blocks its key until the 14-day cleanup removes it. Operators who need an earlier retry delete the row by hand.
- One drain loop runs one dispatch at a time, so a slow dispatch delays the rows behind it.

## References

- [ADR 0003: Webhook Routing and Delivery](0003-webhook-routing-and-delivery.md)
- [ADR 0006: Dispatcher Run Reliability](0006-dispatcher-run-reliability.md)
