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

`installation.json` contains a random UUID and secret that survive reconnect. Local `sources.json`
contains random stable client source UUIDs, normalized roots, collection methods, surfaces, and safe
labels. `config.json` contains only the origin, device capability, and server mapping; it contains
no path or path hash. Source discovery reconciles by `(agent, normalized root)`, so discovery order
and reconnect do not change identity. The connector sends only opaque client source IDs and
allowlisted source metadata during pairing. In one browser transaction, each source is mapped to a
new or existing `agent_account` of the same user and agent. Reconnect stages source mappings with
the hashed pairing code without changing an existing source's active status, so an abandoned or
expired browser approval cannot interrupt the current connector. Approval atomically activates the
staged mappings and rotates the device token; a transaction lock serializes reconnects. Usage
authentication rechecks that token under the same installation row lock.

Server storage separates `installations`, human-defined `agent_accounts`, and machine-local
`installation_sources`. Composite foreign keys prevent cross-user or cross-agent mappings.
Reassigning a source during pairing rebuilds only the affected user's agent summaries in that same
transaction. Separate Codex profiles are selected with source-specific `CODEX_HOME` environments;
the `account_max` rule prevents account-wide totals shared across computers from doubling.

## Snapshot ingestion and ranking

Every changed source sends a 31-day UTC snapshot with a monotonically increasing decimal sequence.
Complete snapshots replace values and delete missing dates; partial snapshots update only present
dates. Values may decrease. The server validates canonical decimal strings, source ownership,
body/range limits, and token components, then uses bulk JSON-to-recordset SQL in one transaction. A
failed collector can send only the allowlisted `collector_failed` diagnostic code for its mapped
source; raw errors, content, and paths are never part of the protocol.

The server reports `lastAcceptedSyncSequence` during pairing, installation inspection, and usage
responses. Connect, doctor, and sync reconcile the local value with the server maximum. A stale
pending snapshot is rewritten to `server + 1` and retried once; there is no unbounded sequence loop.

Accepted updates rebuild only affected `(user, agent, UTC week)` rows in `weekly_agent_usage`.
Leaderboard and public profile reads use this compact table. Within an account, account-wide sources
use daily `max`; machine-local sources use daily `sum`. Different accounts and agents sum.

## Reliability and lifecycle

Collectors run independently with concurrency four. The first run reads at most the required 31 UTC
days within explicit file/count/byte bounds. Later JSONL runs reuse size, mtime, inode, and the last
complete byte offset; unchanged files are not reopened for content, appends resume, truncation or
replacement rereads only that file, and disappeared files leave the index. OpenCode's read-only SQL
is range-bounded. One Codex App Server is started per actually configured profile per batch.

Owned hook handlers carry the exact `viberacing-hook-v2` marker and can be updated or removed
without touching other hooks. A hook discards stdin, atomically updates `dirty.json`, claims one
scheduler lock, and exits with the provider's minimal response. The short-lived detached scheduler
uses one timer: 15-second debounce, 120-second minimum automatic interval, and 120-second maximum
delay. It rereads dirty state before and after sync so events during a batch are retained. There is
no daemon, watcher, polling loop, or required cron. Manual sync and first connect bypass cooldown.

A stale-aware atomic sync lock provides cross-process single flight. Normalized snapshot
fingerprints include range, completeness, entries, and warning/error state; unchanged sources with
no pending payload make no HTTP request. Network calls use at most three attempts with exponential
backoff and jitter; one latest pending snapshot file per source survives a process or network
failure. Permanent payload errors move one safe payload per source to `pending/quarantine` without
blocking future snapshots. `unsupported_source` retires only its server mapping, authorization
revocation removes hooks/token/automatic state, and HTTP 426 disables automatic attempts until an
update. Successful capture syncs retain only 35 days and atomically compact oversized files.

`/health` is process liveness. `/ready` validates production configuration, PostgreSQL, and the
exact migration ledger. Small opportunistic cleanup batches remove expired sessions/pairings,
rate-limit buckets, old empty revoked installations, and orphaned empty accounts.
