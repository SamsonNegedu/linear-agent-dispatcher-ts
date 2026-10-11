# ADR 0001: Relay Service Architecture

**Status:** Accepted

## Context

The Linear dispatcher needs to handle webhooks from Linear and route them to
local dispatcher instances (one per team/workspace). A direct connection
from each dispatcher to Linear would create:

- A separate OAuth app/flow per team
- N × M networking complexity (N local dispatchers to M Linear teams)
- Distributed, hard-to-rotate credentials
- No central place to see webhook delivery state

This ADR covers the relay's shape as a whole: why it's a separate service,
why it's serverless, and what it's built with. These were never independent
choices — "a relay" implies "something that runs continuously with minimal
ops," which is what pulled in serverless Lambda, which is what pulled in a
Lambda-friendly datastore and framework. Splitting them into separate
records would suggest they were each weighed independently; they weren't.

## Decision

### A dedicated relay service

1. Acts as a single OAuth gateway to Linear (one app integration, not per-team)
2. Receives all Linear webhooks at a single endpoint
3. Maintains a subscriber registry mapping team → local dispatcher endpoint
4. Routes webhooks to the appropriate local dispatcher(s)

### Deployed serverless: AWS Lambda + API Gateway

- No server to run continuously for what is, at this system's actual scale
  (a single team, a handful of dispatcher subscriptions), bursty and
  infrequent traffic
- Scales to zero when idle; cost is negligible at current volume
- Each Lambda: Node.js 22+, 5-minute timeout, connects to DynamoDB for state

### State store: DynamoDB, not RDS

- Serverless fits the same reasoning as above — RDS bills for an always-on
  instance regardless of traffic, to store what amounts to a few KB of
  subscriber state and some delivery logs
- Native TTL support: used for `WebhookDeliveries` (30-day auto-expiry, real
  and implemented). _Not_ used for `SubscriberRegistry` — no `expiresAt`
  field exists; the duplicate-subscriber problem this might have papered
  over was instead fixed at the identity layer, see
  [ADR 0005](0005-deterministic-subscriber-identity.md)

### Framework: NestJS on Fastify

- NestJS over raw handlers or a minimal Express app: structure (modules,
  controllers, services) and built-in DI meaningfully help once you have
  more than one or two endpoints (webhook ingestion, subscriber
  registration, OAuth start/callback, admin)
- Originally deployed on `@nestjs/platform-express` +
  `@codegenie/serverless-express`; migrated to `@nestjs/platform-fastify` +
  `@fastify/aws-lambda`. No functional gap forced the move — one explicit
  status-code fix was needed (Fastify's `reply.redirect(url)` reuses
  whatever status Nest's router already set instead of defaulting to 302 the
  way Express always does), everything else was a type-only swap. Took it
  for the throughput/cold-start win on what is mostly small JSON payloads.

## Consequences

### Positive

- **Single source of truth** for Linear OAuth credentials and webhook state
- **Simplified security**: only one integration to manage with Linear
- **No ops burden**: AWS manages scaling/patching; nothing to provision
- **Cost**: negligible at current traffic — see Context; not worth a
  detailed cost projection until traffic is orders of magnitude higher
- **Structure**: NestJS's DI/module structure keeps the handful of relay
  endpoints organized as more get added

### Negative

- **Single point of failure**: relay outage affects all dispatchers
  (mitigated by AWS's own reliability SLAs, not anything this system does)
- **Latency hop**: webhooks go through relay before reaching dispatchers
  (negligible, tens of ms)
- **Cold starts**: first invocation after idle has ~500ms-1s overhead;
  acceptable for webhook delivery, not for anything latency-sensitive
- **Vendor lock-in**: tightly coupled to AWS Lambda/DynamoDB APIs

## Alternatives Considered

| Approach                                                       | Rejected because                                                                                                                                                |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decentralized (each dispatcher does its own OAuth with Linear) | N OAuth apps, credential sprawl, no central delivery visibility                                                                                                 |
| Relay embedded in each dispatcher's environment                | Defeats the purpose — relay would need to scale per-team instead of once                                                                                        |
| Event bus (SNS/SQS) between relay and dispatchers              | Added latency and infrastructure for guarantees this workload doesn't need; still needs an OAuth gateway regardless                                             |
| EC2/ECS/App Runner instead of Lambda                           | Pay for always-on capacity at near-zero traffic; more ops for no benefit at this scale                                                                          |
| RDS instead of DynamoDB                                        | Same always-on cost problem, for data that doesn't need relational queries                                                                                      |
| Express instead of NestJS on Fastify                           | Manual error handling/validation/logging boilerplate NestJS gives for free; Fastify chosen over Express specifically for the Lambda adapter, see Decision above |

## Implementation Notes

- Relay registers with Linear OAuth as a single "app" for the organization
- Dispatcher security is managed via HMAC-SHA256 signed requests from relay
  (see [ADR 0002](0002-oauth-and-subscriber-registration.md))
- Webhook delivery is idempotent (dispatcher deduplicates by delivery ID),
  but the relay itself does not retry failed deliveries — see
  [ADR 0003](0003-webhook-routing-and-delivery.md)
- Local dev: `sst dev` simulates Lambda; local DynamoDB via the
  `amazon/dynamodb-local` Docker image (`services/relay-service/scripts/setup-local-dynamodb.js`)
- No test suite currently exists for `relay-service` itself. The shared
  `webhook-verify` package it depends on for parsing/signing does have unit
  tests (`node --test`) — the highest-value place tests exist today, since
  it's what both relay and dispatcher trust to interpret Linear's payloads
  correctly.

## References

- [ADR 0002: OAuth and Subscriber Registration](0002-oauth-and-subscriber-registration.md)
- [ADR 0003: Webhook Routing and Delivery](0003-webhook-routing-and-delivery.md)
- [ADR 0005: Deterministic Subscriber Identity](0005-deterministic-subscriber-identity.md)
