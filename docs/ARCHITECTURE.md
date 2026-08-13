# Architecture

```text
eight local agent adapters -> connector protocol v2 -> Next.js -> PostgreSQL
browser ---------------------- GitHub OAuth -----------^
```

`apps/web` owns OAuth, hashed sessions, browser pairing, authenticated snapshot ingestion,
account/source lifecycle, SSR pages, and ranking. `packages/connector` owns stable installation
identity, local-only source paths, exact collectors, additive hooks, CLI capture wrappers,
single-flight/retry/pending state, and diagnostics. PostgreSQL is the only shared state. There is no
queue, cache, worker, proxy, ORM, or second service.

## Identity and pairing

`installation.json` contains a random UUID and secret that survive reconnect. `config.json` contains
the current server origin, device capability, local source mapping, and local paths. The connector
sends only opaque client source IDs and allowlisted source metadata during pairing. In one browser
transaction, each source is mapped to a new or existing `agent_account` of the same user and agent.
Approval rotates the device token; a transaction lock serializes reconnects.

Server storage separates `installations`, human-defined `agent_accounts`, and machine-local
`installation_sources`. Composite foreign keys prevent cross-user or cross-agent mappings.

## Snapshot ingestion and ranking

Every source sends a 31-day UTC snapshot with a monotonically increasing decimal sequence. Complete
snapshots replace values and delete missing dates; partial snapshots update only present dates.
Values may decrease. The server validates canonical decimal strings, source ownership, body/range
limits, and token components, then uses bulk JSON-to-recordset SQL in one transaction.

Accepted updates rebuild only affected `(user, agent, UTC week)` rows in `weekly_agent_usage`.
Leaderboard and public profile reads use this compact table. Within an account, account-wide sources
use daily `max`; machine-local sources use daily `sum`. Different accounts and agents sum.

## Reliability and lifecycle

Collectors run independently with concurrency four. A stale-aware atomic file lock provides
cross-process single flight. Network calls use bounded exponential retry with jitter; one latest
pending snapshot file per source survives a process or network failure. Owned hook handlers carry
the exact `viberacing-hook-v2` marker and can be updated or removed without touching other hooks.

`/health` is process liveness. `/ready` validates production configuration, PostgreSQL, and the
exact migration ledger. Small opportunistic cleanup batches remove expired sessions/pairings,
rate-limit buckets, old empty revoked installations, and orphaned empty accounts.
