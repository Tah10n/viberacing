# Changelog

All notable user-visible changes to Vibe Racing will be documented in this file.

The connector follows [Semantic Versioning](https://semver.org/). The web application is deployed
continuously; its changes are grouped with the connector release when they affect the shared user
experience or protocol.

## [Unreleased]

### Changed

- Connector 0.4.0 uses protocol v4 to sequence allowlisted collector errors against the last
  server-accepted source snapshot. Delayed errors can no longer overwrite a newer success; the
  server remains compatible with v2/v3 payloads during the server-first rollout.
- Account-wide daily totals now prefer the newest complete observation, so a newer provider
  correction can replace an older larger value from an offline computer. Dashboard components,
  charts, weekly summaries, profiles, and leaderboard totals use the same precedence boundary.
- Codex sends explicit complete zero entries only for missing days inside a successfully read,
  continuous App Server range. These are authoritative correction markers, never estimates.
- Automatic account matching now requires two complete positive matching days with two distinct
  totals and no complete contradiction. Manual reassignment and the existing Undo flow remain
  available.
- Pre-authentication admission now applies an atomic global cap before creating canonical client
  buckets, groups IPv6 by `/64`, and performs bounded opportunistic cleanup. Configured origins with
  URL credentials are rejected without exposing those credentials.
- A fully successful authenticated usage delivery now clears the connector's stale hook-error log,
  so `doctor` no longer recommends reconnecting after a later Connect, manual Sync, browser Sync, or
  changed automatic Sync succeeds. Partial and request-free automatic checks retain the last failure
  for diagnosis.
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

Existing historical versions have not been backfilled because the repository does not yet have
authoritative release tags. The first release entry should be created from a verified release commit
rather than inferred from package metadata alone.
