# Vibe Racing connector

The Node 24 connector collects exact aggregate token counters for eight coding agents and pairs them
with Vibe Racing agent accounts. It never uploads raw sessions or local paths.

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

`disconnect` revokes the server installation and removes owned hooks/config while preserving the
stable installation identity. `uninstall` also removes all local Vibe Racing secrets, pending data,
logs, and installed code; provider data and foreign hooks are untouched. `reset-installation` is an
explicit escape hatch for intentionally creating a new installation identity.

State lives under `~/.viberacing`: `installation.json`, `config.json`, `state.json`, one compact
pending snapshot per source, hook diagnostics, the installed executable/library, and usage-only CLI
captures. Directories are owner-only; secrets are `0600`. `doctor` reports hook freshness, mapped
accounts, supported surfaces, excluded desktop surfaces, data availability, partial warnings, and
the last hook error; `doctor --repair` refreshes the installed runtime and owned hooks.

Codex, Claude Code, Kimi Code, Qwen Code, and Gemini CLI install supported lifecycle triggers.
OpenCode uses its read-only SQLite store and a documented `sync`; Cursor and Antigravity require the
opt-in `run` wrappers. Cursor Desktop and Antigravity Desktop are not included. Detailed versions,
formulas, and limitations are in
[AGENT_SUPPORT.md](https://github.com/Tah10n/viberacing/blob/main/docs/AGENT_SUPPORT.md).
