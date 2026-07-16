# ADR 0008: Label-Based Repository Routing and Skill Selection in Dispatcher

**Status:** Accepted

**Date:** 2026-07-12

## Context

The dispatcher receives Linear webhooks and must determine which repository to run Claude in and which skill to invoke. This is essential because:

- Teams manage multiple repositories (backend, frontend, infra, etc.)
- Different repos have different context and available skills
- Linear has no native "repo" field for routing
- Currently all issues route to a single `DISPATCHER_REPO_PATH`

## Decision

Use Linear issue labels for routing:
- **Domain labels** (e.g., `backend`, `frontend`) map to repository paths via `repos.config.json`
- **Mode labels** (e.g., `agent-implement`, `agent-plan`) map to Claude skills
- Label names are keys; no string parsing

Store routing configuration in `repos.config.json` (checked into git):

```json
{
  "repositories": [
    {
      "label": "backend",
      "path": "./services/backend",
      "modes": {
        "agent-implement": "linear-implement",
        "agent-plan": "linear-plan"
      }
    },
    {
      "label": "frontend",
      "path": "./services/frontend",
      "modes": {
        "agent-implement": "linear-implement"
      }
    }
  ]
}
```

When a webhook arrives:
1. Check issue labels against repository keys in config
2. Route to matching repo path (or fallback to `DISPATCHER_REPO_PATH`)
3. Find mode label in repo's modes mapping
4. Invoke corresponding Claude skill

## Consequences

**Advantages:**
- Direct key-based lookup prevents typos and parsing errors
- Labels visible in Linear UI provide clear audit trail
- Version-controlled config vs environment variables
- Each repo defines its own modes; scales to any number of repos/skills
- Fallback to `DISPATCHER_REPO_PATH` if no domain label matches

**Disadvantages:**
- Teams must remember to label issues with repo names
- Requires `repos.config.json` setup per deployment

**Mitigation:**
- Use Linear automations to add repo labels by default
- Preflight validation ensures config and paths are valid at startup

## Alternatives Considered

| Approach | Rejected Because |
|----------|------------------|
| **Linear Projects** | Multiple projects per repo; hierarchy too complex |
| **Issue Assignee** | Unreliable; people work across multiple repos |
| **Custom Fields** | Requires API setup per workspace |
| **Monorepo Subdirs** | Breaks multi-repo setups; couples dispatcher to structure |
| **Default-Only** | Doesn't support multi-repo use case |

## Implementation Details

- Load and validate `repos.config.json` on startup (fail fast on invalid paths or duplicate labels)
- In `dispatchWebhook()`: iterate issue labels, find first match in config, use that repo path
- If no domain label matches, fall back to `DISPATCHER_REPO_PATH`
- Find mode label in matched repo's modes mapping; error if zero or multiple matches
- Invoke mode's corresponding skill in the resolved repo directory
- ExecutorService uses per-repo mutex to serialize runs (only one handler per repo at a time)

## References

- [ADR 0001: Relay Service Architecture](0001-relay-service-architecture.md) — Multi-team dispatch context
- [ADR 0004: Webhook Routing and Delivery](0004-webhook-routing-and-delivery.md) — Domain-based routing at relay level
- Webhook schema must include issue labels
