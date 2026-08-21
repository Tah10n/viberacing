# Changelog

All notable user-visible changes to Vibe Racing will be documented in this file.

The connector follows [Semantic Versioning](https://semver.org/). The web application is deployed
continuously; its changes are grouped with the connector release when they affect the shared user
experience or protocol.

## [Unreleased]

### Changed

- Squashed the unreleased database history into the first locked pre-production baseline. Databases
  created from earlier commits are unsupported and must be recreated before deployment.

### Added

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
