# ADR 0001: Relay Service Architecture

**Status:** Accepted

**Amended:** 2026-10-12 — the relay was originally designed to run on AWS (Lambda, API Gateway, DynamoDB, deployed with SST). It now runs locally as a plain NestJS server on SQLite, and the AWS path was removed; see "History" below.

## Context

The Linear dispatcher needs to receive webhooks from Linear and route them to local dispatcher instances. A direct connection from each dispatcher to Linear would mean:

- A separate OAuth app and flow per dispatcher
- Credentials spread across machines, hard to rotate
- No central place to see webhook delivery state

## Decision

### A dedicated relay service

1. A single OAuth gateway to Linear (one app integration, not one per dispatcher)
2. Receives all Linear webhooks at one endpoint
3. Keeps a subscriber registry mapping team and user to a dispatcher's delivery URL
4. Fans each webhook out to the matching dispatchers, signed per subscriber

### Runs locally: NestJS on Fastify, SQLite for state

- `pnpm dev:up` starts the relay on the developer's machine behind a public tunnel (Tailscale Funnel or Cloudflare), so there is nothing to deploy and no cloud account is needed.
- State is one SQLite file (`better-sqlite3`): a `subscribers` table and a `webhook_deliveries` log. Housekeeping runs at startup and daily: subscribers inactive for 14 days and delivery logs older than 30 days are deleted. The duplicate-subscriber problem is solved at the identity layer, see [ADR 0005](0005-deterministic-subscriber-identity.md).
- NestJS gives the handful of endpoints (webhook ingestion, OAuth start/callback, subscriber lookup and update) structure and dependency injection; Fastify keeps request handling light.

## Consequences

### Positive

- **Single source of truth** for Linear OAuth credentials and webhook state
- **One integration** to manage with Linear
- **Nothing to provision or pay for**; start-up is one command, and Docker is not needed
- **Simple to test**: repositories run against in-memory SQLite

### Negative

- **Availability is the developer's machine.** Linear's webhooks are not received while the machine or tunnel is down, and the relay does not retry or queue (see [ADR 0003](0003-webhook-routing-and-delivery.md)).
- **A public URL is required**, so the relay endpoints are reachable from the internet. Subscriber changes are authenticated by secret and delivery endpoints are validated, see [ADR 0002](0002-oauth-and-subscriber-registration.md).
- **Single process, single file**: not built for several relay instances at once.

## Alternatives Considered

| Approach                                             | Rejected because                                                                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Each dispatcher does its own OAuth with Linear       | N OAuth apps, credential sprawl, no central delivery visibility                                                                                        |
| Relay on AWS Lambda + DynamoDB (the original design) | Needs an AWS account, deployment and Docker for local DynamoDB, for a system used by one developer or team on their own machines; removed, see History |
| Event bus (SNS/SQS) between relay and dispatchers    | Latency and infrastructure for guarantees this workload doesn't need                                                                                   |
| Always-on server or RDS                              | Operating cost and effort with no benefit at this scale                                                                                                |
| Express instead of NestJS on Fastify                 | Manual error handling, validation and logging boilerplate that NestJS provides                                                                         |

## History

The first version targeted AWS: Lambda + API Gateway for hosting, DynamoDB single-table storage with a shared GSI and write-sharded delivery keys, an SST stack, a scheduled Lambda for stale-subscriber cleanup, and an authenticated `/admin` API for listing and revoking subscribers. When it became clear the relay would only ever run locally, all of that was removed: the infrastructure stack, the Lambda adapter package, the DynamoDB client, the admin API, and the unauthenticated `POST /subscribers/register` endpoint (the OAuth callback is the only way a subscriber is registered). To go back to a hosted relay, replace the two repositories behind `SUBSCRIBER_REGISTRY_REPOSITORY` and `WEBHOOK_DELIVERIES_REPOSITORY`; nothing else depends on SQLite.

## References

- [ADR 0002: OAuth and Subscriber Registration](0002-oauth-and-subscriber-registration.md)
- [ADR 0003: Webhook Routing and Delivery](0003-webhook-routing-and-delivery.md)
- [ADR 0005: Deterministic Subscriber Identity](0005-deterministic-subscriber-identity.md)
