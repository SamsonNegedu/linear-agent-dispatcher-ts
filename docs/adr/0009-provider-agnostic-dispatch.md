# ADR 0009: Provider-Agnostic Dispatch and Reporting

**Status:** Accepted

**Date:** 2026-10-14

## Context

The system takes webhooks from a tracker (today Linear), turns them into Claude runs, and reports
back to the tracker. [ADR 0001](0001-relay-service-architecture.md) through
[ADR 0004](0004-dispatch-trigger-and-repo-routing.md) describe it in terms of Linear. A second
tracker, such as GitHub or Jira, is a likely next step.

Before this change the inbound half was already split by provider: `WebhookIngestAdapter`,
`RoutingResolver` and `DispatchAdapter` sat behind a registry in `@webhook-verify/core`. The outbound
half was not. `RunFeedbackService` built a Linear client directly, the issue-context resolver was a
single Linear-backed provider, and `WebhookController` repeated the whole verify-and-parse pipeline
inside a Linear-only route. Adding a tracker meant editing the executor, the dispatcher and the
controller, not adding one class.

## Decision

Every step that touches a tracker is a port with one implementation per provider, found in an
`AdapterRegistry` by `event.provider`. The core of each service knows only the ports.

| Service    | Port                   | Linear implementation        | Looked up in                                      |
| ---------- | ---------------------- | ---------------------------- | ------------------------------------------------- |
| relay      | `WebhookIngestAdapter` | `LinearIngestAdapter`        | `IngestAdapterRegistry`                           |
| relay      | `RoutingResolver`      | `LinearRoutingResolver`      | `RoutingResolverRegistry` (optional per provider) |
| dispatcher | `DispatchAdapter`      | `LinearDispatchAdapter`      | `DispatchAdapterRegistry`                         |
| dispatcher | `IssueContextResolver` | `LinearIssueContextResolver` | `ISSUE_CONTEXT_RESOLVER_REGISTRY` (optional)      |
| dispatcher | `RunReporter`          | `LinearRunReporter`          | `RUN_REPORTER_REGISTRY`                           |

- **Relay ingest** is `WebhookIngestService.ingest(provider, signature, rawBody)`: verify, parse,
  replay check, organization check, then fan out. A route only reads the provider's signature header
  and calls it. Per-provider settings (signing secret, organization) live in one map in that service.
  A provider with an adapter but no settings is refused, never verified against an empty secret.
- **Relay delivery** to a subscriber is `WebhookForwarder`, which does not know the provider.
- **Dispatcher** resolves the reporter with `getOrThrow(event.provider)`. A missing issue-context
  resolver is allowed: the dispatcher then routes on the webhook's own tags.
- **Port contracts** are provider-neutral: `NormalizedEvent`, `RunReporter` (`started`, `succeeded`,
  `failed`, `cancelled`, `needsInput`, `skipped`) and `IssueContext` (`labels`, `identifier`).
- **Injection tokens** are symbols (`STORE_REPOSITORY`, `ISSUE_CONTEXT_RESOLVER_REGISTRY`,
  `RUN_REPORTER_REGISTRY`), not strings.

### Adding a provider

1. In `@webhook-verify/core`, add a `WebhookIngestAdapter` that verifies and parses into a
   `NormalizedEvent`. If the replay timestamp is not the event time, set `timestamp` to the send time.
2. In relay, register it, add its settings to `WebhookIngestService`, add a route that reads its
   signature header, and register a `RoutingResolver` if its webhooks can omit team or owner.
3. In the dispatcher, register a `DispatchAdapter` and a `RunReporter`, and an `IssueContextResolver`
   if webhooks can omit labels.

### What stays Linear-shaped

Left alone until a second provider needs it, because the right shape depends on that provider:

- `config.linear.*` in both services, and the `LINEAR_*` environment variables.
- The relay's subscriber storage: `team_key`, `linear_user_id` and `getSubscribersByTeamAndAssignee`.
  Changing it is a SQLite migration, and [ADR 0005](0005-deterministic-subscriber-identity.md) ties
  subscriber identity to it.
- The `connect-relay`, `update-relay` and `test-webhook` commands.
- The label model in [ADR 0004](0004-dispatch-trigger-and-repo-routing.md): a repo label plus
  an `agent-<skill>` label.
- The `POST /webhooks/linear` route and its header.

## Consequences

**Advantages:**

- A second tracker is new classes plus a few registrations, with no edits to the executor, the
  dispatcher or the shared ingest steps.
- Each port can be tested with a fake. The executor tests use a fake reporter, and the ingest checks
  have their own spec.
- The relay's replay, signature and organization checks are written once, not per route.

**Disadvantages:**

- More small classes and registries to read than a single Linear client.
- The ports are shaped by one provider. A second one may show that `NormalizedEvent`, `RunReporter`
  or the owner and team routing keys need to change.
- Until the "stays Linear-shaped" list is generalized, a new provider still has to map onto a team
  key and an owner id.

## Alternatives Considered

| Approach                                                              | Rejected because                                                                                                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep Linear hardcoded until a second tracker exists                   | The ingest half was already abstracted, so the outbound half was the odd one out, and the seams are cheap now. Adding them later means touching running code. |
| One `Provider` interface bundling ingest, routing, resolution, report | The relay and the dispatcher are separate processes with different dependencies. A bundle would force each to depend on the other's pieces.                   |
| Generalize storage, config and the CLIs at the same time              | Guesses about a tracker that is not here yet. They are cheap to do once its shape is known.                                                                   |
