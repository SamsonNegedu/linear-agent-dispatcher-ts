# Getting the Dispatcher Running

## 1. Prerequisites

- Node.js 24+, pnpm 9+, Docker, [bun](https://bun.sh) (for the monitor TUI)
- `claude` CLI on your `$PATH` and logged in
- Optional: [Tailscale](https://tailscale.com/download) for a stable public URL (see below)
- A Linear OAuth app (client ID, client secret, webhook secret)

## 2. Run

```bash
pnpm install
pnpm dev:up        # from the repo root
```

`pnpm dev:up` does everything:

1. Starts DynamoDB Local (Docker) and a public tunnel (Tailscale Funnel, Cloudflare, or a quick tunnel), and creates the table
2. Starts the relay with the tunnel as its public URL
3. Asks once for your Linear credentials (saved to `services/relay-service/.env.local`)
4. Opens your browser to authorize Linear (first run only; saves `RELAY_SUBSCRIBER_SECRET`)
5. Starts the dispatcher and opens the monitor TUI. Quit the TUI or press Ctrl-C to stop everything

Credentials and the subscriber secret are written to `.env.local` files readable only by you (mode `0600`). Flags: `pnpm dev:up -- --reconnect` forces the Linear authorize step again.

It prints the webhook and OAuth callback URLs to paste into your Linear app. Logs: `logs/relay.log`, `services/dispatcher-service/logs/server.log`.

### Stable URLs (recommended)

Without a stable URL you must update Linear every run. Easiest fix, free and no domain needed: install [Tailscale](https://tailscale.com/download), run `tailscale up` once, and enable Funnel for your tailnet. `pnpm dev:up` then uses `https://<machine>.<tailnet>.ts.net` automatically.

Alternative: a Cloudflare named tunnel (needs a domain). Route a hostname to `http://host.docker.internal:<relay-port>` and set `CLOUDFLARE_TUNNEL_TOKEN` and `TUNNEL_HOSTNAME` in the root `.env`. This takes priority over Tailscale.

With neither, it falls back to a random quick-tunnel URL.

## 3. Add repos and choose skills

`routing.config.json` lists your repos and which skills a Linear label may trigger. A label `agent-<name>` runs `/<name>` in the repo, but only for skills you list, so nothing else in a repo is exposed to Linear by accident.

```json
{
  "skills": ["implement", "fix-bug"],
  "repositories": ["~/code/api", { "path": "~/code/web", "skills": ["design-review"] }]
}
```

- Top-level `skills` apply to every repo; a repo's own `skills` add to them.
- A repo's label is its folder name (`api`, `web`).
- Map a label to a differently named skill with `"issueLabelToSkill": { "agent-build": "implement" }` on the repo.

```bash
pnpm routes add ~/code/api --skills=implement   # register a repo (lists the skills it has)
pnpm routes                                     # table of repo / label / skill
pnpm routes check                               # same, exits 1 if a path or skill is missing
```

On a Linear issue, set the repo's label (e.g. `api`) plus one mode label (e.g. `agent-implement`). Restart after editing the config. Startup refuses to boot if a repo path or listed skill is missing, and the TUI Dashboard shows each label's skill with ✓/✗. The file has a `$schema` for editor autocomplete.

## 4. The monitor TUI

Tabs: Dashboard (repos and each label's skill, ✓/✗), Logs, Relay, Runs, **Needs input**, Completed, Failed. The header shows live counts and relay status.

| Key            | Action                                                                             |
| -------------- | ---------------------------------------------------------------------------------- |
| `↑↓` / `1`–`7` | Switch tab                                                                         |
| `y`            | Copy the selection, or the whole tab, to the clipboard                             |
| `m`            | Toggle mouse capture (off: select text with the mouse and Cmd+C; on: wheel scroll) |
| `Ctrl+R`       | Restart the dispatcher server in place; the TUI stays up                           |
| `q` / `Ctrl+C` | Quit and stop everything                                                           |

## 5. Check it works

```bash
cd services/dispatcher-service
pnpm test-webhook -- --issue-id=TEST-1 --label=<repo-label>,agent-implement
```

`--label` takes the repo's label and one mode label, comma-separated (`pnpm routes` lists them). A new run should appear in the TUI. Or assign yourself a Linear issue on a registered team.

## Permissions for unattended runs

Runs are headless, so Claude can't ask for approval; anything not allowed is denied (you'd see "the `get_issue` call was denied" in the Linear comment). By default every run gets:

- the core tools (`Read, Edit, Write, Glob, Grep, Bash, Skill, Task, TodoWrite, NotebookEdit`),
- every MCP server configured for that repo (user, project, plugin and claude.ai connectors; discovered with `claude mcp list` and cached for 10 minutes), so Linear, Playwright and anything you add later just work,
- `--permission-mode dontAsk`: whatever isn't allowed is denied rather than left undecided.

The repo's `.claude/settings.json` still applies on top, including its `deny` rules. Tune with `CLAUDE_ALLOWED_TOOLS`, `CLAUDE_ALLOW_ALL_MCP=false`, `CLAUDE_PERMISSION_MODE` (see `.env.example`). Issue text is untrusted input and `Bash` is unrestricted, so keep `deny` rules for destructive commands in each repo.

## When a run needs your input

A run is one non-interactive turn, so an agent can't ask a question and wait. A skill that must ask ends its reply with `Stop rule: <reason>`; the dispatcher then marks the run **needs input** (not "succeeded"), posts the question on the Linear issue as an "Action required" comment, and lists it under **Needs input** in the TUI. Answer on the issue, then re-trigger the run (for example by toggling the label). The duplicate-run window (`duplicateRunWindowMs`, default 60s) applies to the retry.

## Troubleshooting

- **Claude never runs**: `which claude` must resolve and `claude` must not prompt for login.
- **Dispatcher won't start, listing missing repos or skills**: preflight found a repo path or listed skill that doesn't exist. Run `pnpm routes check` to see which, fix the config, or set `PREFLIGHT_SKIP=1` to boot anyway.
- **"the `<tool>` call was denied" in a Linear comment**: see Permissions for unattended runs; the tool isn't allowed in that repo.
- **Port already in use on start**: a relay from a previous run is still up; `lsof -ti tcp:<port> | xargs kill`.
- **Ctrl+R says the server wasn't started by `pnpm monitor`**: the TUI was started on its own; restart the server manually.
- **Nothing on issue assignment**: check the Linear webhook and callback URLs match the printed tunnel URL.
- **"Subscriber not found on relay"**: the relay has no record of your saved secret (e.g. wiped DB). Re-run with `pnpm dev:up -- --reconnect`. It also reconnects automatically when the saved relay URL differs from the current tunnel.
- **Reset local state**: delete `.data/dynamodb` (relay data) and `RELAY_SUBSCRIBER_SECRET`. The relay's registration persists between runs, so a changed tunnel URL needs a re-authorize.

## Manual / team setups

Running against a shared relay, or moving the dispatcher to another server:

```bash
cd services/dispatcher-service
pnpm connect-relay --relay-url=<relay> --local-endpoint=<public dispatcher url>
pnpm update-relay --local-endpoint=https://new-server.com/webhooks/relay   # changed endpoint, no re-auth
```

A shared relay on AWS can't reach `localhost`; expose the dispatcher with a tunnel and pass that URL as `--local-endpoint`.
