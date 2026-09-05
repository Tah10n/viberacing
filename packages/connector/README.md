# Vibe Racing connector

The Node 24 LTS connector collects exact aggregate token counters from supported coding-agent
sources and pairs them with Vibe Racing agent accounts. It never uploads raw sessions or local
paths.

```bash
npx --yes @viberacing/connector@latest connect --origin https://viberacing.up.railway.app
```

Use the exact command shown by your Vibe Racing dashboard. The official service uses the npm command
above. Self-hosted deployments default to an equivalent versioned archive served by that same Vibe
Racing origin, so they do not depend on the public npm registry. Neither path installs a global npm
package; the connector saves its working copy only in local Vibe Racing state. Re-running `connect`
is safe.

For Codex, open Codex CLI after connecting, run `/hooks`, inspect the Vibe Racing `Stop` command,
and trust it. `doctor` reports `codex hook: current` when automatic Sync is ready. Until that
one-time review is complete, manual Sync remains available but the hook cannot run after a completed
turn. A full uninstall and reconnect creates a new source identity and requires a new review;
routine `doctor --repair` preserves the stable trusted command identity.

For OpenCode, `connect` installs one global plugin file owned by this Vibe Racing installation under
`$XDG_CONFIG_HOME/opencode/plugins` (default `~/.config/opencode/plugins`, including on Windows).
Restart OpenCode once after the connector reports that the plugin was created or updated. The
primary trigger is `session.status` with `status.type === "idle"`; `session.idle` is a two-second
process-local deduplicated fallback. The plugin starts the stable local launcher and returns
immediately. It never reads or forwards a session ID, prompt, response, code, model, project path,
working directory, or other event payload.

Refresh the installed runtime and repair owned hooks explicitly:

```bash
npx --yes @viberacing/connector@latest doctor --repair
```

Remove an installation and its owned local integration:

```bash
npx --yes @viberacing/connector@latest uninstall
```

These are permanent `@latest` commands; a concrete version is never copied into onboarding. The
installed runtime does not update silently. A self-hosted archive dashboard generates corresponding
same-origin repair and uninstall commands.

Discovery is independent of the directory where the command runs. Provider data comes only from
documented token-store roots, supported environment overrides, Qwen's user-level settings, and roots
explicitly saved with `source add`. Finding an executable does not create a ranking source. When an
exact source needs an executable, the resolver can use `PATH`, installed application roots, and
common package-manager locations. Portable installations can set `VIBERACING_CODEX_BIN` or
`VIBERACING_ANTIGRAVITY_BIN` to an absolute executable path. One resolved override is saved only in
local `sources.json`, so later processes do not require the variable again. Windows npm
`.cmd`/`.bat` shims are launched through `ComSpec` with escaped arguments. One broken source adapter
is reported as a detection warning and never hides other healthy sources. Discovery never scans the
whole home directory or disk.

The browser approval maps machine-local sources to a new or existing account. Account-wide sources
are matched automatically only after enough complete daily totals arrive: the server requires seven
exact finished nonzero days spanning at least a week, containing three distinct positive totals and
no conflicting complete overlap. It never uses provider identity, partial days, or zero days as
matching evidence, and the dashboard offers Undo. Re-running `connect` keeps the stable installation
identity, rotates device authorization, refreshes the installed connector copy, and updates only
Vibe Racing-owned hooks. Hook reconciliation is best-effort per source: one damaged settings file is
reported without blocking healthy hooks or the initial sync. The final token/config swap is
serialized behind any active sync, so an older request cannot restore superseded authorization.

## Commands

```text
viberacing connect [--origin URL]
viberacing sync [--full]
viberacing doctor [--repair]
viberacing accounts
viberacing source list
viberacing source add --agent opencode --name Work --data-dir <path>
viberacing source add --agent kimi_code --name Archive --data-dir <path> --legacy
viberacing source add --agent qwen_code --name Work --data-dir <runtime-root>/usage
viberacing source add --agent antigravity --name Personal
viberacing source remove <client-source-id>
viberacing disconnect
viberacing uninstall
viberacing reset-installation
viberacing run cursor [--source <client-source-id>] -- <native Cursor agent arguments>
viberacing run antigravity [--source <client-source-id>] -- <native agy arguments>
```

The Cursor wrapper requires a connected profile with current stop/sessionEnd hooks. It adds
`--print --output-format stream-json` when absent and rejects a conflicting output format. Set
`VIBERACING_CURSOR_BIN` to a safe absolute executable path when automatic lookup is insufficient.
Arguments and provider stdout/stderr remain unchanged; exact usage is committed only for a
successful final result paired with its authenticated sessionEnd. The result's first capture time
determines the UTC date. Direct headless runs outside this wrapper are not guaranteed to be counted.
Cursor 0.7.0 support remains under validation in the Draft implementation; see
[the evidence and remaining gates](../../docs/CURSOR_EVIDENCE.md).

Cursor Desktop and interactive CLI use the same owned `~/.cursor/hooks.json` profile (Windows:
`%USERPROFILE%\.cursor`). Discovery accepts a safe existing root or a verified official `agent`
executable; it creates no files. Connection installs additive stop/sessionEnd hooks, preserving
foreign commands. Account identities are converted immediately to local HMACs. The first account
uses the physical source, later accounts use stable logical sources, and returning to A reuses A.
Desktop A and CLI A share a source; Desktop A and CLI B remain separate. Assign sources on another
computer to the same account explicitly; the server adds their machine-local events.

Capture starts after hook installation. Each event keeps its first capture timestamp and UTC day,
including a final headless result whose sessionEnd arrives later. This is capture time, not provider
time. Reasoning is already in output, and subagents are already in the aggregate result. Missing
counters/identity, unsupported schemas/versions, aborts and incomplete pairs fail closed. Direct
`agent --print` outside the wrapper, Tab, Bugbot, Cloud Agents and SDK usage are not guaranteed.
Current-day and pre-capture history remain partial; completed past days require intact observed hook
intervals. `sync --full` reads only available captures and cannot recover pre-install history.

`doctor` shows both hook states, last captured versions, account count, pending pairs and coverage;
`doctor --repair` restores only owned hooks while retaining events and gaps. Reset keeps identity
salt and durable event reservations. A newly paired server source cannot replay events already
reserved to an earlier source, including an unknown earlier upload outcome; this can leave coverage
partial. Do not copy Cursor ledgers between computers. Their integrity proof rejects replacement and
truncation even after sync cache reset. ACK-driven compaction preserves exact events and the
unacknowledged suffix. The 8 MiB bound fails closed rather than discarding unknown history.

`connect` also registers a per-user `viberacing://` handler on macOS, Windows, and Linux when the
default state directory is used. The dashboard uses it only after that browser approved the same
installation. A click starts the installed connector copy, claims a short-lived device-authenticated
grant, and syncs either the selected account's sources or every active agent on that computer. The
all-agent control appears only after `connect` or `doctor --repair` confirms a compatible installed
runtime and handler. That confirmation is saved locally before the network request and retried on
later connector contacts until the server acknowledges it. Running a newer package once with `npx`
reports only that CLI version and does not claim that its runtime was installed. Later OS inspection
also retracts the capability if the owned handler is downgraded or removed. The connector reports a
safe result code and exits. Custom state roots continue to use `viberacing sync` and never replace
the global handler.

`source add` works before the first connection. A random `clientSourceId`, normalized local root,
collection method, surface, and user-provided safe label are stored only in local `sources.json`.
Pairing configuration contains the server mapping but never a path or path hash. A Codex profile may
bind up to eight locally distinguished ChatGPT accounts. Each App Server launch gets that profile's
`CODEX_HOME`. Before starting App Server, the connector reads local `tokens.account_id`; the server
then performs `account/read` (with `refreshToken: false`), `account/usage/read`, and the same
account read again, followed by another local ID read. The generated App Server contract validates
the ChatGPT response (`email` and `planType`). Both local IDs and both normalized, non-null emails
must match. The bounded, non-symlinked auth file is read and parsed in process memory, but only
account ID is retained from it; credentials are never persisted, logged, hashed, or transmitted.
Unix builds also require the auth file to be owned by the current user with no group/world
permissions; Windows does not claim an equivalent auth-file ACL check. A changed identity gets one
bounded retry; API-key, Bedrock, identifier-unavailable, and unstable states fail closed with
guidance to use separate `CODEX_HOME` roots. The local `acct1_…` HMAC is derived from the accepted
normalized email plus account ID and a separate random salt that survives `reset-installation`; it
is never serialized into `config.json` or a request. Unknown stable identities are registered as
numbered, generic `Codex account` sources using only opaque source UUIDs and fixed Codex source
metadata. The App Server daily total remains authoritative. A local incremental pass extracts only
cumulative `token_count` events from that profile's session files, uses provider-recorded
`last_token_usage`, removes cache/reasoning overlap, and deduplicates repeated/copied events with
content-free hashes. The account-wide total and locally observed component sum remain separate exact
counters and may differ. While App Server account buckets lag, Sync submits every exact local daily
sum after the newest authoritative bucket as a partial ranking value, including across UTC
rollovers. Later complete account data can correct each day in either direction. A successful App
Server result also materializes every UTC date between its earliest and latest returned buckets: a
missing bucket is sent as an explicit complete zero, which is an authoritative correction marker
rather than an estimate. The connector never extends zero coverage before the earliest returned
bucket or after the latest one. Local components are omitted when a physical profile has two or more
logical accounts; the dashboard labels that shared profile instead of attributing components across
identities. Every other transcript field is discarded, and unsupported or incomplete shapes remain
total-only.

Codex identity support is intentionally limited to a file-backed `CODEX_HOME/auth.json`. A login
whose stable identity exists only in an OS keyring or ephemeral process state is not supported yet
and fails closed. Separate `CODEX_HOME` roots help only when each root has its own readable,
file-backed `auth.json`; they do not repair a keyring-only login. The connector does not read the OS
keyring directly. Adding that capability requires a separate security design covering platform APIs,
access control, lifetime, redaction, and account-switch races.

Claude, OpenCode, Kimi, Qwen, Gemini, and captured Antigravity usage use a common range-aware
observed-event ledger. It stores only a SHA-256 event key, UTC date, exact token tuple, and parser
version, with explicit count and byte bounds. Rolling and historical adapter state are isolated, so
a current-year backfill cannot change rolling fingerprints, diagnostics, or incremental offsets.
Observations survive local file deletion, movement, copying, and database-row cleanup within the
retained range; copies deduplicate. Reusing one event identity with different counters keeps the
first tuple, marks the snapshot partial, and emits `local_event_identity_conflict`.

Current Kimi discovery prefers `$KIMI_CODE_HOME` (default `~/.kimi-code`) and does not automatically
add the default legacy `~/.kimi` when both exist. A deliberately retained or archived Python-format
root can be added with `source add ... --legacy` without re-enabling automatic double counting. On
an approved migration, the server disconnects the superseded legacy mapping and removes its
duplicated ranking rows before the current source performs its first sync. An abandoned pairing
leaves both the local legacy source and its server history unchanged.

Capture-based Antigravity sources do not require `--data-dir`. Their default local path is
`captures/<clientSourceId>.jsonl`, so Personal and Work accounts never share a capture file. The
wrapper selects its only matching source automatically; with multiple profiles, `--source` is
required and is consumed by Vibe Racing rather than passed to the native CLI. The first wrapper run
creates one default source when none exists.

OpenCode enumerates only names matching `opencode.db` or `opencode-<channel>.db` inside the official
data root, plus `OPENCODE_DB` (absolute or relative to that root). Every candidate must expose the
compatible `message(id,time_created,data)` schema in read-only SQLite mode. Existing installations
with accepted OpenCode usage must run one successful connector 0.4.4 Sync before 0.5.0. Version
0.4.4 keeps aggregate snapshot semantics but confirms content-free hashes of the exact accepted
message-ID set; 0.5.0 refuses a direct 0.4.3 migration rather than silently losing an unsynced tail.
For every unmigrated OpenCode source, the confirmed sequence must exactly equal the maximum found in
the server mapping stored in `config.json`, runtime `state.sequences`, every pending snapshot, and
any unfinished 0.4.4 cutover attempt. Preflight streams only the selected source fields and accepts
a large aggregate `state.json` assembled from individually bounded ledgers. A pending OpenCode
snapshot is never delivered by 0.5.0 before that proof is current. Source changes, reset, connect,
manual/automatic/browser Sync, doctor/repair, hooks, Antigravity metadata writes, reconciliation,
and schema migration all check before mutation; lock-owning paths check again after exclusion to
catch a stale runtime that finishes between checks. Qwen chooses exactly one automatic runtime root
in this order: `QWEN_RUNTIME_DIR`, `advanced.runtimeOutputDir` from the user-level settings,
`QWEN_HOME`, then `~/.qwen`. Its JSONC settings support comments plus `$VAR`, `${VAR}`, and tilde
expansion. `QWEN_HOME`, `QWEN_RUNTIME_DIR`, and only variables referenced by `runtimeOutputDir` are
read from the official user-level `.env` candidates with dotenv-compatible quotes and inline
comments; unrelated values are discarded. Relative values are not resolved from the connector's CWD;
`doctor` prints the explicit `source add` command instead. The runtime root and Qwen config root are
stored separately, so tokens come from `<runtime-root>/usage` while the additive `SessionEnd` hook
always lives in `<QWEN_HOME>/settings.json`. Hook edits retain unknown settings and comments outside
the changed `hooks` subtree. In Qwen Code 0.21.12, that hook fires on interactive TUI exit and is
wired into ACP, but the headless `qwen -p` runner does not emit `SessionEnd`. Headless runs still
write exact usage records; run `viberacing sync`, or wait for the next supported lifecycle event, to
collect them. Qwen's cached count is already included in input and its thoughts count is already
included in output, so the connector subtracts both overlaps before sending the five exact component
fields.

At an OpenCode idle event, the installation-owned plugin invokes the stable launcher with the
installation UUID and no OpenCode context. One atomic dirty-ledger update selects the intersection
of active server mappings and existing local OpenCode sources, so every mapped `opencode*.db` for
that installation is checked together. The existing scheduler still provides single-flight,
15-second debounce, two-minute cooldown/maximum delay, and fingerprint suppression. Unchanged
profiles therefore send no new usage payload. A crash or kill before idle is covered by the next
idle event or manual `viberacing sync`; no daemon, watcher, or OpenCode polling is installed.

### Teardown commands

`disconnect` and `uninstall` are explicit teardown operations and intentionally remain available
when the OpenCode migration guard blocks ordinary recovery-state changes. `disconnect` attempts
remote revocation and always removes owned hooks, the device token, dirty and scheduler state, and
pending automatic uploads locally—even while offline—while preserving stable local source
identities. Lifecycle removal commands serialize with an active sync before revoking or deleting
state. `uninstall` removes every cleanable owned hook even if another profile is damaged; on a
partial failure it removes network credentials but retains source/root metadata and the small
installed runtime so an ordinary repeated `uninstall` can finish safely. Provider data and foreign
hooks are untouched. Run `uninstall` once for every connector installation. If an installation used
`VIBERACING_STATE_DIR`, set it to the same value when uninstalling; the command refuses to report
success when the selected state directory contains only a state marker or no substantive
installation metadata, connection attempt, browser-handler record, or installed runtime. They also
remove only the strictly owned OpenCode plugin. Initial and replacement publication is exclusive.
Updates and teardown quarantine the public entry first and verify the same inode and bytes through
an open file handle before deleting anything. A raced foreign regular file is restored without
replacement; a raced non-regular entry is preserved at the error's recovery path. Foreign, linked,
ACL-unsafe, or newer-schema plugins are never overwritten or deleted. The exact installed plugin
path is kept only in owner-only `installation.json`, so cleanup still reaches the verified old
location after `XDG_CONFIG_HOME` changes. Teardown still removes authorization and local secrets,
while the stale installation guard makes any already-loaded plugin event a no-op.
`reset-installation` is not teardown: it is the explicit escape hatch for creating a new
installation identity. It remains blocked byte-for-byte while accepted OpenCode history lacks a
current confirmed 0.4.4 cutover, so deleting config/state cannot bypass the 0.5.0 migration gate.

State lives under `VIBERACING_STATE_DIR` (default `~/.viberacing`): `installation.json`,
`sources.json`, `config.json`, `state.json`, one compact pending snapshot and safe diagnostic per
source, hook diagnostics, the installed executable/library, usage-only CLI captures, local Codex
`acct1_…` bindings, and content-free observed-event ledgers. Diagnostic state contains only
allowlisted code keys plus pending `opened`/`resolved` transitions; it never stores exception
messages, stack traces, paths, commands, environment values, or agent content. Its bounded
owner-only outbox retries after a later successful server contact, independently of usage
acceptance. Delivery is at-least-once: a lost successful response can cause the same allowlisted
transition to be retried, so local deduplication is not an exactly-once server-log guarantee.
Pending usage records are uploaded in bounded batches without forcing another collector scan. A
source already disconnected on the server loses its mapping, pending/runtime state, dirty entry, and
owned hook without deleting its local definition or blocking other agents. Directories are
owner-only where the OS supports permissions; secrets are `0600`. `doctor` is read-only and reports
local plugin/hook freshness, mapped accounts, supported surfaces, excluded desktop surfaces, data
availability, partial warnings, and the last unresolved hook error. A fully successful authenticated
usage delivery clears that hook error; partial syncs and automatic checks that send no usage request
retain it. A successful initial pending retry counts as that delivery even when the following
automatic collection is unchanged. `doctor --repair` refreshes the installed runtime, owned hooks,
the OpenCode plugin, and the default-state browser protocol handler under the lifecycle lock. Its
pending handler attestation survives a failed reconciliation and is repeated by a later normal
contact until the server acknowledges the same random ID. Server reconciliation shares the sync
lock, and it does not collect usage unless the user separately runs `viberacing sync`. A successful
compatible reconnect, authenticated sync, or doctor server check clears a prior version-upgrade
automatic-sync disable.

Connector 0.6.0 uses protocol v5. Every snapshot explicitly identifies a rolling or current-year
history kind, while history chunks remain bounded to 31 inclusive UTC dates and a source reports a
terminal `complete` or `partial` status only with the January 1 chunk. A cursor advances only after
the server acknowledges that exact pending payload; a lost response safely resends the same sequence
and chunk. Protocol v5 retains v4 collector-error ordering: errors contain only the mapped source
ID, fixed allowlisted code, and `observedAfterSequence` copied before collection. Servers continue
accepting v2-v4. Those older connectors keep recent usage current but cannot import earlier
current-year dates. A saved unsequenced v2/v3 error is removed only when its source is in scope, its
local failure fingerprint is reset, and the current collector can emit a fresh ordered observation.

Codex, Claude Code, Kimi Code, Qwen Code, and Gemini CLI install supported lifecycle triggers. Codex
uses `Stop` after every completed turn; upgrades remove only Vibe Racing's older `SessionEnd`
handler. Codex requires the user to review new or changed non-managed hooks before they execute.
Connect and `doctor` report the exact status from Codex; when review is required, open Codex CLI,
run `/hooks`, inspect the Vibe Racing `Stop` command, and trust it. The command targets a stable
local launcher, so later connector runtime updates preserve that trusted identity. The connector
never writes Codex trust state or enables a trust-bypass flag. Qwen's trigger currently covers
interactive TUI and ACP lifecycle events, not headless `qwen -p` exits. OpenCode uses its generated
global idle plugin to bulk-mark every active mapped SQLite store, then the same scheduler performs
collection; manual `sync` remains available. Antigravity requires the opt-in `run` wrapper. Every
installed hook contains its stable `clientSourceId` and a source-owned v3 marker. Hooks only discard
stdin, atomically update that source's locked dirty entry, start/reuse one short-lived timer
process, and return the provider's minimal response. Automatic collection first drains pending
payloads and then scans only active dirty sources; events for other sources do not start Codex, open
OpenCode SQLite, or read unrelated histories. It is debounced for 15 seconds, limited to roughly one
attempt per 120 seconds, and forced by 120 seconds of continuous activity. Each dirty generation
receives at most one automatic attempt; collector errors complete that generation, while failed
uploads remain compactly pending until another hook or manual sync. A generation created during the
attempt schedules the next finite batch; if a manual sync still owns the single-flight lock, that
automatic batch makes at most two bounded 60-second lock acquisitions. If both expire, it exits with
the dirty generation intact for the next hook or manual sync. During already-triggered activity, a
TTL-bounded installation check removes dashboard-disconnected mappings and hooks even when counters
are unchanged. There is no resident daemon, polling loop, or file watcher. Manual sync and initial
connect bypass the cooldown and collect all active sources; a direct manual sync waits up to 60
seconds for an existing sync and reports a busy error if the lock remains occupied. Unchanged data
sends no request.

Browser-triggered sync shares the same single-flight lock but scopes collection and pending delivery
to server-authorized source IDs on the bound installation. It can refresh one account or, from the
connected-computer card, every active agent on that computer in one run. The URL contains only
opaque IDs, a closed scope, and a one-time grant; account labels, paths, provider identities, and
usage content are never included. The server serializes claims per installation, permits at most one
new browser sync per 60 seconds, and rejects a second claim while a recent run is still active.
`uninstall` removes only an owned handler registration before deleting its runtime.

Every sync refreshes a rolling range of at most 31 UTC dates. Connector 0.6.0 then works backward
from the day before that range to January 1 of the current UTC year in newest-first chunks of at
most 31 dates. Automatic activity and browser Sync drain bounded pending payloads and collect at
most one new historical range; `connect` and manual `sync` continue through every eligible chunk. If
a rolling range starts after the previous acknowledged range, the server returns the durable gap;
`connect` and manual Sync drain all its chunks while automatic and browser Sync still collect at
most one chunk. Explicit `sync --full` starts a full current-year rescan after either terminal
`complete` or `partial`; ordinary runs do not restart a terminal full-year pass without a gap. An
inactive Codex account remains resumable and does not block the active account or create an
unbounded loop. Subsequent rolling JSONL collection skips unchanged files and resumes at the last
complete byte offset, detecting append, truncation, replacement, and file removal. Historical scans
use separate bounded state. Partial passes retain prior contributions, and valid usage metadata in a
JSONL record over 1 MB is parsed while the pass is explicitly reported partial. OpenCode and Qwen
read only files or rows intersecting the requested UTC range. Codex and Antigravity conservatively
mark historical coverage partial where their local surfaces cannot prove a complete year. Each safe
Antigravity collection records an inode/offset/prefix-hash proof with its pending payload. After
acknowledgement, cleanup revalidates that exact prefix under the capture lock and removes only
proved records older than 35 days; appended, replaced, truncated, malformed, and unacknowledged
bytes are retained. Cleanup is retried after later successful Sync and its failure never blocks
other sources. Only Antigravity CLI sessions launched through the Vibe Racing wrapper are counted;
earlier/direct sessions and Antigravity Desktop are not included. Detailed versions, formulas, and
limitations are in
[AGENT_SUPPORT.md](https://github.com/Tah10n/viberacing/blob/main/docs/AGENT_SUPPORT.md).
