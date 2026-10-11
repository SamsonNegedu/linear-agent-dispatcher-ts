# Linear Dispatcher

Automatically run Claude on Linear issues assigned to you — no manual prompts, full audit trail.

A production-grade NestJS/AWS serverless dispatcher that routes Linear webhooks to Claude, with portable data layer (SQL/DynamoDB) and optional team-shared relay.

## Key Features

- **Portable data layer** — SQL (SQLite/PostgreSQL) or DynamoDB, config-based switching
- **Webhook relay** — One relay subscription for the whole team; events routed by Linear user assignment, secured with Linear OAuth and HMAC signatures
- **Local & team modes** — run solo with a local relay, or share one relay deployment across a team

## Getting Started

**Prerequisites:** Node.js 24+, pnpm 9+, Docker, Bun (for the monitor TUI), a Linear OAuth app, the Claude CLI

```bash
pnpm install
pnpm dev:up      # DynamoDB Local + tunnel + relay + Linear connect + dispatcher + monitor TUI
```

→ See [GETTING_STARTED.md](services/dispatcher-service/GETTING_STARTED.md) for the full step-by-step setup, environment variables, testing, deployment, and troubleshooting.

## Architecture

```
Linear webhook → Relay (local or AWS Lambda) → HTTP POST → Dispatcher → Claude CLI → Linear API
```

Every dispatcher sits behind a relay. The difference between solo dev and team deployment is only whether the relay runs locally or in AWS.

## Relay Service API

| Method  | Endpoint                  | Purpose                                          |
| ------- | ------------------------- | ------------------------------------------------ |
| `GET`   | `/subscribers/auth/start` | Start OAuth authorization flow                   |
| `GET`   | `/callback`               | OAuth callback (auto-registers all user's teams) |
| `POST`  | `/subscribers/register`   | Manual subscriber registration                   |
| `PATCH` | `/subscribers`            | Update existing subscription endpoint            |
| `POST`  | `/webhooks/linear`        | Receive webhooks from Linear                     |

**See [GETTING_STARTED.md](services/dispatcher-service/GETTING_STARTED.md) for full endpoint documentation and examples.**

## CLI Commands

| Command                             | Purpose                                                                                                              |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev:up`                       | One command for local dev: infra, tunnel, relay, Linear connect, dispatcher and TUI (`-- --reconnect` re-authorizes) |
| `pnpm routes`                       | Show repo → label → skill mappings (`routes check` exits 1 on a problem, `routes add <path>` registers a repo)       |
| `pnpm connect-relay`                | Register a dispatcher with a shared relay (OAuth flow); `dev:up` does this for you locally                           |
| `pnpm update-relay`                 | Move dispatcher to new server (update endpoint without re-auth)                                                      |
| `pnpm test-webhook`                 | Test dispatch without a Linear issue                                                                                 |
| `pnpm dev`                          | Start relay and dispatcher without the tunnel or TUI                                                                 |
| `pnpm lint` / `pnpm lint:fix`       | [oxlint](https://oxc.rs/docs/guide/usage/linter)                                                                     |
| `pnpm format` / `pnpm format:check` | [oxfmt](https://oxc.rs/docs/guide/usage/formatter)                                                                   |

## Monitor TUI

A terminal dashboard (`packages/monitor-tui`, built with Bun + React + [OpenTUI](https://github.com/anomalyco/opentui)) for watching dispatcher runs — dashboard (repos, label → skill with ✓/✗), live logs, relay connection management, and run tabs: active/queued, **needs input** (the agent stopped to ask), completed and failed.

`pnpm dev:up` opens it automatically; `cd services/dispatcher-service && pnpm monitor` starts it against a dispatcher it launches itself.

| Key            | Action                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------- |
| `↑↓` / `1`–`7` | Switch tab                                                                               |
| `y`            | Copy the selection, or the current tab, to the system clipboard                          |
| `m`            | Toggle mouse capture (off lets the terminal select text; on gives wheel scrolling)       |
| `Ctrl+R`       | Restart the dispatcher server in place (only when started via `pnpm monitor` / `dev:up`) |
| `q` / `Ctrl+C` | Quit                                                                                     |

## Security

Webhook verification (HMAC-SHA256) and relay authentication (Linear OAuth) are covered above. Beyond that:

- **Audit trail**: All deliveries logged with 30-day retention (TTL)
- **Safe by default**: Admin API disabled unless `ADMIN_API_TOKEN` is set

## Admin API

Optional programmatic access to subscriber and delivery logs (requires `ADMIN_API_TOKEN` env var):

```bash
GET  /admin/subscribers?teamKey=<key>          # List subscribers
DELETE /admin/subscribers/:subscriberId        # Revoke subscriber
GET  /admin/deliveries?teamKey=<key>&limit=50 # View delivery history
```

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
├── sst.config.ts              # Infrastructure as code (SST v2)
├── packages/                  # Shared workspace packages (api-gateway, linear-client,
│                               #   dynamodb-client, webhook-verify, env-file, monitor-tui, ...)
├── scripts/                   # dev-up.mjs (one-command startup) and lib/stack.mjs
├── docker-compose.yml         # DynamoDB Local + Cloudflare tunnel profiles for dev:up
├── services/
│   ├── dispatcher-service/    # NestJS app: local dispatcher
│   └── relay-service/         # Lambda handlers: serverless webhook relay
└── infra/                     # SST stack definitions
```
