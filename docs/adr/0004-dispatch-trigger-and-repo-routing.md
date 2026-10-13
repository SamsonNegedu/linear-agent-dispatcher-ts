# ADR 0004: Webhook Dispatch — Trigger Semantics and Repository Routing

**Status:** Accepted

**Date:** 2026-07-17 (originally two ADRs: repo routing 2026-07-12, trigger semantics 2026-07-17 — merged, see history below)

**Amended:** 2026-10-12 — the routing config is now a list of repos plus an explicit list of exposed skills (Stage 2), and preflight fails startup on a missing repo path or skill (Preflight Validation).

## Context

The dispatcher receives every Linear webhook for a subscribed team and must
decide, in order:

1. **Should this webhook trigger a dispatch at all?** Not every webhook
   represents real work. Linear fires an `Issue` `update` webhook for _any_
   field change, including our own bot posting a progress or success comment.
   That comment only bumps `updatedAt`.
2. **If so, which repository and Claude skill does the webhook route to?**
   Teams manage several repositories (backend, frontend, infra), each with
   its own context and skills. Linear has no native "repo" field, so something
   must map an issue to a codebase.

These were originally two ADRs. They are merged here because they are two
sequential steps of one flow in `DispatcherService` and its
`LinearDispatchAdapter`, not independently reversible decisions. ADR 0001
takes the same approach: it holds the relay's hosting, storage and framework
choices in one record instead of three.

### Why trigger semantics needed fixing

The first version of the trigger logic only did step 2. If the issue's
_current_ labels resolved to a valid repo and skill, the dispatcher ran,
whatever caused the webhook. Trigger labels stay on the issue after a run
finishes, because nothing removes them. So the dispatcher's own progress
comment bumped `updatedAt`, the issue still passed label validation, and
another run started: run, comment, webhook, run, and so on. Each loop was a
real Claude run, so the loop was unbounded, unattended cost, not just log noise.

The first fix required `labelChange.added` to be non-empty. That went too
far. It also blocked legitimate re-triggers unrelated to labels, such as
assigning the dispatcher's OAuth agent as delegate.

### Why routing needed a real config

Before `routing.config.json` existed, every issue went to one hardcoded repo
path. There was no way to run different skills against different codebases.

## Decision

### Stage 1: Should this dispatch at all

Use Linear's `updatedFrom` field generically instead of special-casing
labels. `updatedFrom` appears on `update` webhooks only. It holds the previous
value of every field that changed in that delivery, and nothing else. If
`updatedFrom` contains _only_ `updatedAt`, no real issue field changed.
Something touched the timestamp as a side effect, and in practice that
something is a posted comment.

The webhook parser (`packages/webhook-verify/src/linear/index.ts`) exposes
`changedFields`: the `updatedFrom` keys minus `updatedAt`. The rules live in
`shouldTriggerDispatch(event)` in that file. `LinearDispatchAdapter.shouldDispatch()`
(`services/dispatcher-service/src/pipeline/dispatcher/linear-dispatch.adapter.ts`)
applies the same rules, plus the `skipDoneIssues` policy below:

1. `AgentSession` events (`action: 'created'` or `'prompted'`) always
   dispatch. A person assigning the agent to a new session, or sending a
   follow-up message in an existing session, is itself the trigger,
   whatever the labels say. `AgentSession` events use a different webhook
   envelope from `Issue` events (`type: 'AgentSessionEvent'`, not the classic
   `{webhookId, data}` shape). That envelope carries no `labels` or
   `issueIdentifier`. See "AgentSession Label Resolution" below for how these
   events still route to a repo and skill.
2. Issue `create` events always dispatch. A create event has no `updatedFrom`,
   so there is nothing to compare, and the initial labels are not a "change"
   to react to.
3. Issue `update` events dispatch if `changedFields` is non-empty, meaning
   some real field changed, of any kind. Stage 2 still decides separately
   whether the issue's labels route anywhere. Delegate assignment is an
   `Issue` `update` with `changedFields: ['delegateId']`. It takes this path,
   not the `AgentSession` path in rule 1.
4. Anything else does not dispatch.

Stage 1 only answers "is there a reason to look at this webhook at all." It
does not decide where the webhook goes. Stage 2 does that.

### Stage 2: Where the webhook routes

Use Linear issue labels for routing:

- **Domain labels** map to repositories via `routing.config.json`. A repo's
  label is its folder name unless the entry sets `label`.
- **Mode labels** `agent-<name>` run the Claude skill `/<name>` in that repo.
  Only skills listed in `skills` can run. The top-level `skills` list applies
  to every repo, and a repo's own `skills` list adds to it. Nothing is exposed
  by default, so a label on a Linear issue can never launch a skill the
  operator did not list.
- `issueLabelToSkill` on a repo maps a label to a differently named skill
  (`"agent-build": "implement"`).
- Label names are lookup keys. The dispatcher does no string parsing.

Store routing configuration in `routing.config.json`. The file is gitignored
because each deployment has its own local repo paths.
`routing.config.example.json` is the checked-in template. A repo is just a
path unless something needs overriding:

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

A zod schema (`routing-schema.ts`) validates the file. Startup rejects
unknown keys, bad labels and duplicate repo labels, and names the offending
path. The `pnpm routes` commands manage the config:

- `pnpm routes` prints the repo, label and skill table, with a ✓ or ✗ for
  each skill on disk.
- `pnpm routes check` prints the same table and exits non-zero on a problem.
- `pnpm routes add <path>` registers a repo.
- `pnpm routes schema` rewrites `routing.config.schema.json`.

The earlier format, with a per-repo `issueLabelToSkill` map and no `skills`
list, still loads. On its own, that format exposes only the mappings it names.

The top-level `policy` block is optional, and each field has a default. The
block decides _whether_ a dispatch happens, on top of Stage 1. See "Dispatch
Policy" under Implementation Details.

`LinearDispatchAdapter.resolveRouting()` takes the issue's labels and does
three things:

1. Match the labels against the repo labels in the config. Exactly one domain
   label must match. Zero or several matches is a validation error. There is
   no default repo to fall back to.
2. Find the mode label among the issue's remaining (non-domain) labels. Exactly
   one must match the repo's exposed mode labels. Zero or several matches is a
   validation error.
3. Return the repo path and the skill. The executor then runs that Claude skill
   in the repo directory.

The dispatcher tells the user about a validation error with a comment on the
issue (or an activity in the agent session). One case is silent: when a label
is simply missing (an issue still being triaged), the dispatcher posts nothing
and skips the webhook. Conflicting labels always get feedback.

### AgentSession Label Resolution

`AgentSession` webhooks (`parseAgentSessionWebhook`) hardcode `labels: []`
and `issueIdentifier: ''`, because Linear's agent-session envelope does not
include either. Left alone, every `AgentSession` dispatch would fail Stage 2
with zero domain labels.

`DispatcherService` fixes this by calling `resolveIssueContext(issueId, webhookLabels)`
before it resolves routing. The real implementation is on `LinearGraphQLClient`
(`packages/linear-client`). If the webhook supplies fewer than
`MIN_LABEL_COUNT_FOR_FALLBACK` (2) labels, the client fetches the issue's real
labels and identifier from the Linear API. If that fetch fails, it falls back to
the webhook labels, so an API outage does not block routing.

Without a Linear API key, the dispatcher uses `NullIssueContextResolver`, which
returns the webhook labels unchanged. `AgentSession` dispatches then always
fail label validation.

## Consequences

**Advantages:**

- The comment-triggered feedback loop stops. A comment-only update has
  `changedFields: []`.
- Every other legitimate trigger works again (delegate assignment, state
  changes, any field edit) without a list of fields. The Stage 1 check asks
  _whether something changed_, not _which field_.
- Stage 1 needs no new infrastructure. It reads a field Linear already sends,
  with no actor or bot-identity lookup, no extra API calls and no cached
  state. The webhook parser stays "mildly dumb": it reports what changed and
  leaves the decision to the caller.
- Stage 2 looks labels up by key, which avoids typos and parsing errors. Labels
  are visible in the Linear UI, so they leave a clear audit trail. The routing
  config is a file instead of environment variables. Each repo defines its own
  modes, so the setup scales to any number of repos and skills.
- There is no silent default. A missing or ambiguous label fails loudly with a
  comment on the issue, and a webhook that should not dispatch is dropped
  rather than routed somewhere unintended.

**Disadvantages:**

- A human who edits an _unrelated_ field (such as fixing a typo in the
  description) on an issue that still carries valid trigger labels will start
  another run, because `changedFields` does not tell relevant fields from
  irrelevant ones. We accept this. We have no evidence it happens often, and
  an allowlist of counting fields would bring back the same enumeration
  problem that broke delegate assignment the first time.
- Teams must remember to label issues with repo names, and each deployment
  needs its own `routing.config.json`.

**Mitigation:**

- Use Linear automations to add repo labels by default.
- Preflight validation fails startup on missing repo paths and skills (see
  "Preflight Validation"). The operator sees the problem at boot, before the
  first webhook arrives.

## Alternatives Considered

**Trigger semantics (Stage 1):**

| Approach                                                                      | Rejected because                                                                                                                                                                                        |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Require `labelChange.added` non-empty (first attempt)                         | Went too far: blocked delegate assignment and any other legitimate non-label trigger; see Context                                                                                                       |
| Track the webhook actor and skip self-authored updates                        | The dispatcher would need to know its own bot/OAuth user identity (a lookup plus a cache). That is dispatcher-specific config, and does not belong in the generic webhook-parsing layer the relay shares |
| Time-based debounce (ignore updates within N seconds of our own last comment) | Cannot tell cause from coincidence: a real human edit seconds after a bot comment would also be dropped. It swaps a structural rule for a timing-dependent failure                                      |

**Routing (Stage 2):**

| Approach             | Rejected Because                                          |
| -------------------- | --------------------------------------------------------- |
| **Linear Projects**  | Multiple projects per repo; hierarchy too complex         |
| **Issue Assignee**   | Unreliable; people work across multiple repos             |
| **Custom Fields**    | Requires API setup per workspace                          |
| **Monorepo Subdirs** | Breaks multi-repo setups; couples dispatcher to structure |
| **Default-Only**     | Doesn't support multi-repo use case                       |

## Implementation Details

- `RoutingConfigService` loads `routing.config.json` on startup and validates
  its structure against the zod schema. It fails fast on a missing or
  malformed `repositories` list, duplicate labels, an invalid label or skill
  name, unknown keys and a malformed `policy`. It does **not** check that repo
  paths or skills exist on disk. The preflight step below does that.
- The run store allows one active run per issue. `enqueueRun` throws
  `ActiveRunError` if the issue already has a `running` run, and the
  dispatcher posts feedback saying why nothing started. Runs on different
  issues in the same repo are not serialized by the routing layer.

### Preflight Validation

Some config loads fine but points at something broken: a repo path that does
not exist, or a listed skill the repo does not have. Without a startup check,
that mistake would surface only on the _first webhook_ for the repo. Because
runs are unattended, the run could also silently do nothing.
`PreflightService` runs on dispatcher startup (unless `PREFLIGHT_SKIP=1`) and
checks:

1. The `claude` binary exists (`which <claudeBinPath>`) — **error**
2. For each configured repo, the repo path exists on disk — **error**
3. For each configured repo, at least one skill is exposed — **error**
4. For each exposed skill and each `issueLabelToSkill` target, the skill
   resolves to `.claude/skills/<name>/SKILL.md` or `.claude/commands/<name>.md`
   in the repo or in the user's `~/.claude` — **error**. Plugin skills
   (`plugin:skill`) cannot be checked on disk, so preflight skips them.
5. A Linear API key is configured — logged if present, otherwise a
   **warning** (activity posting is skipped without a key)

Any error fails startup, and the log lists every problem together. This
changes the original stance, where only the binary check failed startup. A
broken repo used to affect only its own webhooks. But a mapping that points at
nothing is a mistake the operator can fix in seconds, and finding it at boot
beats finding it in a Linear comment. `pnpm routes check` runs the same path
and skill check without starting the dispatcher.

`PreflightService implements OnModuleInit` and is self-contained within
`PreflightModule`. No other module orchestrates it.

### Dispatch Policy

The `policy` block in `routing.config.json` decides whether a dispatch
happens at all, on top of Stage 1:

- `skipDoneIssues` (default `false`): when `true`, an `Issue` event whose
  current Linear state is Completed or Canceled never dispatches, even if a
  trigger label was added in the same webhook. `AgentSession` events are not
  affected.
- `duplicateRunWindowMs` (default `60000`): the minimum time between two runs
  for the same (issue, domain, skill) combination. A new run inside the window
  is rejected as a duplicate. This guards against the relay redelivering the
  same event twice (for example through overlapping subscriber registrations).

`RoutingConfigService` validates both at startup. An invalid value fails fast,
the same as an invalid `repositories` entry.

## References

- [ADR 0001: Relay Service Architecture](0001-relay-service-architecture.md) — Multi-team dispatch context
- [ADR 0003: Webhook Routing and Delivery](0003-webhook-routing-and-delivery.md) — Domain-based routing at relay level, upstream of this dispatcher-side decision
- `packages/webhook-verify/src/linear/tests/index.spec.ts` — test fixtures built from real captured payloads (label removal, delegate assignment) confirming `changedFields` derivation
