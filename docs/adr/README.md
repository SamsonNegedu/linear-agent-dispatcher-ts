# Architecture Decision Records (ADRs) — Linear Dispatcher System

This directory contains architecture decision records for the relay service
and the local dispatcher it fans webhooks out to.

## Start Here

Read these to understand _why the system looks the way it does_.

- **[ADR 0001: Relay Service Architecture](0001-relay-service-architecture.md)** — Why a dedicated relay exists at all (OAuth gateway, subscriber registry), how it runs locally on NestJS/Fastify + SQLite, and why the original AWS design was removed.
- **[ADR 0002: OAuth and Subscriber Registration](0002-oauth-and-subscriber-registration.md)** — How a dispatcher connects: two-stage OAuth flow, HMAC signing.
- **[ADR 0003: Webhook Routing and Delivery](0003-webhook-routing-and-delivery.md)** — Relay → dispatcher delivery mechanics: synchronous, fire-and-forget, no retry.
- **[ADR 0004: Webhook Dispatch — Trigger Semantics and Repository Routing](0004-dispatch-trigger-and-repo-routing.md)** — Whether a webhook should trigger a dispatch at all (the rule that stops the dispatcher's own comments from re-triggering itself), and if so, which repo + skill it routes to, the `routing.config.json` format (repos + exposed skills) and policy block, and startup preflight checks.
- **[ADR 0005: Deterministic Subscriber Identity](0005-deterministic-subscriber-identity.md)** — Why a subscriber's ID excludes its delivery endpoint, and the duplicate-delivery bug that happens if it doesn't.
- **[ADR 0006: Dispatcher Run Reliability](0006-dispatcher-run-reliability.md)** — What happens on failure, timeout, crash, a denied permission, or a question once a run is enqueued.
- **[ADR 0007: Persisted Webhook Queue](0007-persisted-webhook-queue.md)** — How the dispatcher stores incoming deliveries, removes duplicates, drains them one at a time, and recovers after a restart.
- **[ADR 0008: One-Command Local Startup](0008-one-command-local-startup.md)** — What `pnpm dev:up` starts, in what order, how the public tunnel is chosen, and where credentials are saved.

That's the whole set, small enough to read start to finish for onboarding.

## Status Legend

- **Accepted** — Currently in use, stable
- **Proposed** — Under consideration
- **Deprecated** — Superseded by a newer ADR
- **Superseded** — Replaced by a newer ADR

## How to Use This Repository

1. **For onboarding**: Read all of them, in number order.
2. **For implementation**: Check the relevant ADR before building a feature that touches its area.
3. **For decisions**: If changing a decision, update the relevant ADR and mark the old one as "Superseded". If a decision turns out to have never actually been implemented, don't leave it marked "Accepted" — downgrade to "Proposed", replace it with what's actually built, or remove it. An ADR that describes fictional behavior is worse than no ADR.
4. **For debugging**: ADRs explain the "why" behind design choices; useful when troubleshooting.

## Contributing

When adding a new feature or changing an existing decision:

1. Check if an existing ADR covers it. If yes, update it — don't create a
   near-duplicate for a decision that's really a detail of one already
   recorded (e.g. "why SQLite" isn't independent of "why a local relay").
2. If it's genuinely a new, independently-reversible decision, create a new
   ADR (Status, Context, Decision, Consequences, Alternatives — no "Testing"
   section; that belongs in the test files themselves, not here).
3. Number sequentially in the order decided — don't reuse a number from a
   deleted ADR, even if there's a gap; stale external references (chat logs,
   old links) to that number would then point at the wrong decision.
4. Update this README.
5. Commit ADR changes alongside code changes.

## Quick Reference

| Concern                                                                  | ADR                                               |
| ------------------------------------------------------------------------ | ------------------------------------------------- |
| Why a relay service at all, and what's it built with?                    | [0001](0001-relay-service-architecture.md)        |
| How does OAuth work?                                                     | [0002](0002-oauth-and-subscriber-registration.md) |
| How are webhooks delivered?                                              | [0003](0003-webhook-routing-and-delivery.md)      |
| Should a webhook dispatch at all, and which repo/skill does it route to? | [0004](0004-dispatch-trigger-and-repo-routing.md) |
| Why doesn't re-registering create a duplicate?                           | [0005](0005-deterministic-subscriber-identity.md) |
| What happens if a run fails, hangs, crashes, or needs to ask something?  | [0006](0006-dispatcher-run-reliability.md)        |
