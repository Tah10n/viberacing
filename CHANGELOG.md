# Changelog

All notable user-visible changes to Vibe Racing will be documented in this file.

The connector follows [Semantic Versioning](https://semver.org/). The web application is deployed
continuously; its changes are grouped with the connector release when they affect the shared user
experience or protocol.

## [Unreleased]

### Changed

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
