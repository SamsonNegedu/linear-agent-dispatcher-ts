# ADR 0010: Label Scanner

**Status:** Accepted

**Date:** 2026-11-06

## Context

Runs start only from a webhook ([ADR 0004](0004-dispatch-trigger-and-repo-routing.md)). Work that
exists but never produced a webhook is never started: issues already in a project's backlog, issues
created while the dispatcher was off, issues whose run failed. We want issues to be picked up
continuously and unattended, without a person re-triggering each one.

## Decision

A `ScannerService` in the dispatcher polls Linear and feeds what it finds into the existing
`WebhookQueueService`. Nothing downstream changes: routing, the one-active-run rule, the duplicate
window, the executor and reporting all treat a scan like a webhook.

- **Scopes.** `scanner.scopes[]` in `routing.config.json` lists where to look: a whole `team` (key)
  or one `project` (id). A team scope is needed for triage, because new issues usually have no
  project yet. Anything outside a listed scope is never scanned.
- **Watched labels are the mode labels.** Each scope has `watch[]`, a list of `{ label, states }`,
  for example `agent-triage` in `Triage` and `agent-implement` in `Todo`. The label picks the skill
  through the existing routing, so the scanner config holds no skill names or repo paths. Removing
  the label from an issue takes it out at once.
- **Skipped quietly:** an issue that would not route (not exactly one repo label, or a second mode
  label next to the watched one). The webhook path reports those on the issue; a scanner that did
  would repeat it every tick. Moving an issue from triage to implement is a label swap.
- **The run table is the claim, per issue, skill and round.** An issue is picked up for a skill only
  if it has no run of that skill in the current round, or only `failed` ones below `maxAttempts`. A
  `running`, `pending`, `succeeded`, `needs_input` or `cancelled` run means a human decides next
  (reply, or take the label off and put it back). Because the claim is per skill, a
  finished triage run does not block the implement run on the same issue.
- **A round starts when the issue becomes a candidate.** That is the later of the watched label
  being added and the issue entering its current state. Only runs started after it count, so an
  issue that has `agent-triage` taken off (say for `needs-design`) and put back, or that leaves
  Triage and returns, is new work with its failed-attempt count back at zero. The moment comes from
  the issue's Linear history, looked up only for an issue that already has a run. A live run blocks
  whatever the history says, and if the lookup fails the scanner counts every run, so it errs on
  starting nothing.
- **Idempotency key per skill, round and attempt:** `scan:<issue>:<skill>:<roundStart>:<failedRuns>`
  (`roundStart` is 0 before the issue has history to reset). Repeat ticks before the run row exists
  collapse in the queue; a retry, or a return to the state, gets a new key. Without `roundStart` the
  second round's key would equal the first's and be rejected as a duplicate payload.
- **Out of attempts:** the scanner posts one comment, per round, telling a person to take the label
  off and put it back, then stops.
- **Concurrency:** `maxConcurrent` per scope, shared by its watches and counted from issues this
  process dispatched. A restart loses the count, but stale runs are failed on startup
  ([ADR 0006](0006-dispatcher-run-reliability.md)).
- **Event shape:** the synthetic event has `action: 'scan'`, which `LinearDispatchAdapter` accepts and
  the run records as `triggerSource: 'scan'`.

## Monitor

`GET /monitor/scanner` returns the last pass: when it ran and how long it took, each scope's slots in
use, and for every issue seen an outcome (`dispatched`, `active`, `done`, `needs_input`, `cancelled`,
`exhausted`, `waiting`, `skipped`, `closed`) with the reason. It is kept in memory, so a restart
starts it empty. The monitor TUI shows it in a Scanner tab, and marks runs the scanner started
(`triggerSource: 'scan'`) with `↻` in the Runs view. The reasons matter most for `skipped`: the
scanner reports nothing on the issue itself, so this is the only place a mislabelled issue shows up.

## Not done

- Backoff between retries beyond the scan interval and the duplicate-run window.
- A cap on spend per day (still none, per ADR 0006).
- Webhook-driven runs ignore the scanner's attempt limit.
