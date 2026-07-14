# ADR 0006: Every tracked artifact is immediately public-safe

- Status: Accepted (repository controls partially implemented)
- Date: 2026-07-14
- Decision owners: Repository, CI, Release, Documentation, and Maintainers
- Supersedes: None
- Superseded by: None

## Context

Vibe Racing is intended to be developed in a public open-source repository. Git history, pull
requests, CI logs, fixtures, screenshots, generated files, releases, and agent instructions can all
be copied permanently. A later deletion does not reliably remove a credential or personal record
from clones, notifications, caches, or archives.

Local Git identity, filesystem names, browser state, Codex sessions, logs, and production settings
are private workstation context. They must not be inferred into public ownership or contact files.

## Decision

Treat every tracked file and commit as safe for immediate disclosure. Use synthetic fixtures and
reserved example values only. Keep production/staging credentials, real users, private logs,
incidents, live thresholds, account email, prompts, repository data, local paths, and signing
material outside Git and public CI.

Reject tracked symbolic links and submodules so checks cannot traverse into a workstation or mutable
external source. Before each commit, scan the exact staged blobs, check the staged diff, and inspect
it manually. Before first publication, scan all reachable Git objects and verify hosted security
settings.

Use a neutral repository-local commit identity until the user supplies an intentional public
identity. Leave MAINTAINERS, CODEOWNERS, conduct contact, and remote publication blocked rather than
copying private local values or inserting a false owner.

## Security and privacy consequences

The policy reduces accidental disclosure and makes examples safe to reuse. Pattern scanners remain
defense in depth: they cannot understand every private fact, binary metadata, semantic disclosure,
Git history, or external system.

Some useful production detail must stay in private operational systems. Public schemas, safe bounds,
state machines, and tests still demonstrate control shape so secrecy is not the security mechanism.

## Alternatives considered

- **Develop privately and sanitize later:** rejected because history and habits accumulate private
  context that is difficult to prove removed.
- **Rely on `.gitignore`:** rejected because tracked/staged content, generated output, logs, and
  manual additions bypass it.
- **Allow links/submodules:** rejected because repository checks and readers could follow mutable or
  private targets and provenance becomes harder.
- **Insert local maintainer identity now:** rejected because workstation identity is not consent for
  public disclosure.
- **Publish detailed anti-abuse thresholds:** rejected where detail materially helps evasion; public
  code still enforces safe maximum shapes and configuration validation.

## Migration and rollback

The decision applies from the first commit and cannot be rolled back for already disclosed history.
A suspected credential is rotated before work continues. If a private value enters a commit, stop
publication, assess all copies, rewrite only with explicit coordination, and still treat the value
as compromised.

Exceptions for a legitimate project contact, binary asset, dependency build, or generated artifact
need narrow policy, provenance, automated regression coverage, and review; exceptions never permit a
live secret or real user record.

## Verification

- Whole-tree and exact staged-blob public-file scans with black-box negative fixtures.
- Manual complete staged diff and binary metadata/provenance review.
- Documentation and configuration gates using synthetic examples.
- Full reachable-history secret/privacy scan immediately before remote publication.
- Hosted GitHub secret scanning, push protection, branch/CODEOWNERS, private reporting, fork, and
  workflow-permission verification.
- Release artifact and SBOM inspection independent of source-tree checks.

## References

- [Public repository data policy](../security/PUBLIC_REPOSITORY_POLICY.md)
- [CI trust model](../architecture/CI_TRUST_MODEL.md)
- [Maintainer publication gate](../../MAINTAINERS.md)
