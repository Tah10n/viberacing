# Contributing to Vibe Racing

Vibe Racing is currently building its public foundation. Contributions should preserve the public
trust model and keep the repository safe to publish.

External contribution status: closed during pre-public preparation. Do not open or solicit outside
issues or pull requests until the publication gate in [MAINTAINERS.md](MAINTAINERS.md) is complete.
These instructions define the future contribution contract and apply to maintainer changes now.

## Before contributing

Read:

- [Project plan](docs/PROJECT_PLAN.md)
- [Security invariants](docs/architecture/SECURITY_INVARIANTS.md)
- [Threat model](docs/security/THREAT_MODEL.md)
- [Abuse cases](docs/security/ABUSE_CASES.md)
- [Privacy data map](docs/security/PRIVACY_DATA_MAP.md)
- [Architecture decisions](docs/decisions/README.md)
- [Compatibility policy](docs/architecture/COMPATIBILITY_POLICY.md)
- [Repository guidance for agents](AGENTS.md)
- [Security policy](SECURITY.md)
- [Public repository data policy](docs/security/PUBLIC_REPOSITORY_POLICY.md)
- [Local development](docs/getting-started/LOCAL_DEVELOPMENT.md)
- [Dependency policy](docs/security/DEPENDENCY_POLICY.md)
- [Governance](GOVERNANCE.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [Maintainers and publication gate](MAINTAINERS.md)
- [Support policy](SUPPORT.md)

Security vulnerabilities must follow SECURITY.md and must not be opened as ordinary public issues.

## Public-data rule

Use synthetic data only. Never contribute:

- production credentials or environment values;
- real account emails, IDs, IP addresses, usage buckets, logs, or screenshots;
- local machine paths or Codex session content;
- copied private incident reports;
- third-party assets without documented permission and attribution.

Review the complete diff before submission. Removing a secret in a later commit does not remove it
from Git history. `pnpm run check:history` scans all locally reachable history and rejects shallow
clones, but contributors must still rotate a real exposed credential before history repair.

## Contribution workflow

1. Start with an issue or ADR for a behavior, protocol, trust-boundary, scoring, persistence, or
   deployment change.
2. Keep pull requests focused and describe user impact, security impact, migration, rollback, and
   verification.
3. Add negative tests for authorization, parsing, state transitions, and abuse paths affected by the
   change.
4. Update public contracts and documentation in the same pull request. Link affected threat
   boundaries, abuse-case IDs, privacy fields, compatibility axes, and ADRs.
5. Confirm generated artifacts match their declared source. Dependency changes require review of the
   full lockfile, `config/license-policy.json`, `THIRD_PARTY_NOTICES.md`, and the regenerated
   dependency inventory; regeneration alone is not approval.
6. Sign off commits under the repository's [Developer Certificate of Origin](DCO.txt), kept
   byte-for-byte equivalent to the official [DCO 1.1](https://developercertificate.org/), with
   `git commit -s`. Use only an explicitly confirmed public GitHub-verified or GitHub-provided
   `noreply` identity. That narrow Git metadata exception does not permit an email address in a
   tracked file or ordinary commit-message text.

## Review requirements

Changes to auth, passkeys, connector, request signing, contracts, database privileges, edge
verification, workflows, release, or deletion require security-focused review.

Do not bypass a security invariant to preserve backward compatibility. Propose an ADR with migration
and rollback instead.

## Current verification

Install exact locked dependencies without lifecycle scripts, then run the checks implemented in the
tree:

```text
pnpm install --frozen-lockfile --ignore-scripts
pnpm run verify
```

Use the package-specific lint, type, and unit-test commands while iterating. The root `verify`
command is the bounded cross-workspace development gate; it deliberately excludes coverage,
production builds, reachable-history scans, checker mutation suites, visual evidence, and
Docker-backed integrations. Run `pnpm run verify:release` only for release/publication preparation
or a broad cross-cutting change.

Before a commit, stage only the intended files and run:

```text
pnpm run check:public:staged
git diff --cached --check
```

Then inspect the complete `git diff --cached`. Automated pattern checks do not replace review of
meaning, decoded binary metadata, asset provenance, unreachable local Git objects, or remotes that
will actually be pushed. Do not claim application build or test success until those checks exist.

Project maintainers also run `pnpm run check:publication` before the first public announcement. It
is intentionally not part of normal verification because a correctly disclosed pre-public tree is
expected to fail until hosted identities and controls exist.
