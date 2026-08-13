# Vibe Racing

Vibe Racing is a fast weekly leaderboard for exact, self-reported coding-agent token usage. One
GitHub user can connect several computers, several agents, and several accounts of the same agent.

The production shape stays deliberately small: one Next.js service, one PostgreSQL database, and one
local connector. Only UTC dates and aggregate token counters cross the local boundary—never prompts,
responses, code, paths, repositories, hostnames, provider identities, credentials, model names, or
costs.

Exact collection paths exist for Codex, Claude Code, OpenCode, Kimi Code, Qwen Code, Cursor CLI,
Antigravity CLI, and Gemini CLI. Cursor Desktop and Antigravity Desktop are not counted. See
[agent support](docs/AGENT_SUPPORT.md) and [ranking semantics](docs/RANKING_SEMANTICS.md).

## Local production preview

Requirements: Node 24, pnpm 11 through Corepack, Docker Compose, curl, and a GitHub OAuth app.

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
[Security policy](SECURITY.md) · [Contributing](CONTRIBUTING.md)

Licensed under Apache-2.0.
