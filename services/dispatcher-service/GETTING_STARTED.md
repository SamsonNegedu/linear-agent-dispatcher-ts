# Getting the Dispatcher Running

Everything you need, in order, from a clean checkout to a dispatcher that picks up Linear issues and runs Claude against them. Follow steps 1–6 straight through — nothing here requires jumping to another doc.

Every dispatcher receives Linear events through a relay — there's no direct Linear-to-dispatcher webhook path. The only decision you'll make is in step 4: connect to a relay you run yourself (solo dev, fastest) or one already deployed for the team.

## 1. Prerequisites

- Node.js 24+, pnpm 9+
- The `claude` CLI installed and authenticated (`claude` on your `$PATH` — check with `which claude`; log in once with `claude` if you haven't)
- From the repo root: `pnpm install`

## 2. Create your env file

```bash
cd services/dispatcher-service
cp ../../.env.example .env.local
```

Then edit `.env.local` — everything not listed below has a sane default:

| Variable                                    | Required?              | Purpose                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                       | no (default `3000`)     | Port the dispatcher HTTP server listens on                                                                                                                                                                                                                                                                                |
| `CLAUDE_BIN_PATH`                            | no (default `claude`)   | Path to the Claude CLI binary the executor shells out to                                                                                                                                                                                                                                                                  |
| `CLAUDE_PERMISSION_MODE`                     | no                      | Accepted and validated (`auto`/`ask`) but **not currently wired into the spawned `claude` process** — the executor always runs `claude -p` headless with stdin ignored, so no interactive prompt is possible either way. Real permission behavior comes from the target repo's `.claude/settings.json`, not this variable |
| `DISPATCHER_DB_PATH`                         | no (default `./data/dispatcher.db`) | SQLite file tracking dispatched runs                                                                                                                                                                                                                                                                          |
| `MAX_RUN_DURATION`                           | no (default 30 min, in ms) | Timeout per dispatched Claude run                                                                                                                                                                                                                                                                                    |
| `LINEAR_API_KEY`                             | no (recommended)        | Lets the dispatcher post activity/comments back to Linear once a run is dispatched. Has no effect on whether the dispatcher *receives* events — that's entirely the relay connection in step 4. Skipped (with a warning) if unset                                                                                      |
| `RELAY_ENABLED` / `RELAY_SUBSCRIBER_SECRET`  | **yes**                 | The only way the dispatcher receives Linear events. Set automatically by `connect-relay` in step 4 — don't hand-edit                                                                                                                                                                                                     |

## 3. First run (sanity check)

```bash
pnpm dev
```

You should see `Application is running on port 3000` with no config validation errors. Confirm with:

```bash
curl http://localhost:3000/health
```

If it fails to boot, the error will name the missing/invalid variable directly (see `config-validator.service.ts`) — fix `.env.local` and re-run.

Use `pnpm dev:watch` instead during active development — it recompiles and restarts on file changes.

At this point the dispatcher has no relay connection yet, so it won't receive anything — that's step 4.

## 4. Connect to a relay

### 4a. Get a relay running

**Local relay (solo dev)** — bring one up on your own machine:

```bash
cd services/relay-service
cp ../../.env.example .env.local   # fill in LINEAR_OAUTH_CLIENT_ID/SECRET, LINEAR_WEBHOOK_SECRET
pnpm dev
```

**Shared relay (team deployment)** — skip the above; ask whoever deployed it for its URL instead. But note: a shared relay runs on AWS, not your machine, so it can't reach `http://localhost:3000` — it needs a publicly reachable URL for your local dispatcher. Expose it with a tunnel first, e.g. [ngrok](https://ngrok.com/):

```bash
ngrok http 3000
```

Use the `https://<random>.ngrok.io` URL it prints as `--local-endpoint` below instead of `http://localhost:3000`. (Not needed for a local relay — both processes are on the same machine, so `localhost` works directly.)

### 4b. Run the connector

From `services/dispatcher-service`, run `connect-relay` — it drives the whole Linear OAuth flow for you and writes the resulting secret to `.env.local` automatically, no copy-pasting:

```bash
pnpm connect-relay \
  --relay-url=http://localhost:3001 \
  --local-endpoint=http://localhost:3000 \
  [--port=3333]
```

(For a shared relay: `--relay-url=https://relay.example.com --local-endpoint=https://<random>.ngrok.io`.)

- `--relay-url` (required): the relay's URL — `http://localhost:3001` for a local relay, or the deployed URL (e.g. `https://relay.example.com`) for a shared one
- `--local-endpoint` (required): your dispatcher's public/local base URL (e.g. `http://localhost:3000`). The CLI appends `/webhooks/relay` itself — don't include it
- `--port` (optional, default `3333`): local port used for the OAuth callback

What happens: it requests an authorization URL from the relay, starts a local callback server, opens your browser to Linear OAuth (or prints the URL if it can't), waits up to 5 minutes for you to authorize, then completes the flow and writes to `.env.local`:

```bash
RELAY_ENABLED=true
RELAY_SUBSCRIBER_SECRET=<32-byte-hex-secret>
```

You're auto-registered for **every Linear team you belong to** under a single secret — one dispatcher instance receives webhooks for all of them.

**If something goes wrong:**

- **Browser doesn't open** — the command prints the authorization URL; copy-paste it into a browser manually, the callback is still handled automatically.
- **Localhost callback not working** — make sure nothing else is listening on port 3333, or pass `--port=<different-port>`.
- **Authorization times out** — you have 5 minutes to complete OAuth; just restart the command.
- **Failed to write `.env.local`** — the command prints the secret; add it manually: `RELAY_SUBSCRIBER_SECRET=<secret>`.

### 4c. Restart the dispatcher

```bash
pnpm dev
```

Your dispatcher is now registered for every Linear team you belong to, and the relay will push matching webhooks to `http://localhost:3000`.

## 5. Confirm it's actually working

**Quick check:**
```bash
curl http://localhost:3000/status
```
Should return relay status and today's run counts.

**Option A: Test without Linear (fastest)**
```bash
pnpm test-webhook -- --issue-id=TEST-1 --label=agent-implement
```
Watch dispatcher logs; a new run should appear in `data/dispatcher.db`.

**Option B: Real Linear webhook**
- Assign yourself a Linear issue on a registered team.
- Watch the dispatcher logs for `Received webhook`.
- Check `data/dispatcher.db` — a new run row should appear once Claude is dispatched.

## 6. Moving dispatcher to a new server

If you're moving your dispatcher to a different machine or changing its publicly reachable URL, update the relay without re-authenticating:

```bash
pnpm update-relay --local-endpoint=https://new-server.com/webhooks/relay
```

The command:
- Reads your existing `RELAY_SUBSCRIBER_SECRET` from `.env.local` (proof of ownership)
- Reads the `RELAY_URL` from `.env.local` (where `connect-relay` stored it)
- Sends a PATCH request to update your subscription endpoint
- Prints confirmation

No Linear OAuth re-flow, no orphaned subscriptions — the relay just updates your endpoint and you're live on the new server.

## 7. Common issues

- **"RELAY_SUBSCRIBER_SECRET is required when RELAY_ENABLED=true"** — `connect-relay` didn't finish, or wrote to the wrong `.env.local` (make sure you ran it from `services/dispatcher-service`). Re-run `connect-relay`.
- **Claude never runs** — check `CLAUDE_BIN_PATH` resolves (`which claude`) and that you're authenticated (`claude` should not prompt for login).
- **Nothing happens on issue assignment** — confirm the relay is reachable and its OAuth app's redirect URI matches its deployment (local or shared), and that `connect-relay` completed (`RELAY_ENABLED=true` in `.env.local`).
- **`update-relay` fails with "Subscriber not found"** — the `RELAY_SUBSCRIBER_SECRET` in your `.env.local` doesn't match the relay's records. Re-run `pnpm connect-relay` to generate a fresh subscription.
