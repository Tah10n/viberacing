# Vibe Racing

[![CI](https://github.com/Tah10n/viberacing/actions/workflows/ci.yml/badge.svg)](https://github.com/Tah10n/viberacing/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/Tah10n/viberacing)](LICENSE)

Vibe Racing is a fast weekly leaderboard for exact, self-reported coding-agent token usage. One
GitHub user can connect several computers, several agents, and several accounts of the same agent.

The production shape stays deliberately small: one Next.js service, one PostgreSQL database, and one
local connector. Usage sync contains only UTC dates and aggregate token counters. A separate,
strictly allowlisted diagnostics channel can send fixed machine codes and state transitions—never
prompts, responses, code, paths, repositories, hostnames, provider identities, credentials, model
names, exception messages, stack traces, or costs.

Exact collection paths exist for Codex, Claude Code, OpenCode, Kimi Code, Qwen Code, Antigravity
CLI, and Gemini CLI. Antigravity Desktop is not supported. See
[agent support](docs/AGENT_SUPPORT.md) and [ranking semantics](docs/RANKING_SEMANTICS.md).

Supported lifecycle hooks mark only their owning local source dirty. One short-lived detached
scheduler coalesces source events and sends at most about one automatic batch every two minutes; it
drains saved payloads first and runs collectors only for currently dirty sources. There is no retry
loop: one dirty generation gets one automatic attempt, and a later hook or manual sync retries saved
failures. There is no daemon, watcher, or polling loop. Manual `viberacing sync` and the first
successful `connect` still collect every active source immediately. The first collection is bounded
to 31 UTC days, and later JSONL reads resume from safe byte offsets. Automatic hooks suppress an
unchanged normalized snapshot. Manual and browser-triggered Sync still submit a content-equivalent
confirmation snapshot so the dashboard's **Last sync** time advances after a successful check.

Codex marks its source dirty after each completed turn. While its account-wide App Server daily
buckets lag, Sync uses every exact locally observed non-overlapping daily total after the newest
authoritative bucket as a partial value, including across UTC rollovers. The dashboard and ranking
therefore update immediately; later App Server buckets may correct each value up or down.
Provider-recorded local input/output/cache/reasoning counters remain separately visible; neither
counter is estimated.

Connector 0.4.0 uses protocol v4 to sequence its allowlisted collector-error state against the last
server-accepted source snapshot. The server remains wire-compatible with protocol v2 and v3 during
the rollout. Account-wide sources are automatically matched only after seven complete positive days
with at least three distinct totals and no complete contradiction; manual reassignment and Undo stay
available.

Qwen Code's user-level `SessionEnd` hook fires for interactive TUI exits and is wired into ACP, but
Qwen Code 0.21.12 does not emit that event after headless `qwen -p` runs. Headless usage is still
recorded exactly and is collected by `viberacing sync` or the next supported lifecycle trigger.

After a current connector is paired in a browser, that browser can launch an on-demand
`viberacing://` handler to sync one agent account on the same computer. The handler exits after the
bounded sync; it does not install a resident process or let the web service read local histories.

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
