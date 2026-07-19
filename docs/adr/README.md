# Architecture Decision Records (ADRs) — Linear Dispatcher System

This directory contains architecture decision records for the relay service
and the local dispatcher it fans webhooks out to.

## Start Here

Read these to understand *why the system looks the way it does*.

- **[ADR 0001: Relay Service Architecture](0001-relay-service-architecture.md)** — Why a dedicated, serverless relay exists at all: OAuth gateway, subscriber registry, Lambda + DynamoDB + NestJS/Fastify.
- **[ADR 0002: OAuth and Subscriber Registration](0002-oauth-and-subscriber-registration.md)** — How a dispatcher connects: two-stage OAuth flow, HMAC signing.
- **[ADR 0003: Webhook Routing and Delivery](0003-webhook-routing-and-delivery.md)** — Relay → dispatcher delivery mechanics: synchronous, fire-and-forget, no retry.
- **[ADR 0004: Webhook Dispatch — Trigger Semantics and Repository Routing](0004-dispatch-trigger-and-repo-routing.md)** — Whether a webhook should trigger a dispatch at all (the rule that stops the dispatcher's own comments from re-triggering itself), and if so, which repo + skill it routes to, the `routing.config.json` policy block, and startup preflight checks.
- **[ADR 0005: Deterministic Subscriber Identity](0005-deterministic-subscriber-identity.md)** — Why a subscriber's ID excludes its delivery endpoint, and the duplicate-delivery bug that happens if it doesn't.
- **[ADR 0006: Dispatcher Run Reliability](0006-dispatcher-run-reliability.md)** — What happens on failure, timeout, or crash once a run is enqueued.

That's the whole set — small enough to read start to finish for onboarding.

## Status Legend

- **Accepted** — Currently in use, stable
- **Proposed** — Under consideration
- **Deprecated** — Superseded by a newer ADR
- **Superseded** — Replaced by a newer ADR

## How to Use This Repository

1. **For onboarding**: Read all of them, in number order — there are only six.
2. **For implementation**: Check the relevant ADR before building a feature that touches its area.
3. **For decisions**: If changing a decision, update the relevant ADR and mark the old one as "Superseded". If a decision turns out to have never actually been implemented, don't leave it marked "Accepted" — downgrade to "Proposed", replace it with what's actually built, or remove it. An ADR that describes fictional behavior is worse than no ADR.
4. **For debugging**: ADRs explain the "why" behind design choices; useful when troubleshooting.

## Contributing

When adding a new feature or changing an existing decision:

1. Check if an existing ADR covers it. If yes, update it — don't create a
   near-duplicate for a decision that's really a detail of one already
   recorded (e.g. "why DynamoDB" isn't independent of "why serverless").
2. If it's genuinely a new, independently-reversible decision, create a new
   ADR (Status, Context, Decision, Consequences, Alternatives — no "Testing"
   section; that belongs in the test files themselves, not here).
3. Number sequentially in the order decided — don't reuse a number from a
   deleted ADR, even if there's a gap; stale external references (chat logs,
   old links) to that number would then point at the wrong decision.
4. Update this README.
5. Commit ADR changes alongside code changes.

## Quick Reference

| Concern                                          | ADR                                                    |
| ------------------------------------------------- | ------------------------------------------------------- |
| Why a relay service at all, and what's it built with? | [0001](0001-relay-service-architecture.md)            |
| How does OAuth work?                             | [0002](0002-oauth-and-subscriber-registration.md)        |
| How are webhooks delivered?                      | [0003](0003-webhook-routing-and-delivery.md)              |
| Should a webhook dispatch at all, and which repo/skill does it route to? | [0004](0004-dispatch-trigger-and-repo-routing.md) |
| Why doesn't re-registering create a duplicate?   | [0005](0005-deterministic-subscriber-identity.md)          |
| What happens if a run fails, hangs, or crashes?  | [0006](0006-dispatcher-run-reliability.md)                  |
