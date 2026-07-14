# ADR 0007: Subscriber Cleanup and TTL Strategy

## Status

Accepted

## Context

Over time, the SubscriberRegistry accumulates stale entries:

- Dispatchers that go offline and never reconnect
- Teams that unsubscribe or remove the integration
- Duplicates from re-registration
- Dead endpoints that consistently fail

Without cleanup:

- Registry grows unbounded, increasing query latency
- Costs grow (DynamoDB storage, throughput for scans)
- Debugging becomes harder (many stale entries to filter)

Options for cleanup:

1. Manual admin endpoint to delete entries
2. TTL-based automatic cleanup
3. Periodic batch cleanup job
4. Lazy deletion on failed delivery

## Decision

Implement hybrid approach with two mechanisms:

### Mechanism 1: DynamoDB TTL (automatic)

- Add `expiresAt` attribute to SubscriberRegistry items
- Set on registration with default expiry: 90 days from now
- Update on each successful dispatch (keep-alive)
- DynamoDB automatically deletes expired entries
- No cost for deletion; built into DynamoDB pricing

### Mechanism 2: Reap-Stale Lambda (explicit cleanup)

- Scheduled Lambda (CloudWatch Events, once per day)
- Query `TeamIndex` for subscribers not seen in 60+ days
- Delete stale entries immediately (don't wait for TTL)
- Log deleted entries for audit
- Send optional alert to admin (Slack/email) for review

### Dispatcher Behavior

- On successful delivery: dispatcher calls `PUT /subscribers/keepalive`
- Relay updates `lastSeenAt` and extends TTL to 90 days
- If dispatcher goes offline, TTL expires and entry is removed

### Registration/Update

- New registration: set `expiresAt = now + 90 days`
- Re-registration: reset TTL (acts as keep-alive)
- Manual re-registration: dispatcher can re-register if TTL expires

## Consequences

### Positive

- **Automatic**: no manual intervention; TTL handles most cases
- **Cost-efficient**: DynamoDB TTL deletion is free
- **Audit trail**: reap-stale logs deleted entries for compliance
- **Configurable**: can adjust TTL window (90 days) as needed
- **Graceful degradation**: expired entries disappear, dispatcher must re-register

### Negative

- **Grace period**: 90 days before auto-cleanup is long
  - Mitigated: reap-stale runs daily, clears stale entries in 60 days
- **No notification**: dispatcher isn't told when TTL expires
  - Acceptable: re-registration is simple (one endpoint call)
- **Cascade cleanup**: if relay is down during reap-stale, cleanup is delayed
  - Acceptable: TTL will still kick in; one day delay is acceptable

## Alternatives Considered

### Option A: Manual deletion only

- **Pros**: Explicit, clear audit trail
- **Cons**: Requires admin intervention, registry grows unbounded

### Option B: Lazy deletion on failed delivery

- **Pros**: Cleanup happens as needed
- **Cons**: Registry still grows; failed deliveries are common (network blips)

### Option C: Aggressive cleanup (7-day TTL)

- **Pros**: Registry stays small
- **Cons**: Valid dispatchers expire unexpectedly; need frequent keep-alive calls

### Option D: No cleanup (infinite retention)

- **Pros**: Simplest implementation
- **Cons**: Registry grows forever; costs increase; debugging harder

## Implementation Notes

### TTL Configuration

```typescript
// SubscriberRegistry table
{
  fields: {
    expiresAt: "number", // Unix timestamp (seconds)
  },
  ttl: "expiresAt", // DynamoDB TTL attribute
}
```

### Keep-Alive Endpoint

```
PUT /subscribers/keepalive
{
  "subscriberId": "sub_123",
  "subscriberSecret": "..."  // HMAC signature for auth
}
```

### Reap-Stale Job

- Runs daily at 02:00 UTC
- Scans `TeamIndex` looking for `lastSeenAt < now - 60 days`
- Deletes in batches (100 at a time to avoid throttling)
- Logs: subscriber ID, team key, reason (inactive)
- CloudWatch metric: `StaleSubscribersRemoved` (count per day)

### Monitoring

- Track `SubscriberRegistry` table size (CloudWatch metric)
- Alert if reap-stale fails (Lambda error rate > 0)
- Dashboard: total subscribers, deleted per day, TTL expirations

### Operator Runbook

1. **Subscriber should re-register**: Tell them to call `POST /subscribers/register` again
2. **Keep-alive endpoint not working**: Check dispatcher's network, verify subscriberSecret
3. **Too many expirations**: Lower TTL window or increase keep-alive frequency

## Testing Notes

- Unit test: verify expiresAt is set correctly
- Integration test: wait for TTL to expire (use local DynamoDB)
- Chaos test: kill reap-stale Lambda, verify TTL still cleans up
