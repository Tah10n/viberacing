# Contributing

Keep changes focused on the product: one web service, one PostgreSQL database, and one connector.

## Development

For live code reloading, first configure `apps/web/.env.local` as described in the main README, then
run:

```bash
npm install --global corepack@0.35.0
corepack pnpm install --frozen-lockfile
docker compose up -d
corepack pnpm db:migrate
corepack pnpm dev
```

Use `corepack pnpm local:up` instead when testing the complete production image locally.

## Before a pull request

1. Run `corepack pnpm verify`.
2. Update documentation when setup, deployment, privacy, or user-visible behavior changes.
3. Review the diff for secrets and private data.

Never commit credentials, real user records, raw agent logs, prompts, responses, source code,
repository names, local paths, database dumps, usage exports, or local screenshots. Use synthetic
test data. `corepack pnpm privacy:check` verifies the repository boundary without printing secret
values.

Security vulnerabilities belong in a private GitHub security advisory, not a public issue. See
[SECURITY.md](SECURITY.md).
