# Vibe Racing

[![CI](https://github.com/Tah10n/viberacing/actions/workflows/ci.yml/badge.svg)](https://github.com/Tah10n/viberacing/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/Tah10n/viberacing)](LICENSE)

Vibe Racing is a fast period-aware leaderboard for exact, self-reported coding-agent token usage.
Week, Month, All time, and Custom views all use UTC boundaries; **All time** means January 1 through
today in the current UTC calendar year, not lifetime usage. One GitHub user can connect several
computers, several agents, and several accounts of the same agent.

The production shape stays deliberately small: one Next.js service, one PostgreSQL database, and one
local connector. Usage sync contains only UTC dates and aggregate token counters. A separate,
strictly allowlisted diagnostics channel can send fixed machine codes and state transitions—never
prompts, responses, code, paths, repositories, hostnames, provider identities, credentials, model
names, exception messages, stack traces, or costs.

Exact collection paths exist for Codex, Claude Code, OpenCode, Kimi Code, Qwen Code, Antigravity
CLI, Gemini CLI, and Cursor Desktop + CLI. Antigravity Desktop is not supported. See
[agent support](docs/AGENT_SUPPORT.md) and [ranking semantics](docs/RANKING_SEMANTICS.md).

This branch implements Cursor as the eighth agent in connector 0.7.0. Desktop and interactive CLI
are captured automatically through owned hooks after connection; headless runs use
`viberacing run cursor -- <agent arguments>`. The same local account shares one logical source
across Desktop and CLI, while different accounts remain separate. Machine-local sources add with
`source_sum`. Exact history starts with hook installation; earlier usage remains partial. The UTC
day is fixed at first capture, using the approved capture-time policy. Reasoning and subagents are
already included in the aggregate run usage. Unknown schemas fail closed. Direct headless runs, Tab,
Bugbot, Cloud Agents and SDK usage are outside this support contract.

The [Cursor evidence and rollout gates](docs/CURSOR_EVIDENCE.md) distinguish accepted exact-source
evidence, this implementation, remaining live A/B/A validation, and the separate server-first
release. This Draft branch has not been deployed or published.

Supported lifecycle hooks mark only their owning local source dirty; one OpenCode idle event marks
all active mapped OpenCode databases for that installation together. One short-lived detached
scheduler coalesces source events and sends at most about one automatic batch every two minutes; it
drains saved payloads first and runs collectors only for currently dirty sources. There is no retry
loop: one dirty generation gets one automatic attempt, and a later hook or manual sync retries saved
failures. There is no daemon, watcher, or polling loop. Manual `viberacing sync` and the first
successful `connect` still collect every active source immediately. Every sync first refreshes the
rolling range of at most 31 UTC dates. Connector 0.6.0 then backfills the rest of the current UTC
year in resumable, newest-first chunks of at most 31 dates: automatic and browser Sync drain bounded
pending payloads and collect at most one new historical range. `connect` and manual
`viberacing sync` continue through every eligible chunk. If rolling ranges are separated by an
offline interval, the server retains the missing UTC dates and protocol v5 returns a resumable gap
cursor; later Sync drains it with the same limits. Explicit `viberacing sync --full` starts a full
current-year rescan even after a terminal `complete` or `partial` pass. Acknowledged cursors make
retries idempotent and survive interruption. Later JSONL reads resume from safe byte offsets.
Automatic hooks suppress an unchanged normalized rolling snapshot. Manual and browser-triggered Sync
still submit a content-equivalent rolling confirmation so the dashboard's **Last sync** time
advances after a successful check.

Codex marks its physical profile dirty after each completed turn. One `CODEX_HOME` can safely track
up to eight ChatGPT logins: each collection reads local `tokens.account_id` before starting App
Server, brackets `account/usage/read` with two non-refreshing `account/read` calls, and reads the
local ID again afterward. It accepts the snapshot only when both local IDs and both normalized,
non-null App Server emails match. The connector derives an `acct1_…` HMAC locally from email plus
account ID and a separate random salt that survives `reset-installation`; none of those values is
sent to Vibe Racing. Either value alone is insufficient to distinguish an account. A newly observed
stable login gets a generic logical source, while API-key, Bedrock, identifier-unavailable, and
mid-collection account states fail closed. While its account-wide App Server daily buckets lag, Sync
uses every exact locally observed non-overlapping daily total after the newest authoritative bucket
as a partial value, including across UTC rollovers. The dashboard and ranking therefore update
immediately; later App Server buckets may correct each value up or down. Provider-recorded local
input/output/cache/reasoning counters remain separately visible for a single-login profile; they are
hidden once a physical profile has multiple logical accounts because the local transcript components
are not account-scoped. Neither counter is estimated. One physical Codex profile has one Vibe Racing
`Stop` hook, which runs only after the user reviews and trusts it through `/hooks`; `doctor` reports
whether that hook is current or still needs review.

OpenCode automatic Sync uses one installation-owned global plugin at
`$XDG_CONFIG_HOME/opencode/plugins` (default `~/.config/opencode/plugins`). `connect` or
`doctor --repair` creates it, and OpenCode must be restarted once after a create or update. The
plugin reacts primarily to `session.status` becoming `idle`, with `session.idle` as a two-second
deduplicated fallback, then starts the stable local Vibe Racing launcher without waiting for Sync.
It does not read or forward the session ID, prompt, response, code, model, project path, or event
payload. Manual `viberacing sync` remains available, including when OpenCode is killed before idle.

Connector 0.6.0 uses protocol v5 to distinguish rolling snapshots from bounded current-year history
chunks and to reconcile each source's `pending`, `complete`, or `partial` backfill status. It keeps
durable unresolved UTC dates when a partial snapshot omits a day or rolling windows leave a gap, and
returns the bounded gap to the connector until an acknowledged complete backfill closes it. It keeps
the v4 sequence rule for allowlisted collector errors. The server remains wire-compatible with
protocol v2, v3, and v4 during the rollout, so older connectors continue syncing recent usage but do
not import the current year's earlier dates. A saved unsequenced v2/v3 collector error is replaced
by a fresh ordered observation on its next in-scope collection instead of being relabeled.
Account-wide sources are automatically matched only after seven complete positive days spanning at
least a week, with three distinct totals and no complete contradiction; manual reassignment and Undo
stay available.

Qwen Code's user-level `SessionEnd` hook fires for interactive TUI exits and is wired into ACP, but
Qwen Code 0.21.12 does not emit that event after headless `qwen -p` runs. Headless usage is still
recorded exactly and is collected by `viberacing sync` or the next supported lifecycle trigger.

After a current connector is paired in a browser, that browser can launch an on-demand
`viberacing://` handler to sync either one agent account or every active agent on the same computer.
The all-agent action appears only after the connector confirms that the installed OS handler
supports it. The handler exits after the bounded sync; it does not install a resident process or let
the web service read local histories.

## Connector distribution

After the verified npm rollout, the official Vibe Racing service uses one permanent command:

```bash
npx --yes @viberacing/connector@latest connect --origin https://viberacing.up.railway.app
```

No global npm installation is performed. `npx` starts the official package, and the connector keeps
its working copy only in local Vibe Racing state. Update or repair that copy explicitly with
`npx --yes @viberacing/connector@latest doctor --repair`; uninstall it with
`npx --yes @viberacing/connector@latest uninstall`. It never updates silently.

After connecting Codex, open Codex CLI, run `/hooks`, inspect the Vibe Racing `Stop` command, and
trust it. Until that one-time review is complete, manual Sync remains available but automatic Sync
after a completed turn does not run. A full uninstall and reconnect creates a new source identity
and therefore requires a new review; routine `doctor --repair` keeps the trusted command identity
stable.

After connecting an OpenCode source, restart OpenCode once when the connector asks. Multiple Vibe
Racing installations use separate plugin files, and custom `VIBERACING_STATE_DIR` roots remain
isolated. An unchanged OpenCode SQLite profile may be checked locally after idle, but fingerprint
suppression prevents another usage payload.

Self-hosted deployments default to a same-origin connector archive and show their exact command on
the dashboard. Set `VIBERACING_CONNECTOR_DISTRIBUTION=npm` only after the public package is
verified, or retain `archive` to avoid any runtime dependency on the public npm registry. The
setting is made once, not changed for each release; there are no connector package-name or version
variables. Neither distribution changes the self-reported ranking model or sends prompts, responses,
code, repositories, paths, provider credentials, model names, or costs.

## Local production preview

Requirements: Node 24 LTS, pnpm 11 through Corepack, Docker Compose, curl, and a GitHub OAuth app.

1. Copy `.env.example` to `apps/web/.env.local` and add the OAuth client ID and secret.
2. Configure the OAuth app homepage as `http://localhost:3000` and callback as
   `http://localhost:3000/api/auth/github/callback`. Device Flow is not needed.
3. Start the production image and PostgreSQL:

```bash
corepack pnpm local:up
```

The command waits for `/ready`. The web app is at `http://localhost:3000`; PostgreSQL is exposed
only at `127.0.0.1:55432`. Pair the local connector with:

```bash
node packages/connector/bin/viberacing.mjs connect --origin http://localhost:3000
```

Useful commands:

```bash
corepack pnpm local:test   # isolated HTTP/SQL end-to-end scenarios
corepack pnpm local:down   # stop services; retain the database volume
corepack pnpm local:reset  # explicitly delete only the local Vibe Racing volume and restart
corepack pnpm verify       # privacy, format, lint, types, unit tests, production build
```

The local scenario creates and removes synthetic users. See [deployment](docs/DEPLOYMENT.md) and the
[production checklist](docs/PRODUCTION_CHECKLIST.md) before inviting users.

Reference: [Architecture](docs/ARCHITECTURE.md) · [Privacy](docs/PRIVACY.md) ·
[Security policy](SECURITY.md) · [Contributing](CONTRIBUTING.md) · [Support](SUPPORT.md) ·
[Governance](GOVERNANCE.md) · [Changelog](CHANGELOG.md) · [Releasing](docs/RELEASING.md)

Licensed under Apache-2.0.
