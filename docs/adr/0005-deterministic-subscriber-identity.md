# ADR 0005: Deterministic Subscriber Identity

**Status:** Accepted

**Date:** 2026-07-17

## Context

Each Linear team + person combination that connects a dispatcher gets a row
in the relay's subscriber registry (`SUBSCRIBER#<subscriberId>`), holding the
dispatcher's current webhook delivery URL (`localEndpoint`) and the HMAC
secret used to sign deliveries to it. Re-running the OAuth connect flow (or
`update-relay`) is the normal way a dispatcher's `localEndpoint` changes —
most commonly because it's tunneled through a fresh ngrok URL after a
restart.

The subscriber ID was derived from `(teamKey, linearUserId,
sha256(localEndpoint))`. Re-registering the same person for the same team
from a *new* endpoint produced a brand-new subscriber ID rather than
updating the existing row — even though `upsertSubscriber` itself already
does correct overwrite-by-id semantics (look up by id, preserve
`registeredAt`, bump `version`, overwrite the rest). Any two registrations
for the same person/team from different endpoints — e.g. across an ngrok
restart — leave two active subscriber rows behind, each with its own secret.

The relay's fan-out queries all subscribers for a team and delivers to each,
so every webhook is sent twice: once signed with whichever secret the
dispatcher's `.env.local` currently holds (accepted), and once with the
other, now-stale secret (rejected as `Invalid signature`).

## Decision

Derive the subscriber ID from `(teamKey, linearUserId)` only:

```ts
export function buildSubscriberId(teamKey: string, linearUserId: string): string {
  return `${teamKey}:${linearUserId}`;
}
```

One person has exactly one active subscription per team, regardless of how
many machines or tunnel URLs they've registered from over time.
`localEndpoint` is just "wherever to deliver next" — updating it via
`upsertSubscriber` is the correct response to a changed endpoint, not
creating a second identity.

## Consequences

**Advantages:**

- Re-registering (OAuth flow or `update-relay`) always updates the existing
  row in place — no duplicate-delivery/signature-mismatch failure mode is
  possible for this cause.
- Removes a whole class of registry bloat (one stale-endpoint row per past
  ngrok URL) without needing any cleanup/expiry mechanism.

**Disadvantages:**

- One person cannot run two independent dispatchers for the same team at the
  same time (e.g., one on a laptop, one on a server) — the second
  registration overwrites the first's endpoint and secret, silently cutting
  the first off. Not a supported use case today; if it becomes one, the
  identity would need a third, *explicit* discriminator (e.g., a
  user-chosen dispatcher name), not an incidental hash of the current
  endpoint.

## Alternatives Considered

| Approach | Rejected because |
|---|---|
| Keep endpoint-hashed ID, add TTL/reap-stale cleanup for orphaned rows | Treats the symptom (registry bloat), not the cause (wrong identity key) — the double-delivery/signature-mismatch failure would still happen on every re-registration until the stale row eventually expired |
| Keep endpoint-hashed ID, add a `PUT /subscribers/keepalive` + reap job | Same as above, plus meaningfully more infrastructure (new endpoint, scheduled Lambda, schema field) for a problem the identity-key fix removes outright |

## References

- [ADR 0002: OAuth and Subscriber Registration](0002-oauth-and-subscriber-registration.md) — registration flow this ID is used in
- [ADR 0003: Webhook Routing and Delivery](0003-webhook-routing-and-delivery.md) — fan-out that double-delivered under the old ID scheme
