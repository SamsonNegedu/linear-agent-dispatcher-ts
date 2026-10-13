# ADR 0001: Relay Service Architecture

**Status:** Accepted

**Amended:** 2026-10-12 — the relay was originally designed to run on AWS (Lambda, API Gateway, DynamoDB, deployed with SST). It now runs locally as a plain NestJS server on SQLite, and the AWS path was removed; see "History" below.

## Context

Linear sends webhooks, and the dispatcher instances that act on them run on local machines. If each dispatcher connected to Linear directly, the team would have:

- A separate OAuth app and flow for every dispatcher
- Credentials spread across machines and hard to rotate
- No central place to see webhook delivery state

## Decision

### A dedicated relay service

1. The relay is the single OAuth gateway to Linear: one app integration, not one per dispatcher.
2. The relay receives all Linear webhooks at one endpoint.
3. The relay keeps a subscriber registry that maps a team and user to a dispatcher's delivery URL.
4. The relay sends each webhook to the matching dispatchers, signed per subscriber.

### Runs locally: NestJS on Fastify, SQLite for state

- `pnpm dev:up` starts the relay on the developer's machine behind a public tunnel (Cloudflare named or quick tunnel, or Tailscale Funnel). Nothing is deployed and no cloud account is needed.
- State is one SQLite file (`better-sqlite3`): a `subscribers` table and a `webhook_deliveries` log. A maintenance job runs at startup and then daily. It deletes subscribers inactive for 14 days and delivery logs older than 30 days. Duplicate subscribers are solved by the subscriber ID, see [ADR 0005](0005-deterministic-subscriber-identity.md).
- NestJS gives structure and dependency injection to the few endpoints: webhook ingestion, OAuth start and callback, and subscriber lookup and update. Fastify keeps request handling light.

## Consequences

### Positive

- **One source of truth** for Linear OAuth credentials and webhook state
- **One integration** to manage with Linear
- **Nothing to provision or pay for.** One command starts the relay, and Docker is not needed.
- **Simple to test.** Repository tests run against in-memory SQLite.

### Negative

- **Availability is the developer's machine.** The relay receives no Linear webhooks while the machine or tunnel is down, and the relay does not retry or queue (see [ADR 0003](0003-webhook-routing-and-delivery.md)).
- **A public URL is required**, so the internet can reach the relay endpoints. The relay authenticates subscriber changes by secret and validates delivery endpoints, see [ADR 0002](0002-oauth-and-subscriber-registration.md).
- **Single process, single file.** The relay cannot run as several instances at once.

## Alternatives Considered

| Approach                                             | Rejected because                                                                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Each dispatcher does its own OAuth with Linear       | One OAuth app per dispatcher, credential sprawl, no central delivery visibility                                                                                        |
| Relay on AWS Lambda + DynamoDB (the original design) | Needs an AWS account, deployment and Docker for local DynamoDB, for a system one developer or team runs on their own machines. Removed, see History |
| Event bus (SNS/SQS) between relay and dispatchers    | Adds latency and infrastructure for guarantees this workload does not need                                                                                   |
| Always-on server or RDS                              | Operating cost and effort with no benefit at this scale                                                                                                |
| Express instead of NestJS on Fastify                 | Express needs hand-written error handling, validation and logging that NestJS already provides                                                                         |

## History

The first version targeted AWS: Lambda + API Gateway for hosting, DynamoDB single-table storage with a shared GSI and write-sharded delivery keys, an SST stack, a scheduled Lambda for stale-subscriber cleanup, and an authenticated `/admin` API for listing and revoking subscribers. The relay will only ever run locally, so the team removed all of that: the infrastructure stack, the Lambda adapter package, the DynamoDB client, the admin API, and the unauthenticated `POST /subscribers/register` endpoint (the OAuth callback is now the only way to register a subscriber). To go back to a hosted relay, replace the two repositories behind `SUBSCRIBER_REGISTRY_REPOSITORY` and `WEBHOOK_DELIVERIES_REPOSITORY`. Nothing else depends on SQLite.

## References

- [ADR 0002: OAuth and Subscriber Registration](0002-oauth-and-subscriber-registration.md)
- [ADR 0003: Webhook Routing and Delivery](0003-webhook-routing-and-delivery.md)
- [ADR 0005: Deterministic Subscriber Identity](0005-deterministic-subscriber-identity.md)
