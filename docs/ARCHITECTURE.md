# Architecture

```text
local adapter registry -> connector protocol v4 -> Next.js -> PostgreSQL
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
browser transaction, each source is mapped to an `agent_account` of the same user and agent.
Account-wide sources start in a separate account and are matched automatically after complete usage
arrives; machine-local sources retain the explicit new/existing account control. Reconnect stages
source mappings with the hashed pairing code without changing an existing source's active status, so
an abandoned or expired browser approval cannot interrupt the current connector. Approval atomically
activates the staged mappings and rotates the device token; a transaction lock serializes
reconnects. Usage authentication rechecks that token under the same installation row lock.

Current Kimi discovery previews removal of a migrated legacy root without changing `sources.json`.
The pairing carries only its opaque client source ID, and the approval page discloses the
replacement. Approval atomically disconnects the superseded mapping, removes its duplicated daily
rows, rebuilds the affected ranking summary, and then lets the connector persist the current local
source. An abandoned pairing therefore leaves both local configuration and server history intact.

Server storage separates `installations`, human-defined `agent_accounts`, and machine-local
`installation_sources`. Composite foreign keys prevent cross-user or cross-agent mappings.
Reassigning a source during pairing rebuilds only the affected user's agent summaries in that same
transaction. A nullable self-reference links a logical Codex source to its physical profile source.
The authenticated `/api/installations/current/sources/register` transaction locks the user,
installation, and physical profile; enforces eight accounts per profile, 32 sources per
installation, and the shared per-user source/account limits; creates a generic account/source
idempotently; and accepts no provider identity. A restrictive profile foreign key prevents deleting
a physical source while logical sibling accounts still depend on it. Separate Codex profiles are
selected with source-specific `CODEX_HOME` environments; the `account_max` rule prevents
account-wide totals shared across computers from doubling. Capture sources use
`captures/<clientSourceId>.jsonl`. Antigravity Personal and Work therefore have independent files
and can map to independent accounts; the wrapper consumes `--source` locally when more than one
profile exists.

After a complete account-wide snapshot, ingestion compares up to 30 finished UTC days against other
root accounts of the same user and agent. Only nonzero complete days count. At least seven exact
matched days spanning a week, three distinct positive totals, and no overlapping complete mismatch
are required. A deterministic oldest matching account becomes the root; the single-source account is
retained as a hidden alias and an event records only opaque IDs and the number of matched days. The
source retains only the timestamp of that decision, so Undo, manual reassignment, or later event
cleanup cannot make it eligible for another automatic decision. Undo moves the source back to that
alias. Zero-token days do not count as positive evidence, but a complete zero-versus-positive day is
a contradiction. Partial, current-day, weak, or contradictory history never triggers a merge. Codex
provider email and account ID are used together only for a local salt-scoped identity HMAC; email,
provider identifiers, derived HMACs, and credentials are never transmitted.

## Snapshot ingestion and ranking

Every changed source sends a 31-day UTC snapshot with a monotonically increasing decimal sequence.
Complete snapshots replace values and delete missing dates; partial snapshots update only present
dates and retain the greater prior total when a partial subtotal is lower. Complete corrections may
decrease values, including complete per-day entries carried by an otherwise partial snapshot.
Protocol v3 added per-day completeness; the server continues to accept legacy v2 snapshots. Protocol
v4 orders a failed collector's allowlisted `collector_failed` code with the last server-accepted
source sequence known before collection. The server persists that error only when the sequence still
matches; delayed errors are counted as stale and ignored, while v2/v3 errors without ordering
metadata are accepted on the wire but never overwrite persistent status. Raw errors, content, and
paths are never part of the protocol. The server validates canonical decimal strings, source
ownership, body/range limits, and token components, then uses bulk JSON-to-recordset SQL in one
transaction.

The server reports `lastAcceptedSyncSequence` during pairing, installation inspection, and usage
responses. Connect, doctor, and sync reconcile the local value with the server maximum. A stale
pending snapshot is rewritten to `server + 1` and retried once; there is no unbounded sequence loop.

Accepted updates rebuild only affected `(user, agent, UTC week)` rows in `weekly_agent_usage`.
Leaderboard and public profile reads use this compact table. Within an account, account-wide sources
use only complete observations tied at the newest complete `updated_at`, plus provisional
observations accepted later than that boundary; a later complete observation excludes every older
complete and provisional row and may correct the value down. If no complete observation exists,
every provisional row is eligible. Machine-local sources use daily `sum`; different accounts and
agents sum. Dashboard components for an account-wide day are selected conservatively from the
largest complete local component total. They are hidden for that day if equally large rows contain
more than one distinct tuple. The dashboard identifies a local component sum that differs from the
separate provider account total.

## Reliability and lifecycle

Collectors run independently with concurrency four. The first run reads at most the required 31 UTC
days within explicit file/count/byte bounds. Later JSONL runs reuse size, mtime, inode, and the last
complete byte offset; unchanged files are not reopened for content, appends resume, truncation or
replacement rereads only that file, and disappeared files leave the index. OpenCode's read-only SQL
is range-bounded. Non-Codex observations feed a shared content-free ledger keyed by hashed event
identity; date, exact token tuple, and parser version survive local record deletion or copying for
the 31-day window. One Codex App Server is started per physical profile per batch. It reads the
ChatGPT account before and after usage without refreshing credentials and routes the snapshot only
to the matching local logical source. Its official daily total remains authoritative; the connector
incrementally extracts only cumulative token events from that profile's local session records, uses
the exact last-call counters, removes cache/reasoning overlap, and deduplicates repeated or copied
events with content-free hashes. The provider's account-wide daily total and the locally observed
component sum remain separate exact counters. While account buckets lag, each exact local daily sum
after the newest authoritative bucket is submitted as partial so Sync can update the ranking
immediately across UTC rollovers. The source remains non-destructive until an authoritative bucket
covers the current day. Inside a continuous, successfully read App Server range, a missing daily
bucket is sent as an explicit complete zero so prior usage can be corrected; no zero is created for
an incomplete result or beyond that proven range. Later complete account data corrects each
provisional value. Missing, bounded, or changed transcript shapes otherwise degrade to total-only
rather than an estimate. Component counters are suppressed once a physical profile contains multiple
identities because those local records do not prove account ownership.

Owned hook handlers carry `viberacing-hook-v3:<clientSourceId>` and pass the same stable physical
local source ID to `viberacing hook`. Removal filters only that marker, preserving foreign hooks and
other Vibe Racing profiles. Logical Codex account sources never install another hook. Connect and
`doctor --repair` reconcile active mappings to current hooks, remove hooks for known unmapped
sources, and replace the one legacy v2 marker. A hook discards stdin, updates its entry in the
version-2 `dirty.json` ledger under a short read-modify-write file lock, claims one scheduler lock,
and exits with the provider's minimal response. Entries contain only source UUID, timestamps, and a
generation—never a path or account label.

Codex uses `Stop`, which runs after each completed turn; upgrades remove only the connector-owned
legacy `SessionEnd` handler. Its command points to an atomically refreshed stable launcher, which
selects the explicitly installed versioned runtime. Codex still requires the user to review and
trust the non-managed hook once; the connector reads the official `hooks/list` status for diagnosis
but never writes trust state or bypasses that boundary. The hook still performs no collection
itself. Other providers keep the documented lifecycle event supported by their current release.

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

The optional browser path is an on-demand OS protocol launch, not another service. A browser paired
to an active installation receives an independent short-lived grant; `viberacing://sync` starts the
installed runtime, which authenticates with its existing device token and claims either the active
source IDs for one agent account or every active source ID on that installation. The connector
applies the normal single-flight and snapshot rules to only those server-authorized IDs, posts an
allowlisted completion status, and exits. Installation-wide claims require a separately reported
installed runtime and installed-handler protocol; ordinary CLI version reconciliation cannot enable
them. Successful default-state connect or repair stores a random pending handler attestation locally
before contacting the server. The connector repeats that exact installed version/protocol statement
until the server acknowledges its ID, and later OS inspection can attest a downgrade or removal. The
server never pushes work and the connector never polls for browser requests. Claim creation is
serialized on the installation row: an active run and a 60-second installation-wide cooldown both
reject a second claim before connector work starts. Dashboard result polling backs off from two to
five seconds after a claim and has a separate authenticated per-user quota. A rejected duplicate
claim stores only a terminal `busy` result under its opaque request ID so the originating dashboard
stops polling promptly; these rejected rows do not extend the installation cooldown. Pairing
enforces the protocol-wide maximum of 32 active sources per installation; an oversized legacy
installation does not expose the all-agent action or consume a grant. Account-scoped runs retain
their account owner, while an installation-scoped run is owned only by the installation and survives
deletion of any one account.

The connector owns only registrations marked with `viberacing-browser-handler-v1`. Linux uses an XDG
desktop handler, Windows uses an owner-marked per-user registry key, and macOS uses a signed
AppleScript applet whose `open location` handler receives the LaunchServices URL event. macOS
replacement is staged beside the target app, validated and signed before an atomic swap, and rolls
back the prior owned app if registration fails. Foreign handlers are never overwritten. Connect and
`doctor --repair` point each owned handler at the current versioned runtime; custom state roots do
not mutate the normal user's global handler.

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
additional computers cannot multiply the user-wide request budget. Pre-authentication endpoints
first consume an atomic global admission bucket and create a canonical client bucket only while that
global capacity remains. IPv6 clients share a canonical `/64`, IPv4-mapped IPv6 shares its IPv4 key,
and PostgreSQL stores only the digest. Expired bucket cleanup is bounded, best-effort, and started
at most once per minute per web process; an edge WAF remains the separate protection against a
genuinely distributed attack. Browser login is also serialized per user, rotates the current browser
token, and retains at most ten active 30-day sessions per user. OAuth and pairing apply
pre-authentication limits only when the deployment exposes a trusted client address; shared global
buckets are reached only after OAuth state or browser-session and per-user validation, so anonymous
traffic cannot consume the authenticated work budget.

`/health` is process liveness. `/ready` validates production configuration, PostgreSQL, required
tables, and the presence of the latest required migration; later ledger rows remain ready. Small
opportunistic cleanup batches remove expired sessions/pairings, rate-limit buckets, old empty
revoked installations, and orphaned empty root accounts. Hidden aliases are retained while their
automatic match is active; superseded unreferenced aliases become eligible for normal cleanup.

HTML responses use a fresh request nonce for framework scripts and styles. The production CSP never
allows unsafe inline script or style execution; development permits only the eval support required
by React diagnostics. API, health, readiness, and static-asset responses do not need an HTML CSP.
