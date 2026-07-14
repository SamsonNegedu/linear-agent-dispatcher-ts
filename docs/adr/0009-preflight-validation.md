# ADR 0009: Preflight Validation on Dispatcher Startup

**Status:** Accepted

**Date:** 2026-07-12

## Context

The dispatcher must execute claude handlers against local repositories, each with repo-specific `.claude/` configuration. On startup, we need to verify:

1. The claude binary is installed and accessible
2. Each configured repository path exists
3. Each repository has the required `.claude/settings.json` configuration
4. (Optional) Each repository has `.mcp.json` for MCP server configuration

Without these checks, errors surface only when processing the first webhook, delaying feedback and wasting cycles.

## Decision

On startup, unless `PREFLIGHT_SKIP=1` is set, run validation checks:

### Checks performed

1. **Claude binary exists**: Execute `claude --help` to verify installation
   - Uses `claudeBinPath` from config
   - Fails fast if binary not found or not executable

2. **Default repo path exists**: Verify `DISPATCHER_REPO_PATH` exists on disk
   - Catches misconfigured base repository paths

3. **All mapped repo paths exist**: For each repo in `REPO_MAPPING`, verify path exists
   - Catches typos or missing directories

4. **`.claude/settings.json` present** (warn if missing):
   - Expected at `<repo>/.claude/settings.json`
   - Warning only (non-fatal) — allows graceful degradation
   - Skills defined here are discovered by claude CLI at runtime

5. **`.mcp.json` present** (warn if missing):
   - Optional but useful for MCP server configuration
   - Warning only — not critical

### Output

```
2026-07-12T10:30:45.123Z [Preflight] Running preflight validation...
2026-07-12T10:30:45.234Z [Preflight] ✓ claude binary available: claude
2026-07-12T10:30:45.245Z [Preflight] ✓ Repository path exists: .
2026-07-12T10:30:45.256Z [Preflight] ✓ Repository path exists (backend): ./services/backend
2026-07-12T10:30:45.267Z [Preflight] ✓ .claude/settings.json found (backend)
2026-07-12T10:30:45.278Z [Preflight] ⚠ .mcp.json not found (backend) at ./services/backend/.mcp.json (optional, but useful for MCP servers)
2026-07-12T10:30:45.289Z [Preflight] Preflight validation complete
```

## Consequences

### Advantages

- **Fail fast**: Catch configuration errors on startup, not at first webhook
- **Clear diagnostics**: Logs show exactly what's misconfigured
- **Graceful degradation**: Warnings allow partial functionality (e.g., missing .mcp.json)

### Disadvantages

- **Startup delay**: Adds brief validation step (negligible for local/Lambda)
- **Requires .claude/ structure**: Repos must follow expected layout

### Mitigation

- Add `PREFLIGHT_SKIP=1` for testing/development if needed
- Provide clear error messages with remediation steps
- Link to `templates/repo/` documentation

## Implementation

- Created `PreflightService` with `validate()` method
- Called from `ExecutorModule.onModuleInit()` (runs after all dependencies ready)
- Checks happen before first webhook can be received
- Can be skipped with environment variable for testing

## Testing

- [ ] Missing claude binary throws startup error
- [ ] Missing repo path throws startup error
- [ ] Missing .claude/settings.json shows warning but continues
- [ ] Missing .mcp.json shows warning but continues
- [ ] PREFLIGHT_SKIP=1 skips all validation
- [ ] Startup logs show all checks passed

## References

- **Related**: [ADR 0008: Label-Based Repository Routing](0008-label-based-repo-routing.md) — Defines repository configuration structure
- **Depends on**: `.claude/` directory structure in repos (see `templates/repo/`)
