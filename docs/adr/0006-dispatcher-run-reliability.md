# ADR 0006: Dispatcher Run Reliability

**Status:** Accepted

**Date:** 2026-07-17

**Amended:** 2026-10-12 — added "Unattended execution" (permissions, and stopping to ask).

## Context

[ADR 0003](0003-webhook-routing-and-delivery.md) documents the relay's
delivery reliability stance: synchronous, fire-and-forget, no automatic
retry. The dispatcher side needs the equivalent: an explicit stance on what
happens once a webhook is accepted and a Claude run is enqueued — how many
runs are allowed to be in flight, what happens when one crashes or hangs,
and how failures are told apart from routine, intentional rejections in the
logs. A 2026-07-17 audit of `services/dispatcher-service` found this area
was largely undocumented and, in a few places, not doing what its own code
comments claimed:

- A process crash mid-run left its issue permanently rejecting all future
  webhooks — the one-active-run-per-issue check had no path to clear a run
  that never reached a terminal state.
- `ActiveRunError` and `RecentDuplicateRunError` — both routine, intentional
  policy rejections — were logged identically to genuine unexpected bugs
  (`[NEEDS_ATTENTION]`), which would pollute any log-based alerting.
- The webhook queue processor stopped processing entirely after the first
  failure in a batch, stalling every *other*, unrelated queued webhook until
  a fresh delivery happened to arrive and restart it.
- The Claude child process only ever received `SIGTERM` on timeout, with no
  escalation — a process that ignored or outlived `SIGTERM` could hang
  indefinitely past its own configured timeout.

## Decision

### No run cap

There is no ceiling on how many runs the dispatcher enqueues per day, per
repo, or overall. Loop protection — the actual risk a cap would guard
against — is handled structurally by
[ADR 0004](0004-dispatch-trigger-and-repo-routing.md)'s trigger-semantics
stage and the duplicate-run window below; a cross-issue count has no
principled relationship to that risk and would just throttle unrelated,
legitimate work on a busy day. If a per-repo-per-day cap is wanted later as
defense-in-depth, it belongs in `routing.config.json`'s `policy` block (same
ADR), scoped per repo.

### Duplicate-run protection: kept, now real config

`duplicateRunWindowMs` (default 60s) rejects a second run for the same
(issue, domain, skill) within the window — unlike the daily cap, this has a
concrete, still-relevant justification: it's what would catch a duplicate
webhook delivery (e.g. the exact double-delivery bug fixed in
[ADR 0005](0005-deterministic-subscriber-identity.md)) before it causes a
second real run. Now sourced from `routing.config.json`'s `policy` block
instead of an unused pass-through parameter.

### Policy rejections vs. bugs: distinct log markers

`ActiveRunError`/`RecentDuplicateRunError` log `[ACTION_SKIPPED]`, not
`[NEEDS_ATTENTION]` — the store deliberately declined to enqueue, this isn't
a broken system.

### Stale runs: reconciled on startup and periodically

`StaleRunReconciliationService` calls `reconcileStaleRuns` on module init and
every 5 minutes thereafter, marking anything stuck in `pending`/`running`
past `config.executor.timeout` as `failed`. Closes the "crash leaves an
issue permanently blocked" gap without needing an external cron — the
dispatcher already runs continuously.

### Failed webhooks: skip and continue, no automatic retry

The processing loop now continues to the next queued row after a failure
instead of breaking. This is a bug fix, not a retry policy change — the
dispatcher still does not retry a failed dispatch automatically (matching
the relay's stance in [ADR 0003](0003-webhook-routing-and-delivery.md)):
most failure causes here (label validation, policy rejection, an actual bug)
aren't transient network blips that benefit from retry-with-backoff, and
`dispatchWebhook` already posts feedback to Linear explaining why nothing
happened.

### Process timeout: SIGTERM, then SIGKILL after a grace period

On timeout, `SIGTERM` is sent to the process group first; if it's still
running `SIGKILL_GRACE_MS` (10s) later, `SIGKILL` follows. Both signals go
through a guarded helper — `process.kill()` throws synchronously if the
target has already exited, and an uncaught throw inside a bare `setTimeout`
callback would crash the whole dispatcher process, not just the one run.

### Unattended execution: permissions, and stopping to ask

A run is one headless `claude -p` turn, so nobody can answer a permission prompt
or a clarifying question. Both used to fail confusingly: a tool the repo hadn't
allow-listed was denied ("the `get_issue` call was denied"), and an agent that
ended its reply with a question was recorded as `succeeded`.

**Permissions.** Each run is started with `--allowedTools` and
`--permission-mode dontAsk`. The allowed set is the core tools
(`Read, Edit, Write, Glob, Grep, Bash, Skill, Task, TodoWrite, NotebookEdit`) plus every
MCP server configured for that repo, discovered with `claude mcp list` (user,
project, plugin and claude.ai connector servers alike) and cached per repo for 10
minutes, so a newly added server works with no per-tool lists. `dontAsk` makes
anything not allowed fail deterministically instead of waiting for a prompt. The repo's own
`.claude/settings.json` still applies, including its `deny` rules. Tunable with
`CLAUDE_ALLOWED_TOOLS`, `CLAUDE_ALLOW_ALL_MCP=false` and `CLAUDE_PERMISSION_MODE`.
`bypassPermissions` was rejected: it is documented for sandboxes only, and issue
text is untrusted input.

**Stopping to ask.** A skill that must ask begins its final reply with
`Stop rule:`. The dispatcher records such a run as `needs_input` (a terminal status
distinct from `succeeded` and `failed`), posts the reply on the Linear issue as an
"Action required" comment (an elicitation for agent sessions), and logs
`[NEEDS_ATTENTION]`. The monitor TUI lists these runs under **Needs input**. The
answer is given on the issue and the run re-triggered; the dispatcher does not resume
it. The duplicate-run window applies as usual.

## Consequences

**Advantages:**

- No single bad webhook or run can silently starve the rest of the system —
  one queued webhook failing doesn't block any other.
- A crashed dispatcher process self-heals its stuck runs on restart (and
  every 5 minutes after) without operator intervention.
- Hung Claude processes are actually terminated, not just asked nicely once.
- Log-based alerting on `[NEEDS_ATTENTION]` now only fires for things that
  actually need attention.

**Disadvantages:**

- No loop protection beyond [ADR 0004](0004-dispatch-trigger-and-repo-routing.md)'s
  trigger-semantics logic and the 60s duplicate-run window — if a future bug
  reintroduces runaway re-dispatching at a slower cadence than 60s apart,
  nothing catches it. Accepted: a count-based ceiling would only trade that
  gap for arbitrarily throttling legitimate work on a busy day, which isn't
  a better failure mode.
- `StaleRunReconciliationService`'s 5-minute sweep interval means a stuck
  run can occupy its issue's "one active run" slot for up to 5 minutes past
  `config.executor.timeout` before being reconciled, on top of the timeout
  itself and the `SIGKILL_GRACE_MS` grace period.

## Alternatives Considered

| Approach | Rejected because |
|---|---|
| A per-issue same-day run cap, in addition to the below | Redundant — `duplicateRunWindowMs` plus the one-active-run-per-issue check already prevent the failure mode a cap would catch, with no clear gap left for a count-based limit to fill |
| Retry failed webhook deliveries with backoff | Most failure causes here are not transient (validation errors, policy rejections, real bugs) — blind retry wouldn't help and would duplicate the feedback already posted to Linear on first failure |
| Kill only the direct child process on timeout, not the process group | Wouldn't reach subprocesses Claude itself spawns, which is the actual risk a timeout needs to cover |

## References

- [ADR 0003: Webhook Routing and Delivery](0003-webhook-routing-and-delivery.md) — the relay-side equivalent reliability stance
- [ADR 0004: Webhook Dispatch — Trigger Semantics and Repository Routing](0004-dispatch-trigger-and-repo-routing.md) — `routing.config.json`'s `policy` block, where `duplicateRunWindowMs` lives, and the trigger-semantics logic that makes a run cap unnecessary for loop protection
