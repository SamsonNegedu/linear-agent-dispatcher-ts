# Relay Service

Receives Linear's webhooks and fans them out to the local dispatchers registered for the issue's team and assignee. It runs on your machine (`pnpm dev:up` starts it behind a public tunnel) and keeps its state in a local SQLite file.

## Flow

```
Linear webhook (one POST)
  → verify the HMAC signature
  → parse issue + assignee
  → look up subscribers for that team and user
  → POST to each dispatcher in parallel, signed with that subscriber's own secret
  → record each delivery (kept 30 days)
```

## Running it

From the repo root, `pnpm dev:up` does everything (tunnel, relay, Linear connect, dispatcher, TUI). To run the relay alone:

```bash
cd services/relay-service
cp ../../.env.example .env.local   # fill in the LINEAR_* values
pnpm dev                           # listens on PORT (default 3001)
```

Linear and the dispatchers must reach the relay over HTTPS, so expose it with Tailscale Funnel or a Cloudflare tunnel (`dev:up` does this) and set `RELAY_BASE_URL` to that URL.

`localEndpoint` (where the relay delivers to a dispatcher) must be the **full delivery URL**, e.g. `https://<host>/webhooks/relay`: the relay doesn't know the receiver's routes and POSTs to exactly what it is given. It must be `https://` to a public host, or `http://localhost:<port>`. Private-network addresses (10.x, 172.16–31.x, 192.168.x, 169.254.x, loopback, IPv6 local) are rejected so a registered endpoint can't make the relay call internal services.

## Storage

One SQLite file (`RELAY_DB_PATH`, default `./data/relay.db`, created on first start) with two tables:

- `subscribers`: `subscriber_id` (`<teamKey>:<linearUserId>`, one per person per team), `team_key`, `linear_user_id`, `local_endpoint`, `subscriber_secret` (32-byte hex, signs deliveries), `registered_at`, `last_seen_at`, `last_webhook_at`, `version`.
- `webhook_deliveries`: one row per delivery attempt with its status (`success`, `timeout`, `unreachable`, `verification_failed`), response time and error.

Housekeeping runs at startup and then daily: subscribers with no delivery or registration for 14 days are removed, and delivery logs older than 30 days are deleted. To reset everything, stop the relay and delete the file (every dispatcher must then reconnect: `pnpm dev:up -- --reconnect`).

## Registration (OAuth)

1. The dispatcher calls `GET /subscribers/auth/start?localEndpoint=...` and opens the returned Linear URL.
2. The user authorizes; Linear redirects to `GET /callback`.
3. The relay exchanges the code, looks up every team the user belongs to, and registers the dispatcher for **each of them under one secret**.
4. The secret and subscriber id go back to the CLI, which saves `RELAY_SUBSCRIBER_SECRET` and `RELAY_SUBSCRIBER_ID` to `.env.local`.

Moving a dispatcher to a new URL: `PATCH /subscribers` with `{ subscriberId, subscriberSecret, localEndpoint }`. The secret is required and checked; an unknown id and a wrong secret get the same 401, so ids can't be probed.

## Environment

```bash
# Linear (required)
LINEAR_OAUTH_CLIENT_ID=...
LINEAR_OAUTH_CLIENT_SECRET=...
LINEAR_WEBHOOK_SECRET=...

# Optional
LINEAR_ORGANIZATION_ID=...   # only accept webhooks from this workspace
LINEAR_API_KEY=...           # resolves assignee/team for AgentSession webhooks, which don't carry them
RELAY_BASE_URL=...           # public URL, used for the OAuth redirect (dev:up sets it)
RELAY_DB_PATH=./data/relay.db
PORT=3001
```

## Tests

```bash
pnpm test
```

Unit tests cover the services and controllers; the two repositories run against an in-memory SQLite database.
