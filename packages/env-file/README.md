# @linear-agent/env-file

Read and update `.env` files safely. Used by `connect-relay`, `update-relay` and `scripts/dev-up.mjs`.

- `parseEnv(text)` — handles `export`, quotes, `=` inside values and inline comments.
- `upsertEnvVar(text, key, value)` — replaces the assignment, uncomments a `# KEY=` placeholder, or appends; values are quoted only when needed.
- `readEnvFile(path)` / `updateEnvFile(path, vars)` / `writeEnvFile(path, text)` — files are written readable by the owner only (`0600`) through a temp file and rename, since they hold secrets.

```bash
pnpm --filter @linear-agent/env-file build && pnpm --filter @linear-agent/env-file test
```
