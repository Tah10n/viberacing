# Vibe Racing

Vibe Racing is a weekly leaderboard for coding-agent token usage. A user signs in with GitHub,
connects Codex or Claude Code from one or more computers, and sees their current UTC-week rank.

The product has one Next.js service, one PostgreSQL database, and one local connector. The connector
sends aggregate token totals, never prompts, code, paths, repository names, hostnames, provider
credentials, models, or costs. See [Privacy](docs/PRIVACY.md) for the exact data boundary.

## Local preview

Requirements: Node 24, pnpm 11 through Corepack, Docker, and a GitHub OAuth app.

1. Copy the local environment template:

```bash
cp .env.example apps/web/.env.local
```

2. Create a GitHub OAuth app with:

- Homepage URL: `http://localhost:3000`
- Authorization callback URL: `http://localhost:3000/api/auth/github/callback`
- Device Flow: not required; Vibe Racing uses the browser OAuth flow

Add its client ID and secret to `apps/web/.env.local`. This ignored file is not copied into Git or
the Docker image.

3. Start the complete site and PostgreSQL in one container:

```bash
corepack pnpm local:up
```

Open `http://localhost:3000`, sign in, then connect this computer:

```bash
node packages/connector/bin/viberacing.mjs connect --origin http://localhost:3000
```

Useful commands:

```bash
corepack pnpm local:test  # isolated end-to-end scenarios
corepack pnpm local:down  # stop the site; keep the local database
```

The database stays in the `viberacing-local-data` Docker volume. The scenario test creates and
removes its own synthetic user; it does not change your account.

## Verify

```bash
corepack pnpm verify
```

This checks the privacy boundary, formatting, lint, types, tests, and a production build.

## Deploy

The supported production path is Railway with Railway PostgreSQL. See
[Deployment](docs/DEPLOYMENT.md).

Reference: [Architecture](docs/ARCHITECTURE.md) · [Privacy](docs/PRIVACY.md) ·
[Security policy](SECURITY.md) · [Contributing](CONTRIBUTING.md)

Licensed under Apache-2.0.
