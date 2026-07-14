# ADR 0002: Use DynamoDB for Relay State Management

## Status

Accepted

## Context

The relay service needs to persist:

1. **Subscriber Registry**: Which local dispatchers are subscribed (with their domains, endpoints, secrets)
2. **Webhook Delivery Logs**: Delivery status, response times, errors for audit and debugging

Requirements:

- Serverless (no ops burden)
- Low latency reads/writes
- Handle spiky traffic (Linear events aren't uniform)
- TTL-based cleanup (auto-expire old entries)
- Global secondary indexes for queries (by team, by timestamp)

## Decision

Use AWS DynamoDB for both tables instead of RDS or managed relational DB:

### SubscriberRegistry Table

- Primary key: `subscriberId` (partition key)
- Global Index: `TeamIndex` (partition by `teamKey` for team-level queries)
- Attributes: team, domains, localEndpoint, subscriberSecret, registeredAt, lastSeenAt, version

### WebhookDeliveries Table

- Primary key: `deliveryId` + `timestamp` (partition + sort)
- Global Index: `TeamTimestampIndex` (partition by `teamKey`, sort by `timestamp`)
- TTL: auto-cleanup after 30 days (configurable)
- Attributes: status, responseTime, errorMessage, issueId, linearAssigneeId

## Consequences

### Positive

- **Serverless**: scales to zero, pay only for throughput used
- **Millisecond latency**: sub-10ms reads for hot data
- **TTL built-in**: automatic cleanup without cron jobs
- **Global indexes**: efficient queries without full table scans
- **AWS ecosystem**: integrates seamlessly with Lambda, IAM, CloudWatch

### Negative

- **Relational limitations**: no JOINs; must denormalize data
- **Throughput costs**: spiky traffic can be expensive if not provisioned correctly
- **Item size limits**: 400KB max item size (not an issue for our data)
- **Query complexity**: complex queries need careful index design

## Alternatives Considered

### Option A: PostgreSQL (RDS)

- **Pros**: ACID transactions, complex queries, familiar relational model
- **Cons**: Always-on cost, requires RDS Proxy for Lambda connections, over-engineered

### Option B: DynamoDB with point-in-time recovery

- **Pros**: Better durability story
- **Cons**: Added cost; webhook delivery logs are ephemeral anyway

### Option C: S3 + Athena (data lake)

- **Pros**: Cheap historical analysis
- **Cons**: High latency for live queries; overkill for current needs

## Implementation Notes

- Subscriber registry entries have TTL for cleanup (e.g., 90 days of inactivity)
- Delivery log TTL is shorter (30 days) since we only need recent history
- On-demand billing for now; can switch to provisioned capacity if traffic is predictable
- Use batch operations to reduce cost for bulk writes (e.g., reaping stale entries)
