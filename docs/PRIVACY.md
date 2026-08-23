# Privacy

Vibe Racing sends only the data needed to compute a self-reported ranking.

During pairing the connector sends protocol/connector versions, a random installation identity and
proof, opaque client source IDs, agent IDs, allowlisted collection methods, supported surface, and a
neutral agent/profile label. Automatically discovered labels contain only the agent name and, when
needed, a neutral profile ordinal; they never contain a provider filename or path component. Random
source IDs remain stable in local `sources.json`. On upgrade, an old OpenCode filename-derived label
is replaced only when it exactly matches the connector's former automatically generated value;
user-defined labels are preserved. The legacy value is never included in a pairing request.
Normalized local data roots, executable paths, hook config roots, and their hashes are never copied
into pairing config or requests. During sync it sends a server source ID, sequence, UTC range,
complete/partial status, UTC dates, aggregate total tokens, and optional aggregate
input/output/cache/reasoning counters. If collection fails, it may instead send the fixed
`collector_failed` diagnostic code and source ID; exception messages are kept local.

For account-wide agents, the server may compare already stored complete daily totals from the last
30 finished UTC days. Two exact nonzero days with no conflicting overlap can automatically map two
computer sources to one logical account. The decision stores opaque source/account IDs and the
number of matching days, not the daily values themselves, and can be undone from the dashboard. No
email, username, account ID from the provider, or derived email fingerprint is used. The source also
retains the timestamp of an automatic match or later explicit reassignment, preventing a background
match from overriding that decision after temporary Undo metadata is cleaned up.

It never sends prompts, responses, transcript content, code, tool arguments, repository names, local
paths, hostnames, provider emails/usernames, provider credentials, API keys, model names, costs, or
monetary/request metrics. Raw session stores can contain sensitive content, so adapters extract
usage locally and discard every other field. The Codex component pass examines local session JSONL,
retains only `token_count` cumulative counters and per-day aggregates in local connector state, and
uses provider-recorded last-call counters for exact local components. Those local components may
have a different sum from the separate account-wide App Server daily total; both remain aggregate
counters, and the dashboard identifies the scope difference. It never retains or transmits any other
transcript field. The Antigravity wrapper passes native output through to the terminal and persists
only the stable event ID, UTC date, and exact token counters needed for deduplication. Capture
records older than 35 days are removed after a successful sync and large files are rewritten
atomically with the same allowlist. `source add` requires an explicit label and never derives
network metadata from the local data-root path. Each capture profile is keyed by its random client
source ID, not an account label, provider identity, or agent name. Multiple Antigravity accounts
therefore remain in separate local files.

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

GitHub OAuth requests `read:user`. The access token is used once to obtain immutable GitHub ID and
current handle and is not stored. Browser, installation, poll, and device secrets are SHA-256 hashed
in PostgreSQL. Local Vibe Racing directories are owner-only; secrets/config files are `0600` and the
installed executable is `0700`.

Public pages expose GitHub handle, current UTC-week rank, total, and agent breakdown. They do not
expose daily data, account labels, source/installation details, or credentials. Local data is under
the user's control, so the leaderboard is explicitly self-reported and grants no authorization,
reward, or access.

Browser sync stores only an installation capability, independently hashed five-minute grants, opaque
account and request IDs, and an allowlisted run status for bounded cleanup. The custom URL has no
label, path, provider identity, usage total, or session content. A grant is insufficient without the
connector's device token, and a handler claim can return only active source IDs already mapped to
that account on the same installation.

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
