# Linear Dispatcher

Automatically run Claude on Linear issues assigned to you — no manual prompts, full audit trail.

A local relay receives Linear's webhooks and passes them to local dispatchers (NestJS), which run Claude in your repos. Everything runs on your machine; state lives in SQLite files.

```
Linear webhook → Relay (local, behind a tunnel) → Dispatcher → Claude CLI → Linear API
```

## How it works

- A Linear label `agent-<name>` runs the repo's `/<name>` skill, only for skills you list.
- Runs are headless. If Claude needs to ask something, it stops and posts the question to the issue.
- Webhooks are verified (HMAC-SHA256) and relay → dispatcher deliveries are signed per subscriber.

## Getting Started

**Prerequisites:** Node.js 24+, pnpm 9+, Bun (monitor TUI), a Linear OAuth app, the Claude CLI, and Tailscale (recommended) or `cloudflared` for the tunnel.

```bash
pnpm install
pnpm dev:up      # tunnel + relay + Linear connect + dispatcher + monitor TUI
```

Full setup, environment variables and troubleshooting: [GETTING_STARTED.md](services/dispatcher-service/GETTING_STARTED.md).

## Commands

| Command                 | Purpose                                                    |
| ----------------------- | ---------------------------------------------------------- |
| `pnpm dev:up`           | Start everything (`-- --reconnect` re-authorizes)          |
| `pnpm dev`              | Relay and dispatcher only                                  |
| `pnpm routes`           | Show repo → label → skill mappings (`routes add <path>`)   |
| `pnpm test-webhook`     | Test dispatch without a Linear issue                       |
| `pnpm build` / `test`   | Build / test all packages                                  |
| `pnpm lint` / `format`  | oxlint / oxfmt                                             |

## More

- [Relay API](services/relay-service/README.md)
- [Architecture decisions](docs/adr/README.md)
