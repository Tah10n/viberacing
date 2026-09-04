# Changelog

All notable user-visible changes to Vibe Racing will be documented in this file.

The connector follows [Semantic Versioning](https://semver.org/). The web application is deployed
continuously; its changes are grouped with the connector release when they affect the shared user
experience or protocol.

## [Unreleased]

### Added

- Added an opt-in, repository-only Cursor evidence probe and a dated evidence report. The probe
  records only minimized schemas (HMACing unknown field names), exact integer counter candidates,
  local HMAC identities, safe status/version fields, and unambiguous timestamps outside the
  repository. Its per-run/event immutable runtime bundle, execution-time POSIX/Windows integrity
  checks, lossless compare-and-swap recovery, pre-mutation ownership validation, close-aware UTF-8
  CLI stream handling, explicit scenario steps, strict alias/event reconciliation, and always-closed
  production gate harden research collection without asserting a token formula. Cursor remains
  unsupported and is not registered because current Desktop and CLI evidence does not prove one
  authoritative exact source.

- Connector 0.6.0 and protocol v5 add a resumable current-UTC-year import after the normal rolling
  snapshot. History moves newest-first in acknowledged chunks of at most 31 dates, uses isolated
  adapter state, finishes as `complete` or `partial`, resumes after interruption or a lost response,
  and starts a fresh cursor at the next UTC year without deleting older server rows. Automatic and
  browser-triggered runs drain bounded pending payloads and collect at most one new historical
  range; connect and manual Sync finish every eligible chunk.
- Week, Month, current-year All time, and current-year Custom selectors now drive one shared UTC
  period across leaderboard, public profiles, and dashboard totals. The dashboard adds a
  dependency-free accessible SVG daily chart with pointer and keyboard zoom/pan/reset, exact UTC
  tooltips, a text summary, and an equivalent daily table.
- Migration 010 adds exact per-day `daily_agent_usage` summaries and source-level current-year
  backfill status. It backfills existing data with the same `account_max` and `source_sum`
  precedence used by live ingestion, while temporarily retaining and maintaining the legacy weekly
  summary for a safe expand-contract deployment.
- `viberacing sync --full` explicitly retries terminal partial current-year history with a durable
  cursor, while ordinary, automatic, and browser Sync leave that recovery opt-in.
- `connect` and `doctor --repair` now reconcile one strict installation-owned OpenCode plugin under
  the global XDG `opencode/plugins` directory. After one OpenCode restart it handles
  `session.status: idle`, deduplicates the `session.idle` fallback for two seconds, synchronously
  starts the stable detached launcher, and returns without reading session IDs, project context, or
  any private event payload.
- One hidden bulk hook atomically marks every active mapped OpenCode SQLite source for the current
  installation under the existing dirty lock, then reuses the existing scheduler single-flight,
  debounce, cooldown/maximum-delay, and fingerprint suppression. Custom state roots are explicit,
  and a stale plugin cannot recreate state after disconnect, source retirement, reset, or uninstall.
- Plugin ownership uses a strict schema marker bound to the installation and a local state-root
  hash, bounded regular-file inspection, no symlinks/hardlinks/reparse points, POSIX owner/mode
  checks, owner-only Windows ACLs, and exclusive same-directory publication. Owned updates and
  removals first move the public entry to a unique quarantine and verify the same inode and bytes
  through an open file handle. A raced foreign regular file is restored without replacement; other
  raced file types are preserved at the reported recovery path. Foreign and newer-schema plugins are
  never overwritten or deleted, and multiple installations use separate files.
- Connector CI now runs a pinned Bun smoke for the OpenCode 1.18.23 compatibility target on Ubuntu,
  Windows, and macOS with spaces/Unicode paths and a real detached Node launcher.

### Changed

- Every adapter now applies the requested date range before events consume ledger limits or affect
  chunk completeness. OpenCode uses a range-bounded SQLite query, Qwen opens only intersecting month
  files, and historical collection cannot replace rolling checkpoints, fingerprints, or diagnostics.
- Protocol v2-v4 remains accepted during the server-first rollout. Older connectors continue recent
  usage sync, while the dashboard asks users to update before importing earlier current-year dates.
- The stable launcher sets `VIBERACING_STATE_DIR` from its own absolute location before importing
  the versioned runtime, preventing custom installations from falling back to `~/.viberacing`.
- `doctor` inspection is read-only and reports `OpenCode automatic sync plugin: <status>`; repair
  updates runtime/hooks/plugin without running usage Sync and requests a restart only after plugin
  creation or update.

### Fixed

- Inactive Codex logical accounts no longer cause an unbounded manual history loop; their cursor is
  retained until that account is active. Runtime-state schema v3 is also accepted by the existing
  fail-closed OpenCode cutover preflight.
- `connect` now revalidates the prior connection generation, installation identity, source registry,
  and pending OpenCode cleanup under the pre-pairing lifecycle boundary. A stale process therefore
  cannot recreate local authorization after a concurrent `disconnect` has removed it.

These changes are staged only. This work does not publish npm, create a tag or GitHub Release,
deploy, change Railway variables, or raise the minimum connector version.

## [0.5.0] - 2026-08-26

### Added

- A read-only OpenCode upgrade preflight now guards every recovery-state mutator: source add/remove,
  Antigravity source/executable persistence, reset, connect, manual/automatic/browser Sync,
  doctor/repair, hooks, pending delivery, reconciliation, and source-schema migration. Mutating
  lifecycle and sync paths recheck after exclusion, immediately before their first write or network
  mutation. `source list`, `accounts`, `--version`, explicit `disconnect`, and explicit `uninstall`
  remain available.
- The OpenCode cutover proof must equal the maximum local sequence across config, runtime state,
  pending snapshots, and a pending 0.4.4 attempt. A stale 0.4.3 Browser Sync, unconfirmed pending
  payload, or sequence race therefore fails byte-for-byte with the exact 0.4.4 recovery command.
  Preflight streams only selected OpenCode fields from `state.json`, so aggregate state is no longer
  capped at 20 MiB while every selected ledger retains its own bound.
- One physical Codex `CODEX_HOME` can now track up to eight ChatGPT accounts. The connector reads
  local `tokens.account_id` before App Server startup and after usage, requires both
  generated-schema account reads to return the same non-null normalized email, derives only a local
  salt-scoped HMAC from email plus account ID, fails closed when either half is unavailable or
  unstable, dynamically registers generic logical sources, and routes each stable snapshot to the
  active account without sending provider identity.
- Codex account switching currently requires file-backed `CODEX_HOME/auth.json`; keyring-only and
  ephemeral identity remain unsupported, and separate profile roots do not substitute for the
  missing auth file.
- Claude, OpenCode, Kimi, Qwen, Gemini, and captured Antigravity usage now share a bounded 31-day
  observed-event ledger. Hashed event identities and exact token tuples survive record deletion,
  movement, copying, and current-database cleanup without retaining provider IDs or content.

### Changed

- Codex installs one hook per physical profile. Account-scoped Sync asks the user to switch Codex
  when its logical account is inactive; installation-wide Sync refreshes the active account and
  reports other Codex accounts as inactive. Local component breakdowns are hidden for shared
  profiles because transcript events do not prove account ownership.

### Fixed

- Reusing a local event identity with different counters now keeps the first exact tuple, marks the
  collection partial, and emits only the allowlisted `local_event_identity_conflict` diagnostic.
- The first 0.5.0 collection migrates Claude v1 and legacy JSONL state into the bounded ledger;
  OpenCode combines its exact server baseline only with message-ID aliases confirmed by an accepted
  connector 0.4.4 snapshot. Direct 0.4.3 upgrades fail closed with migration guidance instead of
  treating every current SQLite row as already accepted and losing an unsynced tail. Accepted
  history remains non-destructive until it ages out of the rolling UTC window, and full-ledger
  events replay after pruning.
- Pairing now carries physical profiles only. Codex logical sources require an exact
  server-confirmed profile relation, survive installation reset without identity drift, and
  installation Browser Sync delivers a newly registered active account in the same operation.
- Local source and runtime state use versioned schema v2 writes with fail-closed validation, a
  32-source installation bound, an eight-account physical-profile bound, and no duplicate Codex hook
  installation.

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
