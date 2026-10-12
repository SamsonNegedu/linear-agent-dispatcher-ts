# Linear Dispatcher

Automatically run Claude on Linear issues assigned to you — no manual prompts, full audit trail.

A local relay receives Linear's webhooks and fans them out to local dispatchers (NestJS), which run Claude in your repos. Everything runs on your machine; state lives in SQLite files.

## Key Features

- **Skills as the interface** — a Linear label `agent-<name>` runs the repo's `/<name>` skill, only for skills you list
- **Webhook relay** — one Linear OAuth app, events routed by team and assignee, signed per subscriber (HMAC-SHA256)
- **Unattended runs** — headless Claude with a controlled tool set; a run that must ask a question stops and posts it to the issue
- **Monitor TUI** — runs, logs, relay status and repo/skill mappings in the terminal

## Getting Started

**Prerequisites:** Node.js 24+, pnpm 9+, Bun (for the monitor TUI), a Linear OAuth app, the Claude CLI, and Tailscale (recommended) or `cloudflared` to expose the relay

```bash
pnpm install
pnpm dev:up      # tunnel + relay + Linear connect + dispatcher + monitor TUI
```

→ See [GETTING_STARTED.md](services/dispatcher-service/GETTING_STARTED.md) for the full step-by-step setup, environment variables, testing and troubleshooting.

## Architecture

```
Linear webhook → Relay (local, behind a tunnel) → HTTP POST → Dispatcher → Claude CLI → Linear API
```

Every dispatcher sits behind a relay. `pnpm dev:up` starts both on your machine. See [docs/adr](docs/adr/README.md) for the reasoning.

## Relay Service API

| Method  | Endpoint                  | Purpose                                                                        |
| ------- | ------------------------- | ------------------------------------------------------------------------------ |
| `GET`   | `/subscribers/auth/start` | Start OAuth authorization flow                                                 |
| `GET`   | `/callback`               | OAuth callback (registers all of the user's teams)                             |
| `GET`   | `/subscribers/:id`        | Does this subscriber still exist? (no secret or endpoint returned)             |
| `PATCH` | `/subscribers`            | Move a subscription to a new endpoint (needs the subscriber id **and** secret) |
| `POST`  | `/webhooks/linear`        | Receive webhooks from Linear                                                   |

See the [relay README](services/relay-service/README.md) for details.

## CLI Commands

| Command                             | Purpose                                                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `pnpm dev:up`                       | One command for local dev: tunnel, relay, Linear connect, dispatcher and TUI (`-- --reconnect` re-authorizes)  |
| `pnpm routes`                       | Show repo → label → skill mappings (`routes check` exits 1 on a problem, `routes add <path>` registers a repo) |
| `pnpm connect-relay`                | Register a dispatcher with a relay by hand (OAuth flow); `dev:up` does this for you locally                    |
| `pnpm update-relay`                 | Move dispatcher to new server (update endpoint without re-auth)                                                |
| `pnpm test-webhook`                 | Test dispatch without a Linear issue                                                                           |
| `pnpm dev`                          | Start relay and dispatcher without the tunnel or TUI                                                           |
| `pnpm lint` / `pnpm lint:fix`       | [oxlint](https://oxc.rs/docs/guide/usage/linter)                                                               |
| `pnpm format` / `pnpm format:check` | [oxfmt](https://oxc.rs/docs/guide/usage/formatter)                                                             |

## Monitor TUI

A terminal dashboard (`packages/monitor-tui`, built with Bun + React + [OpenTUI](https://github.com/anomalyco/opentui)) with four views: **Overview** (run counts, relay status, each repo's label → skill with ✓/✗), **Runs** (every run, filterable, with a detail pane showing the full title, error or question), **Logs** (colored by level, filterable, follow or pause) and **Relay** (connection and credentials). It adapts to the terminal width.

`pnpm dev:up` opens it automatically; `cd services/dispatcher-service && pnpm monitor` starts it against a dispatcher it launches itself.

| Key                     | Action                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `1`–`4`, `Tab`, `←` `→` | Switch view                                                                              |
| `↑` `↓` (or `j` `k`)    | Runs: select a run · Logs: scroll                                                        |
| `⏎` / `Esc`             | Runs: open / close the detail pane                                                       |
| `f`                     | Runs: cycle the filter (All, Active, Needs input, Failed, Done) · Logs: follow           |
| `l`                     | Logs: cycle the level (All, Warnings+, Errors)                                           |
| `c` / `u`               | Relay: connect / update endpoint                                                         |
| `y`                     | Copy the selection, or the open run / current view, to the system clipboard              |
| `m`                     | Toggle mouse capture (off lets the terminal select text; on gives wheel scroll)          |
| `Ctrl+R`                | Restart the dispatcher server in place (only when started via `pnpm monitor` / `dev:up`) |
| `q` / `Ctrl+C`          | Quit                                                                                     |

## Security

- Webhooks from Linear are verified (HMAC-SHA256); relay → dispatcher deliveries are signed per subscriber.
- Subscriber changes need the subscriber's secret, and delivery URLs must be public `https://` addresses (private, loopback and cloud-metadata addresses are rejected).
- `.env.local` files are created readable only by you (mode `0600`).
- **Audit trail**: all deliveries are logged for 30 days.

## Development

```bash
pnpm install          # Install all workspaces
pnpm build            # Build all packages
pnpm test             # Run tests
pnpm lint             # oxlint
pnpm format           # oxfmt
```

## Directory Structure

```
linear-agent-ts/
├── packages/                  # Shared packages: linear-client, webhook-verify, env-file, monitor-tui
├── scripts/                   # dev-up.mjs (one-command startup), lib/stack.mjs, lib/tunnel.mjs
├── services/
│   ├── dispatcher-service/    # NestJS app: receives deliveries and runs Claude
│   └── relay-service/         # NestJS app: Linear OAuth + webhook fan-out (SQLite)
└── docs/adr/                  # Architecture decision records
```
