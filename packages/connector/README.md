# Vibe Racing connector

The Node 24 connector collects exact aggregate token counters from supported coding-agent sources
and pairs them with Vibe Racing agent accounts. It never uploads raw sessions or local paths.

```bash
npx @viberacing/connector connect --origin https://viberacing.example
```

The browser approval maps every detected local source to a new or existing account. Re-running
`connect` keeps the stable installation identity, rotates device authorization, refreshes the
installed connector copy, and updates only Vibe Racing-owned hooks.

## Commands

```text
viberacing connect [--origin URL]
viberacing sync
viberacing doctor [--repair]
viberacing accounts
viberacing source list
viberacing source add --agent opencode --name Work --data-dir <path>
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
runtime and owned hooks; it does not sync unless the user separately runs `viberacing sync`.

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
the single-flight lock, that automatic batch waits for it for at most 60 seconds rather than losing
the event. During already-triggered activity, a TTL-bounded installation check removes
dashboard-disconnected mappings and hooks even when counters are unchanged. There is no resident
daemon, polling loop, or file watcher. Manual sync and initial connect bypass the cooldown and
collect all active sources; unchanged data sends no request.

The first sync may read one bounded 31-day window. Subsequent JSONL collection skips unchanged files
and resumes at the last complete byte offset, detecting append, truncation, replacement, and file
removal. OpenCode queries only the UTC range. Successful Cursor/Antigravity capture syncs remove
records older than 35 days and atomically compact large files. Cursor's current official result
schema has no token-usage field, so its wrapper deliberately captures nothing unless an
authoritative counter object appears; this is not a promise of current Cursor counting. Cursor
Desktop and Antigravity Desktop are not included. Detailed versions, formulas, and limitations are
in [AGENT_SUPPORT.md](https://github.com/Tah10n/viberacing/blob/main/docs/AGENT_SUPPORT.md).
