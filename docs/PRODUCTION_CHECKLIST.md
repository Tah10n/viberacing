# Production checklist

## Railway and OAuth

- Create one Railway web service from the root `Dockerfile` and one Railway PostgreSQL database.
- Assign the final HTTPS domain before creating the production GitHub OAuth app.
- Set GitHub homepage to the production origin and callback to
  `https://domain.example/api/auth/github/callback`; Device Flow is disabled/not used.
- Set `DATABASE_URL`, `VIBERACING_PUBLIC_ORIGIN`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
  `VIBERACING_DATABASE_SSL`, `VIBERACING_CONNECTOR_DISTRIBUTION=npm` for the official service,
  `VIBERACING_MIN_CONNECTOR_VERSION` to the current published compatibility floor, and
  `VIBERACING_MAX_DAILY_TOKENS=9999999999999999`; quote the large token value in YAML. Keep the
  floor at `0.2.0` until the verified 0.4.3 publication, then follow the staged 0.4.3 change below.
  Set `VIBERACING_TRUST_PROXY=railway` and `VIBERACING_LOG_LEVEL=info`. Keep every TLS parameter out
  of `DATABASE_URL` so `VIBERACING_DATABASE_SSL` remains the only database TLS switch. Self-hosted
  deployments should retain the `archive` distribution unless they deliberately accept a runtime npm
  dependency.
- For public self-hosting, use `VIBERACING_TRUST_PROXY=trusted-x-real-ip` only behind a reverse
  proxy that strips the incoming `X-Real-IP` and overwrites it with the observed client address. Do
  not forward or trust arbitrary `X-Forwarded-For` chains. Public production startup must fail when
  the mode is `none`; retain `none` only for loopback preview and tests.
- Never set `VIBERACING_ALLOW_INSECURE_LOCAL` in Railway. It is a loopback-only local-preview flag.
- Confirm configured public and local-test origins contain no URL username or password; startup
  rejects credential-bearing origins without printing the credential.
- Confirm pre-deploy migration succeeds, `/health` answers liveness, and `/ready` reports the latest
  required migration. Insert a synthetic later ledger row and confirm readiness remains healthy;
  remove the required row and confirm readiness returns 503.
- Confirm Railway parses one-line JSON logs, an intentional rejected request has a searchable
  `requestId`, `route`, `status`, and `outcome`, and a failed readiness check is logged at `error`.
  Routine unauthenticated rejections are visible only while `debug` is enabled. Temporarily use
  `debug` to verify them and request-start correlation, then return production to `info`.
- Inspect representative logs and confirm they contain no URL query, IP, headers, cookies, bodies,
  handles, source IDs, token totals, credentials, model names, repository names, or local paths.

## Verification

- Run `corepack pnpm verify`, `corepack pnpm db:migrate` twice on a clean PostgreSQL database,
  `corepack pnpm local:up`, and `corepack pnpm local:test`.
- Run `corepack pnpm audit --prod --audit-level moderate`, `corepack pnpm migrations:check`, and
  `corepack pnpm connector:package:check`, plus `git diff --check`.
- Run the documented Chromium E2E/accessibility command on a clean PostgreSQL database. Confirm the
  migration runner succeeds twice against that clean database before running the browser suite.
- Confirm the production image runs as `node`, readiness succeeds, OAuth/pairing works, and an old
  device token fails after reconnect.
- Confirm startup rejects a public production origin with `VIBERACING_TRUST_PROXY=none`, while the
  documented loopback preview still starts. Send malformed and missing `X-Real-IP` through a trusted
  mode and confirm both remain in a bounded fail-closed admission bucket.
- Confirm equivalent IPv6 forms and addresses in one `/64` share one admission key, IPv4-mapped IPv6
  shares its IPv4 key, and unique client addresses cannot create more per-client buckets than the
  route's global admission cap. Raw client addresses must not appear in logs. The built-in limiter
  bounds application state; retain an edge/WAF or equivalent upstream protection for a real
  distributed attack.
- Confirm the connector matrix passes on Linux, macOS, and Windows using `VIBERACING_STATE_DIR`, and
  that the production job reaches migration, integration, audit, package, image, non-root, and
  readiness stages.
- Open Browser Sync concurrently in multiple tabs and confirm only one installation claim starts in
  a 60-second window, later claims receive `429` with `Retry-After` and settle as terminal `busy` on
  their next poll, rejected rows do not extend the cooldown, and status polling remains under its
  isolated run quota and higher aggregate user quota while honoring bounded `Retry-After` backoff.
- Confirm a 20-event burst produces one deferred batch, automatic attempts respect the two-minute
  interval/maximum delay, a Claude event does not start Codex or open OpenCode SQLite, pending
  delivery does not rescan collectors, and unchanged automatic data produces no usage request.
  Confirm manual and browser-triggered Sync collect their selected sources immediately, submit an
  unchanged confirmation snapshot, and advance account/computer **Last sync** timestamps. Verify
  permanent collector/network failure ends after one generation, retains safe pending/error state,
  and retries only after a new hook/manual sync. No daemon, watcher, polling loop, system service,
  or required cron should be installed.
- Verify two Codex profiles use distinct `CODEX_HOME` roots; Antigravity Personal and Work use
  distinct client-source capture files and require `--source`; removing or server-retiring one
  source removes only its hook; multi-account reassignment immediately rebuilds totals; missing
  sequence state resumes from the server value; and offline disconnect removes hooks and the device
  token. Race disconnect/remove/uninstall against an in-flight sync, verify dashboard disconnect is
  reconciled during active use, and verify partial uninstall continues across later roots while
  retaining failed-root metadata for retry. Race reconnect and doctor reconciliation against an
  in-flight sync; verify only the replacement token survives, a repaired connector clears the 426
  automatic-disable flag, and a lock timeout gets exactly one bounded deferred acquisition.
- After Codex connect or the first upgrade to the stable hook launcher, run `/hooks`, inspect and
  trust the Vibe Racing `Stop` hook, then confirm `doctor` reports `codex hook: current`. Complete a
  turn and verify one dirty generation reaches the server within two minutes. Run `doctor --repair`
  again and confirm the hook remains trusted and its command identity is unchanged; do not use a
  hook-trust bypass or write `trusted_hash` from the connector.
- Verify two linked Codex computers follow `complete 100` then newer `complete 90`; dashboard,
  weekly summary, chart, leaderboard, and component selection must all show the same corrected
  value. A later partial may provisionally advance it, and the next complete must correct it down.
  Verify an explicit complete zero inside an outer partial snapshot corrects a covered day without
  changing an uncovered day. Verify two-day/two-distinct-total automatic matching and Undo.
- Verify protocol v4 applies a collector error only at its exact observed sequence, ignores a
  delayed error after a newer success, and clears an applied error on the next success. Re-run v2/v3
  pairing and usage compatibility scenarios, including replacement of an unsequenced pending v2/v3
  error by the current v4 observation.
- Pair fixtures or disposable accounts for each enabled adapter; do not use real transcripts in
  screenshots or issue reports.
- Recheck the documented upstream versions before release. Antigravity Desktop is not supported.
- With archive distribution, verify dashboard connect and repair use the exact same-origin versioned
  tarball and uninstall uses the stable same-origin tarball. With npm distribution, verify all three
  use fixed `@viberacing/connector@latest` commands without `--package`, `--allow-remote`, a
  concrete version, or a downloads URL.
- Pair or retain an installation below `VIBERACING_MIN_CONNECTOR_VERSION` and verify its computer
  card and the signed-in home page show **Connector update required** on desktop and mobile. Confirm
  a version at or above the minimum does not advertise an unpublished bundled version. Run
  `doctor --repair`, confirm it repairs runtime/hooks without a usage request, and verify
  reconciliation clears both notices.
- Confirm the macOS CI gate receives a synthetic custom-scheme URL through the real LaunchServices
  applet.
- Confirm public copy reports seven counted agents.

## GitHub and npm manual controls

- Protect/ruleset `main`: require pull requests and current reviews; prohibit force pushes and
  branch deletion. Require the exact stable checks `ci-required` and `Dependency review`. Do not use
  a matrix child or `production` as the sole required context. After the workflow's first successful
  run, verify with `gh api repos/Tah10n/viberacing/branches/main/protection/required_status_checks`.
- Enable Dependabot security updates/alerts and secret scanning where the repository plan supports
  them.
- At the start of each calendar quarter, review ignored npm and Node major updates, record the
  compatibility/test decision in an issue, and schedule accepted upgrades instead of leaving the
  major-version ignore indefinitely unaudited.
- For recovery, create the GitHub `npm-production` environment first.
- Always select **Protected branches only**. Do not allow tags or unprotected branches.
- For every audit, do not store a publish token in the environment.
- Always confirm that `main` is covered by the repository's active branch ruleset.
- Verify the environment before continuing:

  ```bash
  gh api repos/Tah10n/viberacing/environments/npm-production \
    --jq '.deployment_branch_policy'
  ```

  It must report `protected_branches: true` and `custom_branch_policies: false`. Stop if the
  environment is absent or unrestricted.

- Keep the npm Trusted Publisher scoped to `Tah10n/viberacing`, `publish-connector.yml`, and the
  `npm-production` environment. If recovery requires recreating it, only after the environment
  verification configure npm trusted publishing with provenance for `@viberacing/connector`. Require
  two-factor authentication and disallow publish tokens; run `corepack pnpm connector:package:check`
  against the package root before every publish.
- The one-time distribution rollout completed on 2026-08-25: connector 0.4.0 bootstrapped the npm
  package, 0.4.1 was the first GitHub-tagged Trusted Publisher release, and 0.4.2 completed the
  production hook lifecycle validation. Keep official Railway on
  `VIBERACING_CONNECTOR_DISTRIBUTION=npm`; normal releases must not change it. Use `archive` only
  for self-hosting or the documented distribution rollback.
- Confirm **Publish connector** ran only for a published non-draft, non-prerelease `vX.Y.Z` release,
  used the `npm-production` environment and OIDC without npm tokens, verified main ancestry, and
  finished only after both the exact version and `dist-tags.latest` were visible.
- For a future protocol release, deploy a server that accepts both the old and new protocols,
  complete production checks, publish the compatible connector, and only then raise
  `VIBERACING_MIN_CONNECTOR_VERSION` if older protocol support is intentionally removed. A pull
  request must never create a rejection window for a connector that is not yet available.
- For 0.4.3 specifically, verify npm `latest` and `npx --yes @viberacing/connector@latest --version`
  first, then set Railway `VIBERACING_MIN_CONNECTOR_VERSION=0.4.3`, wait for `/ready`, and verify
  the signed-in `/` and `/dashboard` notices before testing `doctor --repair` end to end. After this
  staged change, `0.4.3` is the current published compatibility floor in the setup checklist above.

## PostgreSQL operations

- Enable automated backups and retention in Railway.
- Perform and document a restore into a separate database before launch and periodically after.
- Alert on `/ready`, database capacity, migration failure, elevated 5xx, and exhausted rate limits.
- For a bad local total, repair/remove the source data and sync a newer complete snapshot. For an
  unrecoverable source, delete its agent account through the dashboard; cascading FKs delete its
  usage and summaries are rebuilt.
