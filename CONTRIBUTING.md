# Contributing to Vibe Racing

Vibe Racing is currently building its public foundation. Contributions should preserve the public
trust model and keep the repository safe to publish.

## Before contributing

Read:

- [Project plan](docs/PROJECT_PLAN.md)
- [Security invariants](docs/architecture/SECURITY_INVARIANTS.md)
- [Repository guidance for agents](AGENTS.md)
- [Security policy](SECURITY.md)
- [Public repository data policy](docs/security/PUBLIC_REPOSITORY_POLICY.md)
- [Local development](docs/getting-started/LOCAL_DEVELOPMENT.md)
- [Dependency policy](docs/security/DEPENDENCY_POLICY.md)

Security vulnerabilities must follow SECURITY.md and must not be opened as ordinary public issues.

## Public-data rule

Use synthetic data only. Never contribute:

- production credentials or environment values;
- real account emails, IDs, IP addresses, usage buckets, logs, or screenshots;
- local machine paths or Codex session content;
- copied private incident reports;
- third-party assets without documented permission and attribution.

Review the complete diff before submission. Removing a secret in a later commit does not remove it
from Git history.

## Contribution workflow

1. Start with an issue or ADR for a behavior, protocol, trust-boundary, scoring, persistence, or
   deployment change.
2. Keep pull requests focused and describe user impact, security impact, migration, rollback, and
   verification.
3. Add negative tests for authorization, parsing, state transitions, and abuse paths affected by the
   change.
4. Update public contracts and documentation in the same pull request.
5. Confirm generated artifacts match their declared source.
6. Sign off commits under the [Developer Certificate of Origin](https://developercertificate.org/)
   with `git commit -s`.

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

Before a commit, stage only the intended files and run:

```text
pnpm run check:public:staged
git diff --cached --check
```

Then inspect the complete `git diff --cached`. Automated pattern checks do not replace review of
meaning, binary metadata, asset provenance, or Git history. Do not claim application build or test
success until those checks exist.
