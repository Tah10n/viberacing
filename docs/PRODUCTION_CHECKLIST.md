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
  current `0.4.3` floor unchanged throughout the 0.5.0 pull request, server deployment, and package
  publication; follow the staged 0.5.0 change below before considering a later floor increase. Set
  `VIBERACING_TRUST_PROXY=railway` and `VIBERACING_LOG_LEVEL=info`. Keep every TLS parameter out of
  `DATABASE_URL` so `VIBERACING_DATABASE_SSL` remains the only database TLS switch. Self-hosted
  deployments should retain the `archive` distribution unless they deliberately accept a runtime npm
  dependency.
- For public self-hosting, use `VIBERACING_TRUST_PROXY=trusted-x-real-ip` only behind a reverse
  proxy that strips the incoming `X-Real-IP` and overwrites it with the observed client address. Do
  not forward or trust arbitrary `X-Forwarded-For` chains. Public production startup must fail when
  the mode is `none`; retain `none` only for loopback preview and tests.
- Never set `VIBERACING_ALLOW_INSECURE_LOCAL` in Railway. It is a loopback-only local-preview flag.
- Confirm configured public and local-test origins contain no URL username or password; startup
  rejects credential-bearing origins without printing the credential.
- Confirm pre-deploy migration succeeds, `/health` answers liveness, and `/ready` reports
  `010_current_year_history.sql` as the latest required migration. Insert a synthetic later ledger
  row and confirm readiness remains healthy; remove the required row and confirm readiness
  returns 503.
- Confirm Railway parses one-line JSON logs, an intentional rejected request has a searchable
  `requestId`, `route`, `status`, and `outcome`, and a failed readiness check is logged at `error`.
  Routine unauthenticated rejections are visible only while `debug` is enabled. Temporarily use
  `debug` to verify them and request-start correlation, then return production to `info`.
- Inspect representative logs and confirm they contain no URL query, IP, headers, cookies, bodies,
  handles, source IDs, token totals, credentials, model names, repository names, or local paths.

## OpenCode 0.4.4 -> 0.5.0 cutover

- Production has accepted OpenCode usage, so do not use a clean 0.5.0 ledger bootstrap.
- Confirm `v0.4.4` resolves to linear `main` commit `2b16b6a8ad75b6b852adc5e2189e6d4a8d93eabd`, npm
  `latest` is `0.4.4`, and provenance binds the package `gitHead` to that commit. Do not tag the
  former feature-branch candidate SHA.
- Keep PR #50 linear and squash-mergeable on that `main`; neither staging commit `e291427` nor merge
  commit `ac8e9d8` belongs in its rewritten history.
- Require one successful OpenCode Sync with 0.4.4 for every existing installation and preserve its
  local state. Network failure, partial collection, or merely starting the CLI is not confirmation.
- On the real production computer, update the installed Browser Sync handler/runtime before the
  0.5.0 preflight; a one-off 0.4.4 Sync does not replace a handler still running 0.4.3:

  ```sh
  npx --yes @viberacing/connector@0.4.4 doctor --repair
  npx --yes @viberacing/connector@0.4.4 sync
  node packages/connector/bin/viberacing.mjs upgrade-preflight
  ```

- Enumerate active OpenCode installations with the read-only SQL in `docs/RELEASING.md`, then run
  `node packages/connector/bin/viberacing.mjs upgrade-preflight` on each machine. Server version and
  last-sync fields are inventory hints, not proof of the local message-ID cutover.
- Before 0.5.0 publication, verify that direct 0.4.3 state fails closed with
  `opencode_cutover_required` before any local mutation or network request, confirmed 0.4.4 state
  bootstraps, a real stale 0.4.3 Browser Sync is detected, config/state/pending sequence races make
  zero requests, source/reset/Antigravity writes remain byte-for-byte blocked and 0.4.4-readable,
  and a valid aggregate state above 20 MiB is streamed successfully. Also verify a scan-to-accept
  inserted row is counted once and clock skew does not affect identity.
- Do not raise the Railway compatibility floor merely to force this migration; coordinate affected
  installations explicitly and keep Railway variables unchanged until separately authorized.

## Verification

- Run `corepack pnpm verify`, `corepack pnpm db:migrate` twice on a clean PostgreSQL database,
  `corepack pnpm local:up`, and `corepack pnpm local:test`.
- Run `corepack pnpm audit --prod --audit-level moderate`, `corepack pnpm migrations:check`, and
  `corepack pnpm connector:package:check`, plus `git diff --check`.
- Compare the pull-request base with its head using
  `node scripts/check-connector-version-bump.mjs <base> HEAD`. Change a publishable connector file
  without changing its version in a negative fixture and confirm the gate rejects it before any web
  archive is built.
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
  connect and manual Sync complete every remaining current-year chunk, while automatic and browser
  Sync drain bounded pending payloads and collect at most one new historical range after rolling
  usage. Interrupt between chunks, retry a lost acknowledgement, remove local cursor state after a
  server-complete import, and confirm the cursor resumes without duplicate totals or restarting
  completed work. Move the clock across January 1 and confirm a new-year cursor starts without
  deleting prior-year server rows. Verify permanent collector/network failure ends after one
  generation, retains safe pending/error state, and retries only after a new hook/manual sync. No
  daemon, watcher, polling loop, system service, or required cron should be installed.
- On Linux, macOS, and Windows, connect an OpenCode source with home/config/state paths containing
  spaces and Unicode. Confirm the installation-owned plugin is under
  `<XDG_CONFIG_HOME>/opencode/plugins` (Windows defaults to `%USERPROFILE%\.config`, never APPDATA),
  has private mode/owner-only ACL, and does not replace another plugin. Restart OpenCode and verify
  both TUI and `opencode run` idle events return immediately, `session.status: idle` is primary,
  `session.idle` is deduplicated, and every active mapped `opencode*.db` is checked in one scheduler
  generation. Unchanged profiles must send no usage payload. Repeat with custom
  `VIBERACING_STATE_DIR`, then disconnect/reset/uninstall and prove a late event creates no state.
- Verify separate Codex profiles use distinct `CODEX_HOME` roots. In one shared profile, run a real
  account A -> B -> A sequence: A and B must retain separate totals, B must never overwrite A,
  returning to A must not create a third logical source, only one physical Stop hook may exist, and
  component breakdowns must be hidden after the second identity. Repeat a known switch without
  manual source creation. For Claude, OpenCode, Kimi, Qwen, and Gemini, change only a synthetic auth
  hint inside the same local store and verify later events add to the retained history without a new
  server account. Antigravity Personal and Work must use distinct explicit capture sources and
  require `--source`; repeated runs within one capture source add together. Remove an upstream usage
  file and verify its observed events remain until they leave the rolling 31-day UTC range.
- Verify removing or server-retiring one source removes only its owned hook; multi-account
  reassignment immediately rebuilds totals; missing sequence state resumes from the server value;
  and offline disconnect removes hooks and the device token. Race disconnect/remove/uninstall
  against an in-flight sync, verify dashboard disconnect is reconciled during active use, and verify
  partial uninstall continues across later roots while retaining failed-root metadata for retry.
  Race reconnect and doctor reconciliation against an in-flight sync; verify only the replacement
  token survives, a repaired connector clears the 426 automatic-disable flag, and a lock timeout
  gets exactly one bounded deferred acquisition.
- After Codex connect or the first upgrade to the stable hook launcher, run `/hooks`, inspect and
  trust the Vibe Racing `Stop` hook, then confirm `doctor` reports `codex hook: current`. Complete a
  turn and verify one dirty generation reaches the server within two minutes. Run `doctor --repair`
  again and confirm the hook remains trusted and its command identity is unchanged; do not use a
  hook-trust bypass or write `trusted_hash` from the connector.
- Verify two linked Codex computers follow `complete 100` then newer `complete 90`; dashboard, daily
  summary, chart, leaderboard, and component selection must all show the same corrected value for
  Week, Month, All time, and Custom. Verify invalid/custom-out-of-year query parameters fall back
  safely, **All time** ends today and means the current UTC calendar year, and the accessible SVG
  chart supports keyboard/pointer zoom, pan, reset, exact UTC tooltips, a text summary, and an
  equivalent daily table. A later partial may provisionally advance the value, and the next complete
  must correct it down. Verify an explicit complete zero inside an outer partial snapshot corrects a
  covered day without changing an uncovered day. Verify automatic matching requires at least seven
  exact matched days, three distinct positive totals, a span of at least six days, zero conflicts,
  and preserves Undo.
- Verify protocol v5 accepts a January chunk later in the same UTC year, rejects prior-year and
  future dates, bounds every chunk to 31 inclusive dates, requires its explicit kind, and accepts a
  terminal history status only on the January 1 chunk. Verify historical partial state does not
  overwrite rolling completeness, an explicit complete historical entry can correct down, and a
  partial entry cannot. Verify v4 still rejects the older range and applies a collector error only
  at its exact observed sequence. Re-run v2-v4 pairing and usage compatibility scenarios, including
  replacement of an unsequenced pending v2/v3 error by the current ordered observation.
- Pair fixtures or disposable accounts for each enabled adapter; do not use real transcripts in
  screenshots or issue reports.
- Recheck the documented upstream versions before release. Antigravity Desktop is not supported.
- With archive distribution, verify dashboard connect and repair use the exact same-origin versioned
  tarball and uninstall uses the stable same-origin tarball. With npm distribution, verify all three
  use fixed `@viberacing/connector@latest` commands without `--package`, `--allow-remote`, a
  concrete version, or a downloads URL.
- Pair or retain an installation below `VIBERACING_MIN_CONNECTOR_VERSION` and verify its computer
  card and the signed-in home page show **Connector update required** on desktop and mobile. Confirm
  a version at or above the minimum does not advertise an unpublished bundled version. Run a newer
  one-off CLI against an older installed runtime and confirm neither notice nor **Sync all agents**
  changes. Run `doctor --repair`, confirm it repairs runtime/hooks without a usage request,
  interrupt its first reconciliation, and verify a later normal sync repeats the pending handler
  attestation. Only the matching server acknowledgement may clear pending state and update both
  notices. Finally downgrade and remove the owned handler after protocol 2 and verify later contacts
  retract the all-agent action.
- Confirm the macOS CI gate receives a synthetic custom-scheme URL through the real LaunchServices
  applet.
- Confirm public copy reports eight counted agents after the Cursor server-first rollout.

## Cursor 0.7.0 release gate

- Keep the implementation PR Draft until live A/B/A with a second real account passes. Accepted
  Desktop/interactive/headless exact-source evidence does not replace final implementation smoke.
- Validate Desktop one/two turns, interactive CLI, `viberacing run cursor`, aggregate subagents,
  abort, Desktop A + CLI A equality, replay, hook remove/repair, and privacy canaries using only
  minimized reports. Direct headless runs, Tab, Bugbot, Cloud Agents and SDK remain excluded.
- Check clean install, crash recovery, Windows ACL and `.cmd`/`.bat` argument/signal behavior in the
  actual packaged runtime on macOS, Linux and Windows. Verify reset/re-pair and lost-response
  retries cannot replay old events into new `source_sum` sources. Retain unacknowledged suffixes.
- Verify fresh migrations 001 → 012 and populated 011 → 012, generic Codex/Cursor registration,
  cross-agent ownership, two-machine source summation, account lifecycle, protocol-v1 account Sync,
  protocol-v2 installation Sync, accessibility and exact-head required CI.
- After separate approval, deploy the server registry, registration policy and migration 012 first;
  confirm `/ready` reports schema 012 and old connector 0.6.0 still syncs. Only then publish the
  reviewed 0.7.0 connector. Merge, deployment, Railway changes, npm publication, tags and releases
  are separate actions; none is part of this implementation PR's authorization.

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
- For 0.5.0, merge the compatible server and migration first, wait for Railway, verify `/ready`
  reports `007_account_switch_safety.sql`, and exercise authenticated dynamic Codex source
  registration before creating the exact-main `v0.5.0` tag and GitHub Release. Wait for Trusted
  Publishing, verify both the immutable `@viberacing/connector@0.5.0` package and `latest`, complete
  Linux/Windows/macOS smoke plus a real Codex A -> B -> A run, and only then decide whether the
  compatibility floor needs to become `0.5.0`. Do not change the floor merely because 0.5.0 is the
  latest release.
- For 0.6.0, merge and deploy the server-side protocol-v5 compatibility plus migration 010 before
  publishing the connector. Verify migration 010 backfills `daily_agent_usage` from existing source
  rows with exact `account_max`/`source_sum` precedence, retains writable `weekly_agent_usage`,
  mirrors a previous-release weekly write into the daily summary, `/ready` names migration 010, and
  v2-v4 connectors still sync recent usage. Only then create an exact-main `v0.6.0` release, wait
  for the immutable package and `latest`, and run a real interrupted/resumed current-year import.
  Raising the compatibility floor, deploying, publishing, tagging, or changing Railway remains a
  separate authorization decision.
- Keep both cleanup phases out of the migration-010 deployment. Deployment A shipped code that
  stopped all weekly writes and removed the weekly objects from readiness; it was verified healthy
  while those database objects remained. Deployment B then ran migration 011 to remove both
  triggers, their functions, and the table. Confirm migration 011 is recorded, `/ready` returns 200,
  the weekly table and compatibility triggers are absent, and daily aggregates still match the
  authoritative source rows. The CI weekly-bridge contract must continue rejecting destructive
  compatibility migrations while any production application reference remains.

## PostgreSQL operations

- Enable automated backups and retention in Railway.
- Perform and document a restore into a separate database before launch and periodically after.
- Alert on `/ready`, database capacity, migration failure, elevated 5xx, and exhausted rate limits.
- For a bad local total, repair/remove the source data and sync a newer complete snapshot. For an
  unrecoverable source, delete its agent account through the dashboard; cascading FKs delete its
  usage and summaries are rebuilt.
