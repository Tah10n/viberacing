# Privacy

Vibe Racing sends only the data needed to compute a self-reported ranking.

During pairing the connector sends protocol/connector versions, a small installed browser-handler
protocol/capability value, a random installation identity and proof, opaque client source IDs, agent
IDs, allowlisted collection methods, supported surface, and a neutral agent/profile label.
Automatically discovered labels contain only the agent name and, when needed, a neutral profile
ordinal; they never contain a provider filename or path component. Random source IDs remain stable
in local `sources.json`. On upgrade, an old OpenCode filename-derived label is replaced only when it
exactly matches the connector's former automatically generated value; user-defined labels are
preserved. The legacy value is never included in a pairing request. Normalized local data roots,
executable paths, hook config roots, and their hashes are never copied into pairing config or
requests. Compact installation reconciliation sends the version of the one-off CLI process and the
already assigned server source IDs. A successful default-state `connect` or `doctor --repair`
separately records a random attestation ID, the installed runtime version, and the protocol observed
from the owned OS handler. That closed attestation remains in owner-only local state and is retried
after later connector contacts until the server acknowledges the same ID. Later contacts also report
a safe protocol downgrade or handler removal discovered from the OS registration. They never infer
an installed update from the version of a newer `npx` process. Legacy connectors may omit these
reports. During sync it sends a server source ID, sequence, UTC range, snapshot status, UTC dates,
aggregate total tokens, and optional aggregate input/output/cache/reasoning counters. Protocol v3+
may also mark an individual UTC date complete or partial. Protocol v5 adds only a fixed rolling or
current-year-history kind and, on the final January chunk, a fixed `complete` or `partial` year
status. Responses may add only nullable UTC start/end bounds for a durable missing-date gap. The
resumable year, next range end, partial bit, and isolated adapter checkpoint stay in owner-only
local state; the server stores only aggregate unresolved UTC dates, and no filename, provider
identity, or content is added. The server still accepts v2-v4 payloads. If collection fails, v4+ may
instead send only the fixed `collector_failed` code, source ID, and the last server-accepted
sequence known before collection. That ordering value is an opaque canonical counter, not local
content. Delayed errors are ignored; legacy v2/v3 errors are accepted but cannot overwrite
persistent status. Exception messages are never sent.

Operational diagnostics use a separate authenticated endpoint and never change whether a usage
snapshot is accepted. A diagnostic request contains only schema and connector versions plus up to 32
events. Each event contains a server source ID, an allowlisted machine code, an allowlisted phase
(`collect`, `sync`, or `deliver`), and an `opened` or `resolved` state. The server verifies every
source belongs to the authenticated installation, derives the agent ID itself, and logs no source,
installation, user, provider, rollout, thread, or session identifier. Diagnostic logs also contain
no message, stack trace, filename, path, command, environment value, prompt, response, transcript,
or other agent-store content.

The connector keeps only active code keys and pending state transitions in its owner-only local
state. An unchanged failure produces no event; disappearance produces one `resolved` event. The
bounded outbox is retried after a later successful contact. Diagnostic delivery is best-effort: a
missing, unavailable, or rejecting diagnostic endpoint cannot fail usage sync and cannot generate a
recursive diagnostic. Delivery is at-least-once: if the server writes an event but its response is
lost, the connector may retry the same allowlisted transition. This can duplicate only the same safe
structured event and does not add raw diagnostic data. The original `collector_failed` source error
remains in usage sync for dashboard compatibility.

For account-wide agents, the server may compare already stored complete daily totals from the
current UTC year plus the prior-year part of the rolling 30-day boundary. Seven exact nonzero days
spanning at least a week and containing three distinct positive totals, with no conflicting complete
overlap, can automatically map two computer sources to one logical account. Partial and zero days
are not evidence. The decision stores opaque source/account IDs and the number of matching days, not
the daily values themselves, and can be undone from the dashboard. No email, username, account ID
from the provider, or derived email fingerprint is used. The source also retains the timestamp of an
automatic match or later explicit reassignment, preventing a background match from overriding that
decision after temporary Undo metadata is cleaned up.

It never sends prompts, responses, transcript content, code, tool arguments, repository names, local
paths, hostnames, provider emails/usernames, provider credentials, API keys, model names, costs, or
monetary/request metrics. Raw session stores can contain sensitive content, so adapters extract
usage locally and discard every other field. The Codex component pass examines local session JSONL,
retains only `token_count` cumulative counters and per-day aggregates in local connector state, and
uses provider-recorded last-call counters for exact local components. Those local components may
have a different sum from the separate account-wide App Server daily total; both remain aggregate
counters, and the dashboard identifies the scope difference. While account buckets lag, every exact
local daily aggregate after the newest authoritative bucket is sent as a partial ranking value and
is later corrected by complete account data. Within a successfully read continuous App Server range,
an absent day is represented by an explicit complete zero; it carries no content and is an
authoritative correction marker rather than an inferred usage value. No zero is generated for an
incomplete result or beyond the proven range. These remain date-level aggregate counters; it never
retains or transmits any other transcript field. The Antigravity wrapper passes native output
through to the terminal and persists only the stable event ID, UTC date, and exact token counters
needed for deduplication. Capture records older than 35 days are removed only when their exact
capture prefix, byte boundary, and date range are bound to an acknowledged payload and revalidated
under the capture lock; public Antigravity history can still remain partial. Appended or malformed
suffixes, changed prefixes, replaced/truncated files, and unsafe collections retain the capture for
repair. Acknowledged cleanup repeats after later successful Sync, is retried after a crash, and is
best-effort per source. Large files are rewritten atomically with the same allowlist. `source add`
requires an explicit label and never derives network metadata from the local data-root path. Each
capture profile is keyed by its random client source ID, not an account label, provider identity, or
agent name. Multiple Antigravity accounts therefore remain in separate local files.

For Codex ChatGPT logins, the connector reads the size-bounded, non-symlinked `CODEX_HOME/auth.json`
before starting App Server, retains only `tokens.account_id`, brackets usage with two
generated-contract `account/read` calls, and reads the local ID again afterward. Both local IDs and
both normalized, non-null App Server emails must match. The whole bounded auth JSON is parsed in
process memory; JWT, access token, and refresh token values are never persisted, logged, hashed, or
transmitted. Unix builds additionally require current-user ownership and no group/world file
permissions; this document does not claim an equivalent Windows auth-file ACL validation. A missing
or changing ID/email fails closed with guidance to use a separate `CODEX_HOME`. The accepted values
are discarded after deriving an `acct1_…` HMAC under a separate random local salt. That salt
survives `reset-installation` so reconnecting cannot manufacture duplicate logical accounts. The
HMAC stays only in owner-readable `sources.json`; email, account ID, and HMAC are excluded from
`config.json`, pairing, dynamic registration, usage, diagnostics, terminal output, and server logs.
Dynamic registration sends only the new random client source UUID, the approved physical profile
client UUID, and fixed Codex agent/method/surface metadata. The server validates those fixed fields
and derives the user and aggregation mode inside a user- and installation-locked transaction. It
reuses the canonical logical account for the same user, agent, and stable client source UUID across
reset installations. No provider identity or fingerprint is stored server-side.

This contract supports only file-backed `CODEX_HOME/auth.json` identity. Keyring-only and ephemeral
identity are currently unsupported. Separate `CODEX_HOME` guidance applies only when every profile
has its own readable auth file and must not be presented as a fix for keyring-only state. The
connector does not access an OS keyring directly; such access requires a separate security design
before implementation.

Claude, OpenCode, Kimi, Qwen, Gemini, and captured Antigravity contribute to a local observed-event
ledger containing only a SHA-256 event key, UTC date, exact aggregate token tuple, and parser
version. Raw provider IDs, filenames, models, and record bodies are not retained. Ledger entries are
limited to the requested rolling or historical range and bounded by count and serialized bytes;
historical state is isolated from rolling incremental state. Entries intentionally survive file
deletion, movement, copying, and current-database cleanup within the retained range so already
observed usage is not silently subtracted; duplicate copies collapse to the same hash. If one
identity appears with a different tuple, the original tuple wins and only the allowlisted
`local_event_identity_conflict` diagnostic is emitted.

Qwen `.env` files are parsed locally for its two routing variables and names explicitly referenced
by `advanced.runtimeOutputDir`. Unreferenced values are discarded immediately; no environment value
is saved in connector state, diagnostics, pairing, or sync payloads.

Hook stdin can contain private provider context. The hook reads it to EOF only because provider
contracts require that, then discards it without parsing, logging, or persistence. Hooks never scan
history or access the network. Their dirty ledger contains only stable local source IDs, UTC event
timestamps, and random generations; it contains no paths. Automatic collection happens later in a
short-lived process, scans only dirty active sources, and sends nothing when the normalized
aggregate snapshot is unchanged. Saved pending aggregates can be delivered without rereading any
provider store.

The generated OpenCode plugin does not receive a Vibe Racing payload and never reads plugin context.
It inspects only the public idle event shape (`type`, `properties.status.type`) and does not access
`sessionID`, message IDs, project/worktree/directory values, prompts, responses, code, models, or
credentials. It launches the stable local connector with a fixed installation UUID and a minimal
allowlisted environment. Environment names are filtered before their values are read, so OpenCode
and project variables, `PWD`, `NODE_OPTIONS`, and provider keys are neither materialized by the
plugin nor passed to the child. The absolute state path, recorded plugin path, and ownership hash
remain local and are never included in diagnostics or network requests.

GitHub OAuth requests `read:user`. The access token is used once to obtain immutable GitHub ID and
current handle and is not stored. Browser, installation, poll, and device secrets are SHA-256 hashed
in PostgreSQL. Local Vibe Racing directories are owner-only; secrets/config files are `0600` and the
installed executable is `0700`.

Public pages expose GitHub handle, selected UTC-period rank, total, and agent breakdown. Week,
Month, current-year All time, and current-year Custom views all read aggregate daily summaries; they
do not expose daily source data, account labels, source/installation details, or credentials. Local
data is under the user's control, so the leaderboard is explicitly self-reported and grants no
authorization, reward, or access.

Browser sync stores only an installation capability, independently hashed five-minute grants, an
opaque request ID, a closed account/installation scope, an optional opaque account ID for
account-scoped runs, and an allowlisted run status for bounded cleanup. The custom URL has no label,
path, provider identity, usage total, or session content. A grant is insufficient without the
connector's device token, and a handler claim can return only active source IDs already mapped to
the selected account or installation.

Disconnecting an installation or source revokes future ingestion but retains its history. Deleting
an agent account deletes its sources and usage. **Leave leaderboard** deletes all usage and revokes
installations while retaining the GitHub identity and empty account labels. **Delete Vibe Racing
account** deletes the user and all dependent data and clears the browser session.

Removing a local source deletes its owned hook before discarding the custom-root metadata needed for
cleanup. If the server is unreachable, local automatic activity still stops and the CLI reports that
remote disconnect was not confirmed. A server-retired source keeps its local definition for a later
reconnect but loses its hook and automatic runtime state at the next connector contact.

The repository privacy guard rejects known local stores, telemetry, captures, databases, dumps,
credentials, and fixtures containing content/path/tool fields. Fixtures are synthetic usage-only
records.
