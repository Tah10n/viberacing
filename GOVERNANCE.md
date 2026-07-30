# Governance

Vibe Racing is currently a maintainer-led public source-only pre-release project. Governance is
operational through the real public maintainer recorded in [MAINTAINERS.md](MAINTAINERS.md), while
external participation remains closed. No identity is inferred from a workstation, Git
configuration, commit history, or private account.

## Principles

- User safety, privacy, and the published trust model outrank growth and convenience.
- Decisions and authority must be visible in the public repository.
- Access is least-privileged, attributable, reviewed, and removable.
- Material product and security decisions require durable documentation.
- Community ranking data remains self-reported and grants no reward, privilege, or access.
- Maintainers disclose conflicts and do not approve their own sensitive changes alone.

## Roles

### Maintainers

Maintainers triage contributions, review changes, keep documentation accurate, and steward project
direction. A maintainer must have a public GitHub identity, accept the code of conduct, use strong
multi-factor authentication, and be listed in MAINTAINERS.md before exercising public authority.

### Security responders

Security responders receive confidential reports and coordinate remediation. They need access only
to the reporting and affected operational systems. At least one responder must be independent of the
author of a security-sensitive change before that change is released.

### Release managers

Release managers can initiate a trusted release but cannot bypass protected-branch, review,
artifact-signing, or provenance requirements. Production deploy and connector-signing authority
should be separable as the team grows.

### Contributors

Contributors propose issues, documentation, designs, tests, or code under the project license and
the [Developer Certificate of Origin](DCO.txt). Contribution does not automatically grant an ongoing
project role.

One person may temporarily hold several roles during bootstrap, but every action still follows the
same review and audit requirements. Role concentration is a recorded risk and must not be hidden.

## Decision process

Routine, reversible changes use review in a focused pull request. Maintainers seek reasoned
consensus based on evidence, documented constraints, and user impact. If consensus is not reached,
the accountable maintainer records the decision and dissent instead of silently overriding it.

An architecture decision record is required before changing trust boundaries, authentication, data
collection, scoring semantics, source aggregation, public contracts, database ownership, deployment
topology, signing, release channels, or compatibility guarantees. ADRs include options, security and
privacy effects, migration, rollback, and supersession rules.

Emergency changes may be narrower and privately coordinated, but they require retrospective tests,
documentation, and a public explanation after disclosure is safe.

## Security decisions

Changes to authentication, passkeys, pairing, request signing, connector collection, ranking,
deletion, workflow permissions, release signing, or production access require a security-focused
review from someone other than the author. Untrusted pull-request code never receives deployment,
signing, production, or private-report credentials.

A maintainer may pause a release or disable a feature when credible safety concerns exist. Security
embargoes may temporarily limit public detail, but not permanently erase the decision record.

## Conflicts and removal

Maintainers disclose financial, employment, personal, or competitive conflicts that could reasonably
affect judgment and recuse when appropriate. The remaining non-conflicted maintainers decide the
review path. If none remain, the change waits or an independent reviewer is appointed and
documented.

A maintainer may step down voluntarily or be removed for inactivity, compromised access, repeated
policy violations, undisclosed conflicts, or conduct enforcement. Removal includes prompt access
revocation, CODEOWNERS and MAINTAINERS updates, credential rotation where needed, and a public
record that does not expose confidential reports.

## Changing governance

Governance changes use a pull request, an explicit rationale, and approval from all active
non-conflicted maintainers. Changes that reduce review independence, privacy, or security controls
must explain the replacement safeguard and rollback path.
