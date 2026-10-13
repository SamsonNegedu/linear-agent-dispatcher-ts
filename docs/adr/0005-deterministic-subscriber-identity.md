# ADR 0005: Deterministic Subscriber Identity

**Status:** Accepted

**Date:** 2026-07-17

## Context

Each Linear team and person pair that connects a dispatcher gets one row in the
relay's `subscribers` table (SQLite). The row holds the dispatcher's current
webhook delivery URL (`localEndpoint`) and the HMAC secret that signs
deliveries to that URL. The normal way to change `localEndpoint` is to re-run
the OAuth connect flow or `update-relay`. This usually happens after a tunnel
restart gives the dispatcher a fresh ngrok URL.

The subscriber ID used to be derived from `(teamKey, linearUserId,
sha256(localEndpoint))`. Registering the same person for the same team from a
_new_ endpoint therefore created a new subscriber ID instead of updating the
existing row. This happened even though `upsertSubscriber` already overwrites
by ID (it looks up the ID, keeps `registeredAt`, bumps `version` and
overwrites the other fields). Every endpoint change, such as an ngrok restart,
left two active rows for one person, each with its own secret.

The relay's fan-out looks up the subscribers for a team and assignee and
delivers to each row. Every webhook was therefore sent twice. The dispatcher
accepted the copy signed with the secret in its `.env.local`. It rejected the
copy signed with the stale secret as `Invalid signature`.

## Decision

Derive the subscriber ID from `(teamKey, linearUserId)` only:

```ts
export function buildSubscriberId(teamKey: string, linearUserId: string): string {
  return `${teamKey}:${linearUserId}`;
}
```

One person has exactly one active subscription per team, however many
machines or tunnel URLs they register from over time. `localEndpoint` only
says where to deliver next. When the endpoint changes, `upsertSubscriber`
updates the existing row. It does not create a second identity.

## Consequences

**Advantages:**

- Re-registering (OAuth flow or `update-relay`) always updates the existing
  row in place. An endpoint change can no longer cause duplicate delivery or
  a signature mismatch.
- The registry no longer collects one stale row per past ngrok URL, so no
  cleanup or expiry job is needed.

**Disadvantages:**

- One person cannot run two independent dispatchers for the same team at the
  same time (for example, one on a laptop and one on a server). The second
  registration overwrites the endpoint and secret of the first dispatcher and
  silently cuts it off. The project does not support this today. If it must,
  the identity needs a third, _explicit_ part, such as a dispatcher name the
  user chooses, not a hash of the current endpoint.

## Alternatives Considered

| Approach                                                               | Rejected because                                                                                                                                                                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep the endpoint-hashed ID, add TTL or stale-row cleanup for orphaned rows | Treats the symptom (registry bloat), not the cause (wrong identity key). Double delivery and signature mismatch would still happen after every re-registration until the stale row expired |
| Keep endpoint-hashed ID, add a `PUT /subscribers/keepalive` + reap job | Same as above, plus meaningfully more infrastructure (new endpoint, scheduled Lambda, schema field) for a problem the identity-key fix removes outright                                                     |

## References

- [ADR 0002: OAuth and Subscriber Registration](0002-oauth-and-subscriber-registration.md) — the registration flow that uses this ID
- [ADR 0003: Webhook Routing and Delivery](0003-webhook-routing-and-delivery.md) — the fan-out that delivered twice under the old ID scheme
