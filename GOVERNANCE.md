# Governance

Vibe Racing is currently a maintainer-led project.

## Roles

- **Users** use the project and provide feedback.
- **Contributors** submit issues, documentation, tests, or code under the project license.
- **Maintainers** review and merge changes, publish releases, moderate community spaces, and handle
  security reports.

The current project lead and maintainer is [@Tah10n](https://github.com/Tah10n).

## Decisions

Routine changes are decided through issues and pull requests. The maintainer evaluates product
scope, evidence, maintenance cost, compatibility, privacy, and security. Broad changes should be
discussed before implementation.

Vibe Racing deliberately remains one web service, one PostgreSQL database, and one local connector.
Queues, caches, workers, new databases, or additional services require a measured production need.

The privacy and security properties documented in [SECURITY.md](SECURITY.md),
[docs/PRIVACY.md](docs/PRIVACY.md), and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) are project
constraints, not optional implementation details.

## Becoming a maintainer

Maintainers are invited based on sustained, trustworthy contributions, sound judgment, respectful
collaboration, and demonstrated care for the project's privacy and security boundaries. There is no
automatic contribution-count threshold.

When a second active maintainer is appointed, protected-branch policy should require at least one
approval from someone other than the latest pusher and Code Owner review for security-sensitive
paths.

## Changes to governance

Governance changes use the normal pull request process and must be documented in this file. The
project lead makes the final decision while the project has only one maintainer.
