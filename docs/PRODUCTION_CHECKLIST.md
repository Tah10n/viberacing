# Production checklist

## Railway and OAuth

- Create one Railway web service from the root `Dockerfile` and one Railway PostgreSQL database.
- Assign the final HTTPS domain before creating the production GitHub OAuth app.
- Set GitHub homepage to the production origin and callback to
  `https://domain.example/api/auth/github/callback`; Device Flow is disabled/not used.
- Set `DATABASE_URL`, `VIBERACING_PUBLIC_ORIGIN`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
  `VIBERACING_DATABASE_SSL`, `VIBERACING_MIN_CONNECTOR_VERSION=0.2.0`, and
  `VIBERACING_MAX_DAILY_TOKENS=9999999999999999`; quote the large token value in YAML.
- Never set `VIBERACING_ALLOW_INSECURE_LOCAL` in Railway. It is a loopback-only local-preview flag.
- Confirm pre-deploy migration succeeds, `/health` answers liveness, and `/ready` reports the latest
  required migration. Insert a synthetic later ledger row and confirm readiness remains healthy;
  remove the required row and confirm readiness returns 503.

## Verification

- Run `corepack pnpm verify`, `corepack pnpm db:migrate` twice on a clean PostgreSQL database,
  `corepack pnpm local:up`, and `corepack pnpm local:test`.
- Run `corepack pnpm audit --prod --audit-level high` and
  `npm pack --dry-run --json ./packages/connector`.
- Confirm the production image runs as `node`, readiness succeeds, OAuth/pairing works, and an old
  device token fails after reconnect.
- Confirm the connector matrix passes on Linux, macOS, and Windows using `VIBERACING_STATE_DIR`, and
  that the production job reaches migration, integration, audit, package, image, non-root, and
  readiness stages.
- Confirm a 20-event burst produces one deferred batch, automatic attempts respect the two-minute
  interval/maximum delay, a Claude event does not start Codex or open OpenCode SQLite, pending
  delivery does not rescan collectors, manual sync collects all sources immediately, and unchanged
  data produces no request. No daemon, watcher, polling loop, system service, or required cron
  should be installed.
- Verify two Codex profiles use distinct `CODEX_HOME` roots; Antigravity Personal and Work use
  distinct client-source capture files and require `--source`; removing or server-retiring one
  source removes only its hook; multi-account reassignment immediately rebuilds totals; missing
  sequence state resumes from the server value; and offline disconnect removes hooks and the device
  token.
- Pair fixtures or disposable accounts for each enabled adapter; do not use real transcripts in
  screenshots or issue reports.
- Recheck the documented upstream versions before release. Do not enable exact Cursor ranking until
  Cursor officially exposes authoritative counters; neither Cursor Desktop nor Antigravity Desktop
  is supported.
- Confirm public copy reports seven counted agents and explicitly excludes Cursor from exact totals.

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
