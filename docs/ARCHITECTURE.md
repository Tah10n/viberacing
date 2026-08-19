# Architecture

```text
local adapter registry -> connector protocol v2 -> Next.js -> PostgreSQL
browser ---------------------- GitHub OAuth -----------^
```

`apps/web` owns OAuth, hashed sessions, browser pairing, authenticated snapshot ingestion,
account/source lifecycle, SSR pages, and ranking. `packages/connector` owns stable installation
identity, local-only source paths, exact collectors, additive hooks, CLI capture wrappers,
single-flight/retry/pending state, and diagnostics. PostgreSQL is the only shared state. There is no
queue, cache, worker, proxy, ORM, or second service.

## Identity and pairing

`installation.json` contains a random UUID and secret that survive reconnect. Local `sources.json`
contains random stable client source UUIDs, normalized data roots, collection methods, surfaces,
safe labels, and adapter-specific roots needed for local hook cleanup. Qwen keeps its runtime data
root and config root separate there. `config.json` contains only the origin, device capability, and
server mapping; it contains no path or path hash. Source discovery reconciles by
`(agent, normalized data root)`, so discovery order and reconnect do not change identity. The
connector sends only opaque client source IDs and allowlisted source metadata during pairing. In one
browser transaction, each source is mapped to a new or existing `agent_account` of the same user and
agent. Reconnect stages source mappings with the hashed pairing code without changing an existing
source's active status, so an abandoned or expired browser approval cannot interrupt the current
connector. Approval atomically activates the staged mappings and rotates the device token; a
transaction lock serializes reconnects. Usage authentication rechecks that token under the same
installation row lock.

Current Kimi discovery previews removal of a migrated legacy root without changing `sources.json`.
The pairing carries only its opaque client source ID, and the approval page discloses the
replacement. Approval atomically disconnects the superseded mapping, removes its duplicated daily
rows, rebuilds the affected ranking summary, and then lets the connector persist the current local
source. An abandoned pairing therefore leaves both local configuration and server history intact.

Server storage separates `installations`, human-defined `agent_accounts`, and machine-local
`installation_sources`. Composite foreign keys prevent cross-user or cross-agent mappings.
Reassigning a source during pairing rebuilds only the affected user's agent summaries in that same
transaction. Separate Codex profiles are selected with source-specific `CODEX_HOME` environments;
the `account_max` rule prevents account-wide totals shared across computers from doubling. Capture
sources use `captures/<clientSourceId>.jsonl`. Antigravity Personal and Work therefore have
independent files and can map to independent accounts; the wrapper consumes `--source` locally when
more than one profile exists.

## Snapshot ingestion and ranking

Every changed source sends a 31-day UTC snapshot with a monotonically increasing decimal sequence.
Complete snapshots replace values and delete missing dates; partial snapshots update only present
dates and retain the greater prior total when a partial subtotal is lower. Complete corrections may
decrease values. The server validates canonical decimal strings, source ownership, body/range
limits, and token components, then uses bulk JSON-to-recordset SQL in one transaction. A failed
collector can send only the allowlisted `collector_failed` diagnostic code for its mapped source;
raw errors, content, and paths are never part of the protocol.

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

Owned hook handlers carry `viberacing-hook-v3:<clientSourceId>` and pass the same stable local
source ID to `viberacing hook`. Removal filters only that marker, preserving foreign hooks and other
Vibe Racing profiles. Connect and `doctor --repair` reconcile active mappings to current hooks,
remove hooks for known unmapped sources, and replace the one legacy v2 marker. A hook discards
stdin, updates its entry in the version-2 `dirty.json` ledger under a short read-modify-write file
lock, claims one scheduler lock, and exits with the provider's minimal response. Entries contain
only source UUID, timestamps, and a generation—never a path or account label.

The short-lived detached scheduler uses one timer: 15-second debounce, 120-second minimum automatic
interval, and 120-second maximum delay. After taking the single-flight sync lock it drains pending
payloads, snapshots dirty generations, maps those client IDs to active sources, and runs only those
collectors. It saves fingerprints/sequences only for processed sources and clears a dirty entry only
when its generation still matches, so concurrent events survive for the next batch. Manual sync and
first connect collect every active source and apply the same generation-safe clearing. One dirty
generation produces one automatic attempt: collector failures finish it, network failures retain the
compact pending payload, and only a newer generation schedules another process. An automatic batch
makes one bounded 60-second wait for an in-flight manual sync's single-flight lock and, if that
expires, exactly one further bounded acquisition. A second timeout exits with the dirty generation
intact, so the event is neither dropped nor turned into an unbounded retry. Scheduler and sync locks
carry ownership tokens, so a stale owner cannot remove a replacement lock. There is no daemon,
watcher, polling loop, or required cron.

A stale-aware atomic sync lock provides cross-process single flight. Normalized snapshot
fingerprints include range, completeness, entries, and warning/error state; unchanged sources with
no pending payload make no HTTP request. A direct manual sync waits at most 60 seconds for that lock
and exits nonzero with an explicit busy message if it remains occupied. Network calls use at most
three attempts with exponential backoff and jitter; one latest pending snapshot file per source
survives a process or network failure. Pending delivery never implies another collector scan.
Permanent payload errors move one safe payload per source to `pending/quarantine` without blocking
future snapshots. `unsupported_source` or a disconnected status observed during installation
inspection removes the mapping, owned hook, dirty/pending/quarantine/adapter/sequence/fingerprint
state while preserving the local definition for reconnect. A TTL-bounded remote reconciliation runs
only during existing hook/manual activity, not by polling, so an unchanged dashboard-disconnected
source is retired too. Lifecycle mutations set a revocation marker and wait on the same exclusive
sync lock before cleanup; an in-flight sync checks the marker before saving or starting another
delivery. Uninstall attempts all known roots and retains failed-root metadata/runtime until a repeat
succeeds. Reconnect performs its final config/token/hook replacement under that lifecycle lock;
doctor performs mutable remote reconciliation under the sync lock. Authorization revocation removes
hooks/token/automatic state, and HTTP 426 disables automatic attempts until a compatible reconnect
or authenticated server response confirms the updated connector. Successful capture syncs retain
only 35 days and atomically compact oversized source-specific files.

Approval is serialized on the user row and caps each user at 20 active installations, 100 active
sources, and 100 agent accounts. Ingestion has both installation and user fixed-window limits, so
additional computers cannot multiply the user-wide request budget. Browser login is also serialized
per user, rotates the current browser token, and retains at most ten active 30-day sessions per
user. OAuth and pairing apply pre-authentication limits only when the deployment exposes a trusted
client address; shared global buckets are reached only after OAuth state or browser-session and
per-user validation, so anonymous traffic cannot consume the authenticated work budget.

`/health` is process liveness. `/ready` validates production configuration, PostgreSQL, required
tables, and the presence of the latest required migration; later ledger rows remain ready. Small
opportunistic cleanup batches remove expired sessions/pairings, rate-limit buckets, old empty
revoked installations, and orphaned empty accounts.

HTML responses use a fresh request nonce for framework scripts and styles. The production CSP never
allows unsafe inline script or style execution; development permits only the eval support required
by React diagnostics. API, health, readiness, and static-asset responses do not need an HTML CSP.
