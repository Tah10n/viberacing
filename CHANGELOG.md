# Changelog

All notable user-visible changes to Vibe Racing will be documented in this file.

The connector follows [Semantic Versioning](https://semver.org/). The web application is deployed
continuously; its changes are grouped with the connector release when they affect the shared user
experience or protocol.

## [Unreleased]

## [0.4.3] - 2026-08-26

### Added

- The dashboard can now sync every supported agent on the browser-bound computer in one action,
  while retaining account-scoped Sync for older connectors and individual refreshes. The account
  list is collapsible, and the lemon accent has shifted slightly greener.
- Absolute interface times, including race end and Last sync, now use the browser's real time zone
  with an explicit zone label. Token dates, daily buckets, and weekly ranking boundaries remain UTC.

### Fixed

- Installation-wide browser Sync is now gated by the explicitly reported installed-handler protocol.
  Running a newer one-off CLI no longer exposes an action that an older registered OS handler cannot
  process. Successful `connect` or `doctor --repair` saves a durable installed-runtime/handler
  attestation before reconciliation and retries it until acknowledged; later OS inspection safely
  reports handler downgrade or removal.
- Production CI now rejects changed connector archive inputs unless the package has a strictly newer
  stable version than the pull-request base, preventing modified bytes from being bundled as an
  already published 0.4.2. This change stages connector 0.4.3 without publishing it from the pull
  request.
- The browser Sync protocol migration remains writable by the previous web release during pre-deploy
  and rollback windows. Installation-wide runs no longer depend on an arbitrary account, and the
  existing 32-source connector bound is enforced before a grant or run is consumed.
- Signed-in racers now see the same compatibility-floor update command on the home page and on each
  affected dashboard computer, so a required connector repair is visible before opening settings.
- Connector release verification now tolerates npm publish-time scanning by waiting up to 30 minutes
  for both the exact immutable version and `latest`, while the workflow retains a bounded 45-minute
  job timeout. Production and onboarding documentation now reflect the completed npm rollout, the
  live Railway origin, and Codex's required one-time `/hooks` review.
- Claude Code, OpenCode, Kimi Code, Qwen Code, Gemini CLI, and Antigravity collectors now fail
  closed on malformed or unsupported usage records. They send a partial snapshot, retain the last
  complete incremental state, and emit only the allowlisted `local_store_schema_unsupported`
  diagnostic.
- `doctor --repair` now atomically restages the current runtime even when every expected path still
  exists, repairing truncated, changed, and missing files of the same connector version.
- Connector publishing can resume after npm accepted an immutable version but the workflow stopped:
  matching tarball integrity, repository metadata, and `gitHead` skip the second publish and
  continue bounded verification, while mismatches fail closed.
- Automatic account matching now requires seven exact positive complete days spanning at least a
  week and three distinct totals. Public admission has a shared ceiling, expired rate-limit rows are
  drained in bounded 10,000-row batches, the CLI defaults to the live Railway origin, and production
  responses include a one-year HSTS policy without `includeSubDomains` or `preload`.

## [0.4.2] - 2026-08-25

### Fixed

- Codex hooks now invoke a stable local launcher instead of a versioned runtime path, so an explicit
  connector update no longer changes the trusted hook identity on every release. Connect and
  `doctor` query Codex's official `hooks/list` status, report untrusted, modified, or disabled
  hooks, and direct the user to review the Vibe Racing `Stop` hook without bypassing Codex hook
  trust.

## [0.4.1] - 2026-08-25

### Fixed

- Release validation now accepts the scalar and singleton-array JSON forms returned by npm 12 for
  `latest` and exact-version lookups, while rejecting empty, ambiguous, and non-string responses.

## [0.4.0] - 2026-08-25

### Changed

- Connector onboarding now supports one centrally configured distribution: the official service can
  use the permanent `@viberacing/connector@latest` npm commands, while self-hosted deployments
  retain the existing same-origin archive default. Installed runtimes update only through explicit
  `doctor --repair`, and mandatory dashboard notices now follow the configured compatibility floor
  instead of the bundled source version.
- Connector 0.4.0 uses protocol v4 to sequence allowlisted collector errors against the last
  server-accepted source snapshot. Delayed errors can no longer overwrite a newer success; the
  server remains compatible with v2/v3 payloads during the server-first rollout. Saved v2/v3 errors
  without ordering metadata are discarded and re-observed by the current collector rather than being
  relabeled as v4.
- Account-wide daily totals now prefer the newest complete observation, so a newer provider
  correction can replace an older larger value from an offline computer. Dashboard components,
  charts, weekly summaries, profiles, and leaderboard totals use the same precedence boundary.
- Codex sends explicit complete zero entries only for missing days between the earliest and latest
  successfully returned App Server buckets. These are authoritative correction markers, never
  estimates; the connector does not extend zero coverage to its earlier local scan boundary.
- Automatic account matching now requires two complete positive matching days with two distinct
  totals and no complete contradiction. Manual reassignment and the existing Undo flow remain
  available.
- Pre-authentication admission now applies an atomic global cap before creating canonical client
  buckets, groups IPv6 by `/64`, and performs bounded opportunistic cleanup. Configured origins with
  URL credentials are rejected without exposing those credentials.
- A fully successful authenticated usage delivery now clears the connector's stale hook-error log,
  so `doctor` no longer recommends reconnecting after a later Connect, manual Sync, browser Sync, or
  automatic pending retry succeeds, even when the following collection is unchanged. Partial and
  request-free automatic checks retain the last failure for diagnosis.
- Manual and browser-triggered Sync now submit a successfully collected snapshot even when its
  normalized usage is unchanged, so account and computer **Last sync** times advance immediately.
  Automatic hooks retain fingerprint suppression and make no usage request for unchanged data.
- Codex provisional ranking now retains every exact local day after the newest delayed App Server
  bucket across UTC rollovers. Snapshots containing any partial day are non-destructive until later
  authoritative account buckets correct the provisional values. Across linked computers, a newer
  complete observation excludes older provisional rows while later provisional usage can advance the
  total again until the next complete observation.
- Connected-computer cards now identify outdated connector versions and provide an exact,
  same-origin `doctor --repair` command. Compact reconciliation reports the current connector
  version without sending usage, and the update notice clears after server confirmation.
- `doctor --repair` now refreshes the installed runtime, owned lifecycle hooks, and the browser
  protocol handler under the existing lifecycle lock. On macOS the handler is a signed,
  transactional AppleScript applet that receives the LaunchServices URL event instead of relying on
  a missing shell positional argument.
- Browser-triggered sync now has an atomic installation-wide cooldown, rejects overlapping recent
  runs before connector work starts, and uses bounded two-to-five-second status polling with a
  per-run quota plus a higher aggregate user guard. Rejected duplicate claims settle as terminal
  `busy` results, status `429` responses use bounded backoff, and cooldown-disabled controls
  automatically recover using the bounded `Retry-After` response.
- Completed exact input/output/cache/reasoning collection for Codex and Qwen Code. Codex now keeps
  its authoritative account-wide App Server total alongside independently exact local component
  counters and marks usage dirty after each `Stop`; Qwen normalizes cached input and reasoning as
  overlapping counters.
- Squashed the unreleased database history into the first locked pre-production baseline. Databases
  created from earlier commits are unsupported and must be recreated before deployment.

### Added

- Added a stable-release-only GitHub Actions workflow for npm Trusted Publishing, with exact
  tag/package/generated-version validation, main ancestry and clean-package gates, replay
  prevention, post-publication `latest` verification, and a fail-closed manual-bootstrap boundary
  for the first publication.
- Added privacy-minimized connector diagnostics with an authenticated, source-owned server endpoint,
  allowlisted reason codes, deduplicated `opened`/`resolved` transitions, and a bounded owner-only
  retry outbox. Diagnostic delivery remains independent from usage acceptance, while the legacy
  `collector_failed` usage error is retained for dashboard compatibility.
- Browser-triggered, current-computer sync for an individual agent account through an on-demand,
  cross-platform `viberacing://` handler; no resident connector process or provider content is
  introduced.
- Open-source contribution, support, governance, issue, pull request, conduct, and release policies.
- Privacy-focused issue forms, a pull request checklist, grouped Dependabot updates, and a
  high-severity dependency review gate.
- Connector npm artifact licensing and an exact package-manifest validation gate shared by local
  verification, CI, and the release process.
- Repository social preview artwork and focused CI/license badges.

Connector 0.4.0 was the verified interactive npm bootstrap. Connector 0.4.1 was the first
GitHub-tagged release published through npm Trusted Publishing with provenance. Connector 0.4.2
completed the stable Codex hook and production npm lifecycle validation before the official Railway
service switched to the npm distribution.
