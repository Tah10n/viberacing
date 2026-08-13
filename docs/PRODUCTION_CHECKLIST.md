# Production checklist

## Railway and OAuth

- Create one Railway web service from the root `Dockerfile` and one Railway PostgreSQL database.
- Assign the final HTTPS domain before creating the production GitHub OAuth app.
- Set GitHub homepage to the production origin and callback to
  `https://domain.example/api/auth/github/callback`; Device Flow is disabled/not used.
- Set `DATABASE_URL`, `VIBERACING_PUBLIC_ORIGIN`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
  `VIBERACING_DATABASE_SSL`, `VIBERACING_MIN_CONNECTOR_VERSION=0.2.0`, and
  `VIBERACING_MAX_DAILY_TOKENS=9999999999999999`.
- Never set `VIBERACING_ALLOW_INSECURE_LOCAL` in Railway. It is a loopback-only local-preview flag.
- Confirm pre-deploy migration succeeds, `/health` answers liveness, and `/ready` reports
  `001_initial.sql`.

## Verification

- Run `corepack pnpm verify`, `corepack pnpm local:reset`, and `corepack pnpm local:test`.
- Run `corepack pnpm audit --prod --audit-level high` and
  `npm pack --dry-run --json ./packages/connector`.
- Confirm the production image runs as `node`, readiness succeeds, OAuth/pairing works, and an old
  device token fails after reconnect.
- Pair fixtures or disposable accounts for each enabled adapter; do not use real transcripts in
  screenshots or issue reports.

## GitHub and npm manual controls

- Protect/ruleset `main`: require CI, pull requests, and current reviews; prohibit force pushes and
  branch deletion.
- Enable Dependabot security updates/alerts and secret scanning where the repository plan supports
  them.
- Configure npm trusted publishing with provenance for `@viberacing/connector`; inspect the dry-run
  tarball before the first publish.
- Publish only after the deployed server accepts protocol v2 and its minimum version policy matches
  the package.

## PostgreSQL operations

- Enable automated backups and retention in Railway.
- Perform and document a restore into a separate database before launch and periodically after.
- Alert on `/ready`, database capacity, migration failure, elevated 5xx, and exhausted rate limits.
- For a bad local total, repair/remove the source data and sync a newer complete snapshot. For an
  unrecoverable source, delete its agent account through the dashboard; cascading FKs delete its
  usage and summaries are rebuilt.
