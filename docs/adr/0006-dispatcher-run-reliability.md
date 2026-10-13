# ADR 0006: Dispatcher Run Reliability

**Status:** Accepted

**Date:** 2026-07-17

**Amended:** 2026-10-12 — added "Unattended execution" (permissions, and stopping to ask).

## Context

[ADR 0003](0003-webhook-routing-and-delivery.md) sets the relay's delivery
stance: synchronous, fire-and-forget, no automatic retry. The dispatcher needs
its own stance on what happens after it accepts a webhook and enqueues a Claude
run. How many runs may be in flight? What happens when a run crashes or hangs?
How do the logs tell a failure from a routine, intentional rejection?

A 2026-07-17 audit of `services/dispatcher-service` found this area mostly
undocumented. In a few places the code did not do what its comments claimed:

- A process crash mid-run left the issue rejecting every future webhook. The
  one-active-run-per-issue check had no way to clear a run that never reached a
  terminal state.
- `ActiveRunError` and `RecentDuplicateRunError` are routine policy
  rejections. The dispatcher logged them as `[NEEDS_ATTENTION]`, the same
  marker as genuine bugs. That would pollute any log-based alerting.
- The webhook queue processor stopped after the first failure in a batch. Every
  other queued webhook stalled until a new delivery restarted the processor.
- On timeout, the dispatcher sent only `SIGTERM` to the Claude child process.
  A process that ignored `SIGTERM` could hang far past its configured timeout.

## Decision

### No run cap

The dispatcher sets no ceiling on runs per day, per repo, or overall. A cap
would guard against loops, but
[ADR 0004](0004-dispatch-trigger-and-repo-routing.md)'s trigger semantics and
the duplicate-run window below already handle loops structurally. A cross-issue
count has no principled link to loop risk. It would only throttle unrelated,
legitimate work on a busy day. If a per-repo daily cap is wanted later as
defense in depth, it belongs in the `policy` block of `routing.config.json`
(see ADR 0004), scoped per repo.

### Duplicate-run protection

`duplicateRunWindowMs` (default 60s) rejects a second run for the same issue,
domain and skill inside the window. This catches a duplicate webhook delivery,
such as the double-delivery bug fixed in
[ADR 0005](0005-deterministic-subscriber-identity.md), before it causes a
second real run. The value comes from the `policy` block of
`routing.config.json`.

### Policy rejections and bugs use different log markers

When the store declines to enqueue, the dispatcher logs `[ACTION_SKIPPED]` for
`ActiveRunError` and `RecentDuplicateRunError`. The system is working as
designed. Only unexpected errors log `[NEEDS_ATTENTION]`.

### Stale runs are reconciled on startup and every 5 minutes

`StaleRunReconciliationService` calls `reconcileStaleRuns` on module init and
every 5 minutes after. Any run stuck in `pending` or `running` for longer than
`config.executor.timeout` becomes `failed`. This frees an issue blocked by a
crash. The dispatcher runs continuously, so no external cron is needed.

### A failed webhook is skipped, not retried

The queue processing loop moves on to the next queued row after a failure
instead of stopping. This fixes a bug. It does not add a retry policy. The
dispatcher still never retries a failed dispatch, matching the relay's stance in
[ADR 0003](0003-webhook-routing-and-delivery.md). Most failures here are label
validation, policy rejection, or a real bug. Retry with backoff does not help
with those. `dispatchWebhook` already posts feedback to Linear explaining why
nothing happened.

### Timeouts send SIGTERM, then SIGKILL after a grace period

On timeout, the dispatcher sends `SIGTERM` to the Claude process group. If the
group is still running `SIGKILL_GRACE_MS` (10s) later, the dispatcher sends
`SIGKILL`. Both signals go through a guarded helper. `process.kill()` throws
synchronously when the target has already exited. An uncaught throw inside a
bare `setTimeout` callback would crash the whole dispatcher, not just one run.

### Unattended execution: permissions and stopping to ask

A run is one headless `claude -p` turn. Nobody can answer a permission prompt or
a clarifying question. Both used to fail in confusing ways. A tool the repo had
not allow-listed was denied (for example, "the `get_issue` call was denied"). An
agent that ended its reply with a question was recorded as `succeeded`.

**Permissions.** The dispatcher starts each run with `--allowedTools` and
`--permission-mode dontAsk`. The allowed set is the core tools (`Read, Edit,
Write, Glob, Grep, Bash, Skill, Task, TodoWrite, NotebookEdit`) plus every MCP
server configured for that repo. The dispatcher finds these servers with
`claude mcp list` (user, project, plugin and claude.ai connector servers alike)
and caches the result per repo for 10 minutes. A newly added server works
without per-tool lists. `dontAsk` makes any tool that is not allowed fail
immediately instead of waiting for a prompt. The repo's own
`.claude/settings.json` still applies, including its `deny` rules. Operators
tune this with `CLAUDE_ALLOWED_TOOLS`, `CLAUDE_ALLOW_ALL_MCP=false` and
`CLAUDE_PERMISSION_MODE`. We rejected `bypassPermissions`. Claude's docs
recommend it for sandboxes only, and issue text is untrusted input.

**Stopping to ask.** A skill that must ask begins its final reply with
`Stop rule:`. The dispatcher records the run as `needs_input`. This terminal
status is distinct from `succeeded` and `failed`. The dispatcher posts the reply
on the Linear issue as an "Action required" comment (an elicitation for agent
sessions) and logs `[NEEDS_ATTENTION]`. The monitor TUI lists these runs in the
Runs view (filter: Needs input) and flags the tab. The user answers on the issue
and re-triggers the run. The dispatcher does not resume the old run. The
duplicate-run window applies as usual.

## Consequences

**Advantages:**

- No single bad webhook or run can silently starve the rest of the system —
  one queued webhook failing doesn't block any other.
- A crashed dispatcher frees its stuck runs on restart, and every 5 minutes
  after, without operator action.
- A hung Claude process is killed, not just asked once to stop.
- Alerting on `[NEEDS_ATTENTION]` fires only for things that need attention.

**Disadvantages:**

- No loop protection beyond [ADR 0004](0004-dispatch-trigger-and-repo-routing.md)'s
  trigger-semantics logic and the 60s duplicate-run window — if a future bug
  reintroduces runaway re-dispatching at a slower cadence than 60s apart,
  nothing catches it. We accept this. A count-based ceiling would trade that
  gap for throttling legitimate work on a busy day, which is no better.
- With a 5-minute sweep, a stuck run can hold its issue's "one active run"
  slot for up to 5 minutes past `config.executor.timeout` before
  `StaleRunReconciliationService` clears it. That comes on top of the timeout
  and the `SIGKILL_GRACE_MS` grace period.

## Alternatives Considered

| Approach                                                             | Rejected because                                                                                                                                                                                    |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A per-issue same-day run cap, in addition to the options below       | Redundant. `duplicateRunWindowMs` and the one-active-run-per-issue check already prevent the failure a cap would catch                                                                             |
| Retry failed webhook deliveries with backoff                         | Most failures here are not transient (validation errors, policy rejections, real bugs). Retry would not help and would duplicate the feedback already posted to Linear on first failure |
| Kill only the direct child process on timeout, not the process group | Would miss subprocesses that Claude spawns, which is the risk a timeout must cover                                                                                                 |

## References

- [ADR 0003: Webhook Routing and Delivery](0003-webhook-routing-and-delivery.md) — the relay-side equivalent reliability stance
- [ADR 0004: Webhook Dispatch — Trigger Semantics and Repository Routing](0004-dispatch-trigger-and-repo-routing.md) — `routing.config.json`'s `policy` block, where `duplicateRunWindowMs` lives, and the trigger-semantics logic that makes a run cap unnecessary for loop protection
