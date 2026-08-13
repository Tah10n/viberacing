# Web application guidance

- Keep this app as the only runtime service and PostgreSQL as its only required dependency.
- Keep GitHub OAuth, pairing, usage sync, profiles, and the leaderboard in this app.
- Query live weekly totals; add infrastructure only after a measured production bottleneck.
- Store only GitHub identity, hashed credentials, connection metadata, and daily aggregate totals.
- Use transactions for identity, pairing, and usage mutations.
- Verify changes from the repository root with `corepack pnpm verify`.
