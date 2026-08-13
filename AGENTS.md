# Vibe Racing repository guidance

Vibe Racing is deliberately one web service, one PostgreSQL database, and one local connector.

## Engineering rules

- Keep the production path in `apps/web`, `packages/connector`, `Dockerfile`, and `railway.json`.
- Prefer a small route and a SQL transaction over a new service or abstraction.
- Do not add queues, caches, workers, or another database without a measured production need.
- Preserve integer precision for token totals and use UTC dates and weeks.
- Run `corepack pnpm verify` before handing off a change.

## Privacy and security

- Sync only agent, UTC date, and aggregate token total.
- Never collect prompts, responses, code, transcript content, repository names, paths, provider
  credentials, model names, or costs.
- Hash sessions, pairing secrets, and device tokens before database storage.
- Keep browser mutations same-origin, request bodies bounded, SQL parameterized, and production
  origins HTTPS-only.
- Treat rankings as self-reported; they grant no authorization, reward, or access.
