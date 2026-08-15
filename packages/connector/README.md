# Vibe Racing connector

The Node 24 connector collects exact aggregate token counters from supported coding-agent sources
and pairs them with Vibe Racing agent accounts. It never uploads raw sessions or local paths.

```bash
npx --yes --prefer-online --package https://viberacing.example/downloads/viberacing-connector.tgz -- \
  viberacing connect --origin https://viberacing.example
```

Use the command shown by your Vibe Racing dashboard. The connector package is served by that same
Vibe Racing origin, so a separate npm publication is not required.

Discovery is independent of the directory where the command runs. Provider data comes from each
agent's documented home/profile roots and supported environment overrides. Executable-backed
adapters search the current `PATH`, installed macOS applications, Windows application roots and
WindowsApps, and common npm, pnpm, Bun, Volta, Homebrew, MacPorts, Scoop, Chocolatey, and system
binary directories. Portable installations can set `VIBERACING_CODEX_BIN`,
`VIBERACING_CURSOR_AGENT_BIN`, or `VIBERACING_ANTIGRAVITY_BIN` to an absolute executable path. One
resolved override is saved only in local `sources.json`, so later processes do not require the
variable again. Windows npm `.cmd`/`.bat` shims are launched through `ComSpec` with escaped
arguments. One broken installed agent is reported as a detection warning and never hides the other
healthy sources.

The browser approval maps every detected local source to a new or existing account. Re-running
`connect` keeps the stable installation identity, rotates device authorization, refreshes the
installed connector copy, and updates only Vibe Racing-owned hooks. Hook reconciliation is
best-effort per source: one damaged settings file is reported without blocking healthy hooks or the
initial sync. The final token/config swap is serialized behind any active sync, so an older request
cannot restore superseded authorization.

## Commands

```text
viberacing connect [--origin URL]
viberacing sync
viberacing doctor [--repair]
viberacing accounts
viberacing source list
viberacing source add --agent opencode --name Work --data-dir <path>
viberacing source add --agent kimi_code --name Archive --data-dir <path> --legacy
viberacing source add --agent antigravity --name Personal
viberacing source remove <client-source-id>
viberacing disconnect
viberacing uninstall
viberacing reset-installation
viberacing run cursor [--source <client-source-id>] -- <native cursor arguments>
viberacing run antigravity [--source <client-source-id>] -- <native agy arguments>
```

`source add` works before the first connection. A random `clientSourceId`, normalized local root,
collection method, surface, and user-provided safe label are stored only in local `sources.json`.
Pairing configuration contains the server mapping but never a path or path hash. Separate Codex
accounts require separate `--data-dir` profile roots; each App Server launch gets that source's
`CODEX_HOME`, so one profile is never collected twice as two local sources.

Current Kimi discovery prefers `$KIMI_CODE_HOME` (default `~/.kimi-code`) and does not automatically
add the default legacy `~/.kimi` when both exist. A deliberately retained or archived Python-format
root can be added with `source add ... --legacy` without re-enabling automatic double counting. On
an approved migration, the server disconnects the superseded legacy mapping and removes its
duplicated ranking rows before the current source performs its first sync. An abandoned pairing
leaves both the local legacy source and its server history unchanged.

Capture-based Cursor and Antigravity sources do not require `--data-dir`. Their default local path
is `captures/<clientSourceId>.jsonl`, so Personal and Work accounts never share a capture file. A
wrapper selects its only matching source automatically; with multiple profiles, `--source` is
required and is consumed by Vibe Racing rather than passed to the native CLI. The first wrapper run
creates one default source when none exists. Cursor follows the same selection rules but writes no
capture until its native output provides authoritative counters.

`disconnect` attempts remote revocation and always removes owned hooks, the device token, dirty and
scheduler state, and pending automatic uploads locally—even while offline—while preserving stable
local source identities. Lifecycle removal commands serialize with an active sync before revoking or
deleting state. `uninstall` removes every cleanable owned hook even if another profile is damaged;
on a partial failure it removes network credentials but retains source/root metadata and the small
installed runtime so an ordinary repeated `uninstall` can finish safely. Provider data and foreign
hooks are untouched. `reset-installation` is the explicit escape hatch for creating a new
installation identity.

State lives under `VIBERACING_STATE_DIR` (default `~/.viberacing`): `installation.json`,
`sources.json`, `config.json`, `state.json`, one compact pending snapshot and safe diagnostic per
source, hook diagnostics, the installed executable/library, and usage-only CLI captures. Pending
records are uploaded in bounded batches without forcing another collector scan. A source already
disconnected on the server loses its mapping, pending/runtime state, dirty entry, and owned hook
without deleting its local definition or blocking other agents. Directories are owner-only where the
OS supports permissions; secrets are `0600`. `doctor` reconciles the last server-accepted sequence
and reports hook freshness, mapped accounts, supported surfaces, excluded desktop surfaces, data
availability, partial warnings, and the last hook error; `doctor --repair` refreshes the installed
runtime and owned hooks; its server reconciliation shares the sync lock, and it does not collect
usage unless the user separately runs `viberacing sync`. A successful compatible reconnect,
authenticated sync, or doctor server check clears a prior version-upgrade automatic-sync disable.

Codex, Claude Code, Kimi Code, Qwen Code, and Gemini CLI install supported lifecycle triggers.
OpenCode uses its read-only SQLite store and a documented `sync`; Cursor and Antigravity require the
opt-in `run` wrappers. Every installed hook contains its stable `clientSourceId` and a source-owned
v3 marker. Hooks only discard stdin, atomically update that source's locked dirty entry, start/reuse
one short-lived timer process, and return the provider's minimal response. Automatic collection
first drains pending payloads and then scans only active dirty sources; events for other sources do
not start Codex, open OpenCode SQLite, or read unrelated histories. It is debounced for 15 seconds,
limited to roughly one attempt per 120 seconds, and forced by 120 seconds of continuous activity.
Each dirty generation receives at most one automatic attempt; collector errors complete that
generation, while failed uploads remain compactly pending until another hook or manual sync. A
generation created during the attempt schedules the next finite batch; if a manual sync still owns
the single-flight lock, that automatic batch makes at most two bounded 60-second lock acquisitions.
If both expire, it exits with the dirty generation intact for the next hook or manual sync. During
already-triggered activity, a TTL-bounded installation check removes dashboard-disconnected mappings
and hooks even when counters are unchanged. There is no resident daemon, polling loop, or file
watcher. Manual sync and initial connect bypass the cooldown and collect all active sources; a
direct manual sync waits up to 60 seconds for an existing sync and reports a busy error if the lock
remains occupied. Unchanged data sends no request.

The first sync may read one bounded 31-day window. Subsequent JSONL collection skips unchanged files
and resumes at the last complete byte offset, detecting append, truncation, replacement, and file
removal. Partial passes retain prior per-file contributions, and valid usage metadata in a JSONL
record over 1 MB is parsed while the pass is explicitly reported partial. OpenCode queries only the
UTC range. Successful Cursor/Antigravity capture syncs remove records older than 35 days and
atomically compact large files. Cursor's current official result schema has no token-usage field, so
its wrapper deliberately captures nothing unless an authoritative counter object appears; this is
not a promise of current Cursor counting. Cursor Desktop and Antigravity Desktop are not included.
Detailed versions, formulas, and limitations are in
[AGENT_SUPPORT.md](https://github.com/Tah10n/viberacing/blob/main/docs/AGENT_SUPPORT.md).
