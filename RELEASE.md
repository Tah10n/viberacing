# Release policy

Vibe Racing has no released application or connector. A Git tag, package, image, binary, deployment,
or changelog entry must not imply production support until the evidence below exists.

## Versioning and channels

Public contracts, services, web deployments, and connector binaries have separate compatibility and
rollback concerns. Their versions and support windows will be documented before the first release.
Pre-release artifacts use explicit preview identifiers and carry no production support promise.

Only protected `main` history can produce a release. Pull-request workflows remain untrusted and
never receive signing, deployment, registry, or production credentials. Trusted release and deploy
workflows must be separate, environment-protected, least-privileged, and manually approvable.

## Required release evidence

- Clean, reviewed source and generated artifacts at an immutable commit.
- Passing formatting, lint, type, unit, integration, security, contract, documentation, and platform
  tests appropriate to the component.
- Reviewed dependency and license inventory, vulnerability audit, SBOM, and third-party notices.
- Reproducible build instructions, checksums, signatures, and verifiable build provenance.
- Compatibility, migration, backup, restore, deletion, monitoring, and rollback evidence.
- Updated changelog, supported-version table, public API and CLI reference, and known limitations.
- Hosted branch, environment, secret-scanning, private-reporting, access, and audit settings
  verified outside the repository.
- No secrets, personal data, private logs, local paths, unsigned binaries, or unreviewed assets in
  source or artifacts.

## Release procedure

1. Open a release pull request containing version and changelog changes plus links to evidence.
2. Obtain independent review for security-sensitive components and confirm DCO and provenance.
3. Merge through protected `main`; do not build a release from an unreviewed branch or local tree.
4. Create the immutable tag through the trusted release workflow.
5. Build once, attach SBOM, provenance, checksums, and signatures, and promote the same verified
   artifact between environments.
6. Verify installation, health, telemetry redaction, and published signatures from a clean client.
7. Announce only after rollback owners and monitoring are active.

Connector artifacts require platform-specific signing where available plus a project signature and
published checksum. Container images use immutable digests. Web releases record the source commit,
migration state, and exact deploy artifact.

## Rollback

Every release has a documented rollback or forward-fix path before promotion. Database migrations
must state whether they are reversible, how mixed versions behave, and how backups were restored in
a test environment. Connector revocation must distinguish a compromised artifact from an unsupported
version without silently trusting either.

If integrity, authorization, privacy, or scoring correctness is uncertain, stop promotion and
disable the affected feature. Never restore service by weakening request verification, signature
checks, source isolation, deletion guarantees, or Community/Verified separation.

## Records

Release notes, approvals, checksums, signatures, provenance, SBOMs, known issues, rollback outcome,
and supported-version changes are durable public records. Secrets and private incident evidence stay
in approved private systems and are referenced only by non-sensitive identifiers.
