# ADR 0004: Webhook Dispatch — Trigger Semantics and Repository Routing

**Status:** Accepted

**Date:** 2026-07-17 (originally two ADRs: repo routing 2026-07-12, trigger semantics 2026-07-17 — merged, see history below)

**Amended:** 2026-10-12 — the routing config is now a list of repos plus an explicit list of exposed skills (Stage 2), and preflight fails startup on a missing repo path or skill (Preflight Validation).

## Context

The dispatcher receives every Linear webhook for a subscribed team and must
decide, in order:

1. **Should this webhook trigger a dispatch at all?** Not every webhook
   represents real work — Linear fires an `Issue` `update` webhook for _any_
   field change, including our own bot posting a progress/success comment
   (which only bumps `updatedAt`).
2. **If so, which repository and Claude skill does it route to?** Teams
   manage multiple repositories (backend, frontend, infra, etc.), each with
   different context and available skills, and Linear has no native "repo"
   field — something has to map an issue to a codebase.

These were originally two separate ADRs. They're merged here because they're
two sequential steps of the same function (`DispatcherService.dispatchWebhook()`),
not independently-reversible decisions — same reasoning as ADR 0001 absorbing
the relay's Lambda/DynamoDB/NestJS choices into one record instead of three.

### Why trigger semantics needed fixing

The first version of trigger logic only did step 2: if the issue's _current_
labels resolved to a valid repo + skill, it dispatched — with no regard for
_why_ this particular webhook fired. Trigger labels stay on the issue after a
run completes (nothing removes them), so a self-authored progress/success
comment (which only bumps `updatedAt`) re-passes label validation and
re-dispatches indefinitely: run → comment → webhook → run → ... Each
iteration is a real Claude run (~$0.08–0.15), so this isn't just a logging
nuisance — it's an unbounded, unattended cost.

The fix that was tried first — requiring `labelChange.added` to be
non-empty — over-corrected: it also silently blocked legitimate re-triggers
that had nothing to do with labels at all, e.g. assigning the dispatcher's
OAuth agent as delegate.

### Why routing needed a real config

Before `routing.config.json` existed, every issue routed to a single
hardcoded repo path — no way to run different skills against different
codebases.

## Decision

### Stage 1: Should this dispatch at all

Use Linear's `updatedFrom` field generically instead of special-casing
labels. `updatedFrom` (present on `update` webhooks only) holds the previous
value of every field that actually changed in that specific delivery —
nothing more. A webhook whose `updatedFrom` contains _only_ `updatedAt` means
no real issue field changed; something merely touched the issue's timestamp
as a side effect (a comment being posted is the only way this happens in
practice).

`shouldTriggerDispatch(event)` (`packages/webhook-verify/src/linear/index.ts`):

1. `AgentSession` events (`action: 'created'` or `'prompted'`) always
   dispatch — a human interacting with an agent session in Linear's UI
   (assigning the agent to a new session, or sending a follow-up message in
   an existing one) is itself the trigger, independent of labels. This is a
   separate webhook envelope from `Issue` events (`type: 'AgentSessionEvent'`
   vs. the classic `{webhookId, data}` shape) and carries no `labels` or
   `issueIdentifier` of its own — see "AgentSession Label Resolution" below
   for how it still routes to a repo/skill.
2. Issue `create` events always dispatch — there's no `updatedFrom` on
   create, so there's nothing to diff against; the issue's initial labels
   aren't a "change" to react to.
3. Issue `update` events dispatch if `changedFields` (the `updatedFrom` keys,
   minus `updatedAt`) is non-empty — i.e. _some_ real field changed, of any
   kind. Stage 2 (below) still separately decides whether that field state
   routes anywhere. Delegate assignment (setting the dispatcher's OAuth agent
   as an issue's delegate) is an `Issue` `update` with
   `changedFields: ['delegateId']` — it goes through this path, not the
   `AgentSession` one above.
4. Anything else does not dispatch.

This function only answers "is there a reason to look at this webhook at
all," not "where does it go" — that's Stage 2.

### Stage 2: Where it routes

Use Linear issue labels for routing:

- **Domain labels** map to repositories via `routing.config.json`. A repo's label
  is its folder name unless the entry sets `label`.
- **Mode labels** `agent-<name>` run the Claude skill `/<name>` in that repo — but
  only for skills explicitly listed in `skills` (top-level, applying to every
  repo, plus a repo's own `skills`). Nothing is exposed by default, so a label on
  a Linear issue can never launch a skill the operator did not list.
- `issueLabelToSkill` on a repo maps a label to a differently named skill
  (`"agent-build": "implement"`).
- Label names are keys; no string parsing

Store routing configuration in `routing.config.json` (gitignored — each deployment
has its own local repo paths; `routing.config.example.json` is the checked-in
template). A repo is just a path unless something needs overriding:

```json
{
  "$schema": "./routing.config.schema.json",
  "policy": {
    "skipDoneIssues": false,
    "duplicateRunWindowMs": 60000
  },
  "skills": ["implement", "fix-bug"],
  "repositories": ["~/code/backend", { "path": "~/code/frontend", "skills": ["design-review"] }]
}
```

The file is validated with a zod schema (`routing-schema.ts`); unknown keys,
bad labels and duplicate repo labels are rejected at startup with the offending
path. `pnpm routes` prints the resulting repo / label / skill table with a
✓/✗ for each skill on disk, `pnpm routes check` exits non-zero on a problem,
and `pnpm routes add <path>` registers a repo. The earlier format — a
per-repo `issueLabelToSkill` map and no `skills` list — still loads, but no longer
exposes anything on its own beyond the mappings it names.

The top-level `policy` block is optional (each field defaults if omitted) and
governs _whether_ a dispatch happens at all, on top of Stage 1 — see
"Dispatch Policy" under Implementation Details.

`LinearDispatchAdapter.resolveRouting()`:

1. Check issue labels against repository keys in config — exactly one domain
   label required; zero or multiple matches is a validation error (posted as
   a Linear comment), there is no default repo to fall back to
2. Find the mode label among the issue's remaining (non-domain) labels —
   exactly one required among the repo's exposed mode labels, same
   zero-or-multiple validation
3. Invoke the corresponding Claude skill in the resolved repo directory

### AgentSession Label Resolution

`AgentSession` webhooks (`parseAgentSessionWebhook`) hardcode `labels: []`
and `issueIdentifier: ''` — Linear's agent-session envelope doesn't include
them. Left as-is, every `AgentSession`-triggered dispatch would fail Stage 2
label validation with zero domain labels. `DispatcherService` routes
`event.labels` through `LinearGraphQLClient.resolveLabels(issueId, webhookLabels)`
before label validation runs: if the webhook-supplied label count is below
`MIN_LABEL_COUNT_FOR_FALLBACK` (2), it fetches the issue's real labels from
the Linear API instead of trusting the (empty) webhook value. This is what
actually makes `AgentSession` events routable — without a configured Linear
API key (`LinearGraphQLClient` is only constructed when one is present),
`AgentSession` dispatches always fail label validation.

## Consequences

**Advantages:**

- Kills the comment-triggered feedback loop: a comment-only update has
  `changedFields: []`.
- Restores every other legitimate trigger (delegate assignment, state
  changes, any field edit) without enumerating them — the Stage 1 check is
  generic over _whether something changed_, not _which specific field_.
- No new infrastructure for Stage 1: purely a read of a field Linear already
  sends, no actor/bot-identity lookups, no extra API calls, no cached state.
  Keeps the webhook-parsing layer "mildly dumb" — it reports what changed,
  and leaves what to do about it to the caller.
- Stage 2's direct key-based label lookup prevents typos and parsing errors;
  labels are visible in Linear UI (clear audit trail); config is
  version-controlled instead of environment variables; each repo defines its
  own modes, scaling to any number of repos/skills.
- No silent default: a missing or ambiguous domain/mode label, or a webhook
  that shouldn't dispatch, fails loudly (a comment on the issue, or nothing)
  instead of routing somewhere unintended.

**Disadvantages:**

- A human editing an _unrelated_ field (e.g. fixing a typo in the
  description) on an issue that still carries valid trigger labels will
  re-dispatch a run, since `changedFields` doesn't distinguish "relevant"
  fields from irrelevant ones. Accepted: no evidence yet that this happens
  often enough to matter, and narrowing it (e.g. an allowlist of fields that
  count) reintroduces the same enumeration problem that broke delegate
  assignment the first time.
- Teams must remember to label issues with repo names, and each deployment
  needs its own `routing.config.json`.

**Mitigation:**

- Use Linear automations to add repo labels by default
- Preflight validation warns about missing repo paths and skill config at
  startup (see "Preflight Validation" below) — doesn't prevent bad config
  from loading, but surfaces it before the first webhook does

## Alternatives Considered

**Trigger semantics (Stage 1):**

| Approach                                                                      | Rejected because                                                                                                                                                                           |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Require `labelChange.added` non-empty (first attempt)                         | Over-corrected — blocked delegate assignment and any other legitimate non-label trigger; see Context                                                                                       |
| Track the webhook actor and skip self-authored updates                        | Requires the dispatcher to know its own bot/OAuth user identity (a lookup + cache), and belongs to dispatcher-specific config, not the generic webhook-parsing layer shared with the relay |
| Time-based debounce (ignore updates within N seconds of our own last comment) | Doesn't distinguish cause from coincidence — a genuine human edit seconds after a bot comment would also be dropped; adds a timing-dependent failure mode instead of a structural one      |

**Routing (Stage 2):**

| Approach             | Rejected Because                                          |
| -------------------- | --------------------------------------------------------- |
| **Linear Projects**  | Multiple projects per repo; hierarchy too complex         |
| **Issue Assignee**   | Unreliable; people work across multiple repos             |
| **Custom Fields**    | Requires API setup per workspace                          |
| **Monorepo Subdirs** | Breaks multi-repo setups; couples dispatcher to structure |
| **Default-Only**     | Doesn't support multi-repo use case                       |

## Implementation Details

- Load `routing.config.json` on startup; `RoutingConfigService` validates
  structure against the zod schema (fail fast: missing/malformed `repositories`,
  duplicate labels, invalid label/skill format, unknown keys, malformed
  `policy`) — it does **not** check that repo paths or skills exist on disk;
  that's the preflight step below
- ExecutorService uses per-repo mutex to serialize runs (only one handler per repo at a time)

### Preflight Validation

Config that resolves at startup but points at something broken (a repo path that
doesn't exist, a listed skill the repo doesn't have) would otherwise only
surface as an error on the _first webhook_ for that repo — and, because runs are
unattended, as a run that silently does nothing. `PreflightService` runs on
dispatcher startup (unless `PREFLIGHT_SKIP=1`) and checks:

1. The `claude` binary exists (`which <claudeBinPath>`) — **error**
2. For each configured repo: the repo path exists on disk — **error**
3. For each configured repo: at least one skill is exposed — **error**
4. For each exposed skill (and `issueLabelToSkill` target): it resolves to
   `.claude/skills/<name>/SKILL.md` or `.claude/commands/<name>.md` in the repo
   or the user's `~/.claude` — **error**. Plugin skills (`plugin:skill`) can't be
   checked on disk and are skipped.
5. A Linear API key is configured — informational log if present, else
   **warning** (activity posting is skipped without one)

Any error fails startup with every problem listed together. This is a change
from the original stance (only the binary check failed startup): a broken repo
used to affect only its own webhooks, but a mapping that points at nothing is a
configuration mistake the operator can fix in seconds, and finding it at boot
beats finding it in a Linear comment. `pnpm routes check` runs the same
path/skill check without starting the dispatcher.

Implemented as `PreflightService implements OnModuleInit`, self-contained
within `PreflightModule` — not orchestrated by any other module.

### Dispatch Policy

`routing.config.json`'s `policy` block governs whether a dispatch happens at
all, on top of Stage 1:

- `skipDoneIssues` (default `false`): when `true`, an Issue update whose
  current Linear state is Completed/Canceled never dispatches, even if a
  trigger label was added in the same webhook.
- `duplicateRunWindowMs` (default `60000`): minimum time between two runs for
  the same (issue, domain, skill) combination before a new one is rejected as
  a duplicate — guards against a relay redelivering the same event twice
  (e.g. via overlapping subscriber registrations).

Both are validated at startup by `RoutingConfigService`; invalid values fail
fast the same as an invalid `repositories` entry.

## References

- [ADR 0001: Relay Service Architecture](0001-relay-service-architecture.md) — Multi-team dispatch context
- [ADR 0003: Webhook Routing and Delivery](0003-webhook-routing-and-delivery.md) — Domain-based routing at relay level, upstream of this dispatcher-side decision
- `packages/webhook-verify/src/linear/index.test.ts` — test fixtures built from real captured payloads (label removal, delegate assignment) confirming `changedFields` derivation
