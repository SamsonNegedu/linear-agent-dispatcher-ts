# ADR 0008: Label-Based Repository Routing and Skill Selection in Dispatcher

**Status:** Accepted

**Date:** 2026-07-12

**Updated:** 2026-07-12 (added mode-based skill routing per ADR 0003)

## Context

When a Linear webhook arrives at the dispatcher, we need to determine:

1. **Which repository** to run Claude in (domain routing)
2. **Which Claude skill** to invoke (mode routing)

This is critical because:

1. **Multi-repo teams**: A Linear team often manages multiple repositories (backend, frontend, infra, ML, etc.)
2. **Repo-specific context**: Different repos have different dependencies, file structures, and available Claude skills
3. **Skill selection**: Different issues need different Claude modes (implement, plan, resume)
4. **Issue-to-repo mapping**: Linear doesn't have a native "repo" field, so we need a convention to route issues

Without explicit routing:

- All handlers run in the same fixed repository (current state: `DISPATCHER_REPO_PATH`)
- All handlers invoke the same skill (no mode selection)
- Multi-repo teams can't use the dispatcher effectively
- Issues for different repos collide

## Decision

**Use Linear labels for two-tier routing:**

1. **Domain labels** (e.g., `backend`, `frontend`) → repository path
2. **Mode labels** (e.g., `agent-implement`, `agent-plan`) → Claude skill name

**Label names are keys** — Direct mapping, no string parsing.

### Routing Algorithm

**Domain Routing (Repository Selection):**

1. Extract labels from the Linear issue
2. Check if any label is a domain key in `repos.config.json`
3. If found, use that repo path
4. If not found, fall back to the default `DISPATCHER_REPO_PATH`

**Mode Routing (Skill Selection):**

1. Extract labels from the Linear issue
2. Find labels matching the pattern `agent-*` (e.g., `agent-implement`, `agent-plan`)
3. Look up the mode in the resolved repo's `modes` mapping in repos.config.json
4. Resolve to Claude `/skill` name (e.g., `agent-implement` → `/linear-implement`)
5. If no mode label found or mode not configured, default to `/linear-implement`
6. Executor invokes: `claude -p /<skill> ISSUE-ID --output-format json`

### Configuration

Store repo mapping and mode mappings in `repos.config.json` (checked into git):

```json
{
  "repositories": [
    {
      "label": "backend",
      "path": "./services/backend",
      "description": "Backend service repository",
      "modes": {
        "agent-implement": "linear-implement",
        "agent-plan": "linear-plan",
        "agent-resume": "linear-resume"
      }
    },
    {
      "label": "frontend",
      "path": "./services/frontend",
      "description": "Frontend React application",
      "modes": {
        "agent-implement": "linear-implement",
        "agent-plan": "linear-plan",
        "agent-resume": "linear-resume"
      }
    },
    {
      "label": "infra",
      "path": "./infra",
      "description": "Infrastructure and deployment",
      "modes": {
        "agent-implement": "linear-implement",
        "agent-plan": "linear-plan",
        "agent-resume": "linear-resume"
      }
    }
  ]
}
```

Each `modes` entry maps a **Linear mode label** (e.g., `agent-implement`) to a **Claude `/skill` name** (e.g., `linear-implement`).
The dispatcher will invoke: `claude -p /linear-implement ISSUE-123 --output-format json`

Each skill name must be defined in the repo's `.claude/settings.json` under `skills`.

This approach has clear advantages over environment variables:

- Version controlled and auditable
- Human readable with descriptions
- Validated at startup (fail fast)
- Easy to add/remove repos without changing env vars
- Catches typos and invalid paths immediately

### Example Workflow

1. **Issue created in Linear**: "Refactor auth module"
   - Team: ACME
   - Labels: `backend`, `agent-implement`, `feature:auth`, `priority:high`

2. **Webhook arrives at dispatcher**:
   - Extract issue labels: `["backend", "agent-implement", "feature:auth", "priority:high"]`

   **Domain Routing:**
   - Check each label against repos.config.json keys
   - Find `backend` → matches domain key
   - Look up value → `./services/backend`

   **Mode Routing:**
   - Filter for `agent-*` labels → find `agent-implement`
   - Look up in backend's modes: `agent-implement` → `linear-implement`

3. **Handler executes** (mode mapped to `/skill`):

   ```
   cd ./services/backend
   # agent-implement mode → /linear-implement Claude skill
   claude -p /linear-implement ISSUE-123 --output-format json
   ```

   (The `/linear-implement` skill must be defined in `./services/backend/.claude/settings.json`)

4. **Results posted back to Linear** with repo and skill context in the comment

## Consequences

### Advantages

- **Two-tier routing**: Domain labels route to repos, mode labels select skills
- **Simple and direct**: Label names ARE keys, no parsing or conventions
- **Explicit and discoverable**: Labels are visible in Linear UI
- **Per-repo flexibility**: Each repo defines its own available modes
- **Fallback safety**: Default mode ensures handlers work if mode label missing
- **Scalable**: Handles teams with 2+ repos and 3+ skills without code changes
- **Visible audit trail**: Issue history shows which repo and skill were targeted
- **No naming errors**: Direct key lookup prevents typos

### Disadvantages

- **Configuration overhead**: Need to set up REPO_MAPPING per deployment
- **Label discipline**: Teams must remember to label issues with repo names

### Mitigation

- Document repo labels in team handbook/REPO_MAPPING examples
- Preflight validation warns if `.claude/settings.json` missing from mapped repos
- Encourage teams to add a standard repo label to all their issues (can use Linear automations)
- Fallback to DISPATCHER_REPO_PATH if no label matches

## Alternatives Considered

### 1. **Linear Projects → Repos** (Rejected)

- Each Linear project maps to one repo
- Problem: Teams often have multiple projects per repo (e.g., "Backend Q3", "Backend Q4")
- Problem: Requires complex project hierarchy

### 2. **Issue Assignee → Repo** (Rejected)

- Infer repo from who's assigned
- Problem: Not reliable; same person works on multiple repos
- Problem: No audit trail

### 3. **Linear Custom Fields → Repos** (Deferred)

- Add a custom field "repository" to issues
- Advantage: Explicit, native Linear feature
- Disadvantage: Requires API setup per workspace; linear-agent can't control this
- Decision: Implement labels first, migrate to custom fields if needed

### 4. **Monorepo Root + Paths** (Rejected)

- Store a single monorepo root; issues specify subdirectory
- Problem: Couples dispatcher to monorepo structure
- Problem: Doesn't work for multi-repo setups (separate repos on disk)

### 5. **Default-Only, No Routing** (Rejected)

- Keep single `DISPATCHER_REPO_PATH` for simplicity
- Problem: Doesn't solve multi-repo case
- Problem: Future teams will request this feature anyway

### 6. **Skill-per-repo config** (Revised)

- Initial approach: Centralized skill registry mapping repos to skill definitions
- Issue: Skills should be discovered from repo's `.claude/settings.json`, not centrally managed
- Revised: Dispatcher routes to repo, claude CLI discovers skills from repo's config
- Benefits: Repos manage their own skills, no central skill registry needed

## Implementation

### 1. Update `config.ts`

```typescript
interface DispatcherConfig {
  executor: {
    repoPath: string; // Default fallback
    repoMapping: Record<string, string>; // label → path mapping
  };
}
```

### 2. Add `resolveRepoPath()` in `dispatcher.service.ts`

```typescript
private resolveRepoPath(labels: string[]): string {
  // Check if any label is a key in REPO_MAPPING
  for (const label of labels) {
    if (label in this.config.executor.repoMapping) {
      const repoPath = this.config.executor.repoMapping[label];
      this.logger.log(`Routing via label '${label}' → ${repoPath}`);
      return repoPath;
    }
  }
  return this.config.executor.repoPath;
}
```

### 3. Call in `dispatchWebhook()`

```typescript
const repoPath = this.resolveRepoPath(event.labels || []);

const run = await this.store.enqueueRun({
  // ...
  repoPath, // Routes to repo-specific path
  skill: 'claude-agent', // Default skill; claude CLI will discover from .claude/settings.json
  // ...
});
```

### 4. Create `repos.config.json` at project root

Checked into git, provides single source of truth for repo routing:

```json
{
  "repositories": [
    { "label": "backend", "path": "./services/backend" },
    { "label": "frontend", "path": "./services/frontend" },
    { "label": "infra", "path": "./infra" }
  ]
}
```

### 5. ReposConfigService loads and validates on startup

- Parses `repos.config.json`
- Validates all paths exist
- Validates label uniqueness
- Throws error if invalid (fail fast)

### 6. Per-repo mutex

ExecutorService maintains a `Map<repoPath, Promise>` to serialize runs per repo:

- Only one claude handler runs per repo at a time
- Multiple issues on same repo queue serially
- Prevents lock contention and resource exhaustion

## Testing

- [ ] Issue with `repo:backend` label routes to backend path
- [ ] Issue without `repo:*` label uses fallback path
- [ ] Invalid repo label (not in mapping) warns and uses fallback
- [ ] Multiple repo labels use first matching one
- [ ] Handler runs in correct working directory (verify with `pwd` output)

## References

- **Related**: [ADR 0001: Relay Service Architecture](0001-relay-service-architecture.md) — Sets context for multi-team dispatch
- **Related**: [ADR 0004: Webhook Routing and Delivery](0004-webhook-routing-and-delivery.md) — Domain-based routing at relay level; this ADR extends to repo level at dispatcher
- **Depends on**: Schema should include issue labels in webhook event

## Future Enhancements

1. **Linear Custom Fields**: Migrate from labels to custom fields for more native UX
2. **Auto-discovery**: Scan Linear workspace for repos and auto-generate mapping
3. **Fallback chain**: Support repo hierarchy (if `repo:backend/auth` not found, try `repo:backend`)
4. **Per-issue overrides**: Allow issue description to override repo via comment (e.g., `@claude repo:other`)
