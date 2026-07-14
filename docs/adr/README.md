# Architecture Decision Records (ADRs) — Relay Service

This directory contains architecture decision records for the Linear Dispatcher Relay Service.

## Index

### Core Architecture

- **[ADR 0001: Relay Service Architecture](0001-relay-service-architecture.md)** — Why a dedicated relay service? Single OAuth gateway, subscriber registry, webhook routing.

### Infrastructure & Storage

- **[ADR 0002: DynamoDB for Relay State](0002-dynamodb-for-relay-state.md)** — Why DynamoDB over RDS? Serverless, TTL support, global indexes.
- **[ADR 0005: Serverless Lambda Architecture](0005-serverless-lambda-architecture.md)** — Why Lambda functions? Cost-efficient, auto-scaling, minimal ops.

### Security & Integration

- **[ADR 0003: OAuth and Subscriber Registration](0003-oauth-and-subscriber-registration.md)** — Two-stage OAuth flow with Linear. Dispatcher registration and HMAC signing.
- **[ADR 0004: Webhook Routing and Delivery](0004-webhook-routing-and-delivery.md)** — Synchronous delivery, domain-based routing, failure handling.

### Application Framework

- **[ADR 0006: NestJS for Relay API](0006-nestjs-for-relay-api.md)** — Framework choice. Structured, type-safe, serverless-http adapter.

### Operational Concerns

- **[ADR 0007: Subscriber Cleanup and TTL](0007-subscriber-cleanup-and-ttl.md)** — DynamoDB TTL + daily reap-stale job. Keep registry healthy.

### Dispatcher Concerns

- **[ADR 0008: Label-Based Repository Routing](0008-label-based-repo-routing.md)** — Route webhook execution to correct repo via Linear labels. Multi-repo team support.
- **[ADR 0009: Preflight Validation](0009-preflight-validation.md)** — Verify repos, skills, and configuration on startup. Fail fast.

## Status Legend

- **Accepted** — Currently in use, stable
- **Proposed** — Under consideration
- **Deprecated** — Superseded by a newer ADR
- **Superseded** — Replaced by a newer ADR

## How to Use This Repository

1. **For onboarding**: Start with [ADR 0001](#core-architecture) to understand the overall architecture.
2. **For implementation**: Reference the relevant ADR before building a feature (e.g., adding a new endpoint? Check ADR 0006).
3. **For decisions**: If changing a decision, update the relevant ADR and mark the old one as "Superseded".
4. **For debugging**: ADRs explain the "why" behind design choices; useful when troubleshooting.

## Contributing

When adding a new feature or changing an existing decision:

1. Check if an existing ADR covers it. If yes, update it.
2. If creating a new ADR, follow the template (Status, Context, Decision, Consequences, Alternatives).
3. Number sequentially (0008, 0009, etc.) in the order they're decided.
4. Update this README with a brief summary.
5. Commit ADR changes alongside code changes.

## Quick Reference

| Concern                                | ADR                                               |
| -------------------------------------- | ------------------------------------------------- |
| Why a relay service at all?            | [0001](0001-relay-service-architecture.md)        |
| Why DynamoDB?                          | [0002](0002-dynamodb-for-relay-state.md)          |
| How does OAuth work?                   | [0003](0003-oauth-and-subscriber-registration.md) |
| How are webhooks delivered?            | [0004](0004-webhook-routing-and-delivery.md)      |
| Why Lambda?                            | [0005](0005-serverless-lambda-architecture.md)    |
| Why NestJS?                            | [0006](0006-nestjs-for-relay-api.md)              |
| How is subscriber cleanup handled?     | [0007](0007-subscriber-cleanup-and-ttl.md)        |
| How do handlers run in the right repo? | [0008](0008-label-based-repo-routing.md)          |
| What happens on dispatcher startup?    | [0009](0009-preflight-validation.md)              |
