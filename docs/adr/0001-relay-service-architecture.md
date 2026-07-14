# ADR 0001: Relay Service Architecture

## Status

Accepted

## Context

The Linear dispatcher needs to handle webhooks from Linear at scale while routing them to potentially many local dispatcher instances (one per team/workspace). A direct connection from each dispatcher to Linear would create:

- Multiple OAuth flows per team
- N × M networking complexity (N local dispatchers to M Linear team instances)
- Difficult to manage distributed credentials
- Hard to track webhook delivery at scale

## Decision

Build a dedicated Relay Service that:

1. Acts as a single OAuth gateway to Linear (one app integration, not per-team)
2. Receives all Linear webhooks at a single endpoint
3. Maintains a subscriber registry mapping (domain/team → local dispatcher endpoint)
4. Routes webhooks to appropriate local dispatchers based on domain filters
5. Runs in AWS serverless (Lambda + DynamoDB) for cost efficiency

## Consequences

### Positive

- **Single source of truth** for Linear OAuth credentials and webhook state
- **Simplified security**: only one integration to manage with Linear
- **Better observability**: webhook delivery logs centralized in DynamoDB
- **Cost efficient**: pay only for what you use (Lambda invocations, DynamoDB throughput)
- **Scalable**: no per-dispatcher OAuth burden; relay scales with webhook volume, not dispatcher count

### Negative

- **Single point of failure**: relay outage affects all dispatchers (mitigated by AWS reliability SLAs)
- **Latency hop**: webhooks go through relay before reaching dispatchers (negligible, ~10-50ms)
- **Operational complexity**: one more service to deploy and monitor

## Alternatives Considered

### Option A: Decentralized (each dispatcher manages its own OAuth)

- **Pros**: No relay needed, simpler deployment
- **Cons**: N OAuth apps with Linear, credential sprawl, hard to track delivery state

### Option B: Relay in dispatcher's environment

- **Pros**: Fewer moving parts
- **Cons**: Relay would need to scale with each team; defeats the purpose

### Option C: Event bus (SNS/SQS)

- **Pros**: Decouples relay from dispatchers via messaging
- **Cons**: Added complexity, overkill for this use case; still need OAuth gateway

## Implementation Notes

- Relay registers with Linear OAuth as a single "app" for the organization
- Dispatcher security is managed via HMAC-SHA256 signed requests from relay
- Webhook delivery is idempotent; relay retries with exponential backoff
