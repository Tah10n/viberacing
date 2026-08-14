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
viberacing source remove <client-source-id>
viberacing disconnect
viberacing uninstall
viberacing reset-installation
viberacing run cursor -- <native cursor arguments>
viberacing run antigravity -- <native agy arguments>
```

`source add` works before the first connection. A random `clientSourceId`, normalized local root,
collection method, surface, and user-provided safe label are stored only in local `sources.json`.
Pairing configuration contains the server mapping but never a path or path hash. Separate Codex
accounts require separate `--data-dir` profile roots; each App Server launch gets that source's
`CODEX_HOME`, so one profile is never collected twice as two local sources.

`disconnect` attempts remote revocation and always removes owned hooks, the device token, dirty and
scheduler state, and pending automatic uploads locally—even while offline—while preserving stable
local source identities. `uninstall` also removes all local Vibe Racing state and installed code;
provider data and foreign hooks are untouched. `reset-installation` is the explicit escape hatch for
creating a new installation identity.

State lives under `VIBERACING_STATE_DIR` (default `~/.viberacing`): `installation.json`,
`sources.json`, `config.json`, `state.json`, one compact pending snapshot and safe diagnostic per
source, hook diagnostics, the installed executable/library, and usage-only CLI captures. Pending
records are uploaded in bounded batches, and a source already disconnected on the server is removed
locally without blocking other agents. Directories are owner-only where the OS supports permissions;
secrets are `0600`. `doctor` reconciles the last server-accepted sequence and reports hook
freshness, mapped accounts, supported surfaces, excluded desktop surfaces, data availability,
partial warnings, and the last hook error; `doctor --repair` refreshes the installed runtime and
owned hooks; it does not sync unless the user separately runs `viberacing sync`.

Codex, Claude Code, Kimi Code, Qwen Code, and Gemini CLI install supported lifecycle triggers.
OpenCode uses its read-only SQLite store and a documented `sync`; Cursor and Antigravity require the
opt-in `run` wrappers. Hooks only discard stdin, atomically mark dirty, start/reuse one short-lived
timer process, and return the provider's minimal response. Automatic collection is debounced for 15
seconds, limited to roughly one attempt per 120 seconds, and forced by 120 seconds of continuous
activity. There is no resident daemon or file watcher. Manual sync and initial connect bypass the
cooldown; unchanged data sends no request.

The first sync may read one bounded 31-day window. Subsequent JSONL collection skips unchanged files
and resumes at the last complete byte offset, detecting append, truncation, replacement, and file
removal. OpenCode queries only the UTC range. Successful Cursor/Antigravity capture syncs remove
records older than 35 days and atomically compact large files. Cursor's current official result
schema has no token-usage field, so its wrapper deliberately captures nothing unless an
authoritative counter object appears; this is not a promise of current Cursor counting. Cursor
Desktop and Antigravity Desktop are not included. Detailed versions, formulas, and limitations are
in [AGENT_SUPPORT.md](https://github.com/Tah10n/viberacing/blob/main/docs/AGENT_SUPPORT.md).
