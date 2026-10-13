# ADR 0008: One-Command Local Startup

**Status:** Accepted

**Date:** 2026-10-13

## Context

[ADR 0001](0001-relay-service-architecture.md) runs the relay on the developer's
machine behind a public tunnel. A working setup needs five parts, in order: a
public URL, the relay on that URL, a Linear connection that registers the
dispatcher with the relay, the dispatcher, and the monitor TUI. Each part
depends on the one before it. The relay needs the tunnel URL as `RELAY_BASE_URL`.
The Linear connection needs the relay to be up. Starting them by hand in
separate terminals is easy to get wrong.

## Decision

### One command starts the stack in order

`pnpm dev:up` runs `scripts/dev-up.mjs`. The script does these steps in order:

1. Checks that the `claude` CLI is on the path. It creates each missing
   the root `.env.local` from `.env.example` with mode `0600`.
2. Starts the tunnel. It refuses to start if the relay port (default 3001) already
   answers HTTP.
3. Starts the relay with `RELAY_BASE_URL` set to the tunnel URL. It waits up to
   60s for the relay to answer.
4. Prints the webhook URL and OAuth callback URL to set in the Linear app.
5. Runs `pnpm connect-relay` when needed (see below).
6. Starts `scripts/monitor.js` in the dispatcher directory. The monitor boots the
   dispatcher and shows the TUI.

The relay and tunnel write to `logs/relay.log` and `logs/tunnel.log`, so the TUI
owns the terminal. `scripts/lib/stack.mjs` starts each service in its own process
group. Ctrl-C or quitting the TUI stops the relay and tunnel by killing those
groups. Killing only the `pnpm` wrapper would leave its `node` child holding the
port.

### Tunnel selection order

`startTunnel` in `scripts/lib/tunnel.mjs` takes the first option that applies:

| Order | Tunnel                | Chosen when                                                  | URL                    |
| ----- | --------------------- | ------------------------------------------------------------ | ---------------------- |
| 1     | Cloudflare named      | `CLOUDFLARE_TUNNEL_TOKEN` and `TUNNEL_HOSTNAME` are both set | stable, needs a domain |
| 2     | Tailscale Funnel      | Tailscale reports `BackendState` of `Running`                | stable, no domain      |
| 3     | Cloudflare quick tunnel | `cloudflared` is installed                                 | random on every run    |

Stable options come first because a changed URL forces a new Linear connection
and new URLs in the Linear app. The named tunnel passes its token through the
environment, so the token stays out of `ps`. If a named tunnel is configured but
`cloudflared` is missing, the script fails instead of falling back. If none of
the three works, the script fails and names Tailscale and `cloudflared` as the
fixes.

### Linear connect runs only when needed

`dev-up.mjs` runs `pnpm connect-relay` when any of these is true:

- The root `.env.local` has no `RELAY_SUBSCRIBER_SECRET`.
- Its `RELAY_URL` differs from the current tunnel URL.
- The relay does not know the saved `RELAY_SUBSCRIBER_ID` (for example, the
  database was reset).
- The user passed `--reconnect`.

Otherwise the script skips the browser step.

### Where credentials land

- The script prompts for `LINEAR_OAUTH_CLIENT_ID`, `LINEAR_OAUTH_CLIENT_SECRET` and `LINEAR_WEBHOOK_SECRET` when one is missing or still a `your_` placeholder, and saves them to the root `.env.local`.
- `connect-relay` writes `RELAY_ENABLED`, `RELAY_SUBSCRIBER_SECRET`, `RELAY_URL`,
  `RELAY_DISPATCHER_URL` and (when the relay returns one) `RELAY_SUBSCRIBER_ID` to
  the same root `.env.local`. One file serves the relay, the dispatcher, the CLIs and the TUI; `RELAY_PORT` and `DISPATCHER_PORT` replace `PORT` so the two services do not collide.
- Both writes use `@linear-agent/env-file`, which saves files with mode `0600`.

### Retention can force a reconnect

[ADR 0001](0001-relay-service-architecture.md) describes the relay's daily cleanup. It removes subscribers idle for 14 days, and the next `pnpm dev:up` then reconnects without a flag, because the relay no longer knows the saved `RELAY_SUBSCRIBER_ID`.

## Consequences

**Advantages:**

- One command takes a new checkout to a running stack. A second run skips every
  step that is already done.
- A stable tunnel means no reconnect and no Linear app edits between runs.

**Disadvantages:**

- With only a quick tunnel, the URL changes every run. Each run needs a new
  Linear connection and new URLs in the Linear app.
- A relay left idle for 14 days loses its subscriber, so the user reauthorizes in the browser on the next start.
- The script supports one local stack. Stopping it takes the relay and tunnel
  with it.

## References

- [ADR 0001: Relay Service Architecture](0001-relay-service-architecture.md) — the local relay, SQLite state and the retention job this ADR describes in detail
- [ADR 0002: OAuth and Subscriber Registration](0002-oauth-and-subscriber-registration.md) — the flow `connect-relay` runs
- [ADR 0005: Deterministic Subscriber Identity](0005-deterministic-subscriber-identity.md) — the `RELAY_SUBSCRIBER_ID` the script checks
