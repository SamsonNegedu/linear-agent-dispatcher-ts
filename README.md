# Linear Dispatcher

Automatically run Claude on Linear issues assigned to you — no manual prompts, full audit trail.

A production-grade NestJS/AWS serverless dispatcher that routes Linear webhooks to Claude, with portable data layer (SQL/DynamoDB) and optional team-shared relay.

## Key Features

- **Portable data layer** — SQL (SQLite/PostgreSQL) or DynamoDB, config-based switching
- **Webhook relay** — One relay subscription for the whole team; events routed by Linear user assignment, secured with Linear OAuth and HMAC signatures
- **Local & team modes** — run solo with a local relay, or share one relay deployment across a team

## Quick Start

**Prerequisites:** Node.js 24+, pnpm 9+, Linear OAuth app, Claude CLI

**Get running in 3 commands:**

```bash
pnpm install
pnpm dev
cd services/dispatcher-service && pnpm connect-relay --relay-url=http://localhost:3001 --local-endpoint=http://localhost:3000
```

**For detailed step-by-step setup, environment variables, testing, deployment, and troubleshooting:**  
→ See [GETTING_STARTED.md](services/dispatcher-service/GETTING_STARTED.md)

## Architecture

```
Linear webhook → Relay (local or AWS Lambda) → HTTP POST → Dispatcher → Claude CLI → Linear API
```

Every dispatcher sits behind a relay. The difference between solo dev and team deployment is only whether the relay runs locally or in AWS.

## Relay Service API

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/subscribers/auth/start` | Start OAuth authorization flow |
| `GET` | `/callback` | OAuth callback (auto-registers all user's teams) |
| `POST` | `/subscribers/register` | Manual subscriber registration |
| `PATCH` | `/subscribers` | Update existing subscription endpoint |
| `POST` | `/webhooks/linear` | Receive webhooks from Linear |

**See [GETTING_STARTED.md](services/dispatcher-service/GETTING_STARTED.md) for full endpoint documentation and examples.**

## CLI Commands

| Command | Purpose |
|---------|---------|
| `pnpm connect-relay` | Initial setup: register dispatcher with relay (OAuth flow) |
| `pnpm update-relay` | Move dispatcher to new server (update endpoint without re-auth) |
| `pnpm test-webhook` | Test dispatch without a Linear issue |
| `pnpm dev` | Start both relay and dispatcher in dev mode |

## Monitor TUI

A terminal dashboard (`packages/monitor-tui`, built with Bun + React + [OpenTUI](https://github.com/anomalyco/opentui)) for watching dispatcher runs — active/queued/completed/failed tabs, live logs, and relay connection management.

```bash
cd packages/monitor-tui && bun start
```

## Security

Webhook verification (HMAC-SHA256) and relay authentication (Linear OAuth) are covered above. Beyond that:

- **Audit trail**: All deliveries logged with 30-day retention (TTL)
- **Safe by default**: Admin API disabled unless `ADMIN_API_TOKEN` is set

## Admin API

Optional programmatic access to subscriber and delivery logs (requires `ADMIN_API_TOKEN` env var):

```bash
GET  /admin/api/subscribers?teamKey=<key>          # List subscribers
DELETE /admin/api/subscribers/:subscriberId        # Revoke subscriber
GET  /admin/api/deliveries?teamKey=<key>&limit=50 # View delivery history
```

## Development

```bash
pnpm install          # Install all workspaces
pnpm build            # Build all packages
pnpm test             # Run tests
pnpm format           # Format + lint
```

## Directory Structure

```
linear-agent-ts/
├── sst.config.ts              # Infrastructure as code (SST v2)
├── packages/                  # Shared workspace packages (api-gateway, linear-client,
│                               #   dynamodb-client, webhook-verify, monitor-tui, ...)
├── services/
│   ├── dispatcher-service/    # NestJS app: local dispatcher
│   └── relay-service/         # Lambda handlers: serverless webhook relay
└── infra/                     # SST stack definitions
```
