# ADR 0053: Bounded Windows portable connector lifecycle smoke

- Status: Accepted (local smoke/CI job implemented; hosted/release evidence pending)
- Date: 2026-07-18
- Decision owners: Connector, Security, Privacy, CI, Compatibility, and Release
- Supersedes: None
- Superseded by: None

## Context

Phase 4 requires clean-machine installation, upgrade, revoke, and uninstall evidence before a
connector can be packaged or supported. The repository now has a stable five-command development
CLI, exact candidate admission, and a credential-free candidate diagnostic, but it has no package,
installer, released binary, or trusted release workflow. Running only the target-tree executable
does not test whether a built connector remains intact after a portable copy or whether that copy
can be removed without residue.

Pull-request CI is untrusted. It may compile and test source on a disposable secretless runner, but
it must not upload a connector artifact, receive release or signing authority, attach a protected
environment, or imply that a locally built `0.0.0` binary is distributable. A narrow Windows smoke
can close the first copy/removal evidence gap while preserving that release boundary.

## Decision

The repository adds one bounded Windows x86_64-only black-box smoke. Its input is fixed to
`target/release/viberacing-connector.exe`, produced immediately beforehand with:

```text
cargo build --release --locked --target-dir target --package viberacing-connector --bin viberacing-connector
```

The smoke accepts no arguments or alternate artifact path. It requires one regular, non-symbolic
source file between 1 byte and 16 MiB, computes its SHA-256 digest, and creates one randomly named
directory directly under the canonical operating-system temporary directory. It exclusively copies
the binary to the fixed `portable/viberacing-connector.exe` path and requires exact size and digest
equality before execution.

The copied binary receives only two process invocations:

1. `--help`, whose zero status, empty stderr, and complete five-command stdout must match exactly.
2. `check-codex --codex <missing-temporary-file>`, whose nonzero status, empty stdout, and generic
   candidate-admission failure must match exactly and must not create the supplied path.

Both invocations use an argument array with no shell, ignored stdin, a fixed temporary working
directory, a five-second timeout, and a 16 KiB captured-output budget per stream. The child
environment is rebuilt from only the Windows loader/command-processor variables, the admitted
temporary directory for `TEMP`/`TMP`, and an empty `PATH`. No proxy, credential, profile, Cargo,
Git, CI, repository, or other ambient variable crosses the boundary. The smoke never invokes
`connect`, `sync`, `propose-car`, or `forget-local`; it therefore creates no connector credential,
calls no service, starts no Codex process, and requests no credential deletion.

After both processes finish, the smoke rechecks the source and copied digests plus the exact
temporary-file inventory. It deletes the copied binary, requires the portable directory to be empty,
removes that directory, and finally recursively removes only the previously admitted random
temporary root. Failure output contains only one fixed stage name and never a path, digest, child
output, environment value, or operating-system error.

The read-only `CI` workflow adds an exact `windows-2025` job with only:

- full-history checkout without persisted credentials;
- pinned Node setup without a package-manager cache;
- the public-file scan before native compilation;
- the pinned minimal Rust toolchain installation;
- the locked release-profile build above; and
- the bounded smoke.

The job runs no npm dependency installation or lifecycle script and has no writable cross-run cache,
artifact upload, secret, protected environment, signing step, package creation, publication, or
deployment step. The configuration checker fixes this six-step surface, 15-minute timeout, and
order; mutation tests reject a missing job, runner/timeout/order drift, a missing smoke, and an
added upload action. Windows x86_64 root verification also performs the same release-profile build
and smoke after the normal Rust workspace gate.

This decision calls the operation a **portable copy/removal smoke**, not install or uninstall. A
workflow declaration is not a hosted clean-runner result until the workflow actually passes on the
remote service. Neither result would establish an installer, upgrade, server revoke, credential
rotation, package identity, signature, checksum publication, SBOM, provenance, supported Codex
version, supported connector version, or release.

## Security and privacy consequences

The source and temporary paths, file size, SHA-256 digest, child status, and temporary inventory are
transient Security/Operational material. They are used only for the in-process integrity and cleanup
decision, are not printed or retained, and are removed with the bounded temporary root. The smoke
collects no account, usage, prompt, repository-content, credential, profile, device, or network
data. It adds no log, metric, cache, artifact, database field, browser state, credential-store
entry, or network destination.

Building untrusted pull-request code still executes attacker-controlled build scripts and a native
binary. The disposable job is safe only because it is secretless, read-only, unprivileged, and
publishes nothing. A malicious change can alter its own harness and tests, so a green job never
authorizes merge or release. The built binary is neither independently reproduced nor signed and
must not leave the runner.

Affected invariants are VR-PUBLIC-001, VR-CI-001, and VR-RELEASE-001. Primary attacker stories are
VR-ABUSE-CONNECTOR-LOCAL, VR-ABUSE-DEPENDENCY-PR, VR-ABUSE-RELEASE-SUBSTITUTION, and
VR-ABUSE-RESOURCE-EXHAUSTION.

## Alternatives considered

- **Upload the smoke-tested binary as a CI artifact:** rejected because untrusted pull-request CI
  cannot create an official or reusable connector artifact.
- **Exercise pairing, sync, proposal, or local credential removal:** rejected because the portable
  lifecycle needs no network or credential authority, and a clean runner has no reviewed live
  service or user credential.
- **Add an MSI, package manager, or updater now:** rejected because version identity, signing,
  checksums, SBOM, provenance, upgrade, revoke, rollback, and supported-platform contracts remain
  open.
- **Run the target-tree binary without copying it:** rejected because that proves command behavior
  but not copy integrity, isolated execution, exact residue, or removal.
- **Upload diagnostics or print the temporary path on failure:** rejected because paths and child
  output are unnecessary for the pass/fail contract and would widen public CI disclosure.
- **Declare the same job on macOS and Linux:** rejected because the current candidate admission and
  this slice are explicitly Windows x86_64-only; other platform evidence requires its own reviewed
  admission and lifecycle work.

## Migration and rollback

There is no database, credential, public HTTP, schema, dependency, lockfile, support-matrix,
connector-version, or stored-data migration. Rollback removes the smoke script, its package/root
verification entries, the Windows CI job and guardrails, and this documentation. It does not change
the connector commands or candidate admission.

A future package or installer must add a new decision covering immutable version identity, platform
packaging, signatures, checksums, SBOM/provenance, upgrade and rollback, credential and
server-revoke behavior, clean-machine results, and artifact publication from protected source.

## Verification

Repository evidence covers:

- a real release-profile Windows x86_64 build from the locked Cargo graph;
- exclusive copy, exact source/copy digest equality, five-command help output, the generic
  process-free candidate failure, exact no-residue assertions, and bounded removal;
- a cleared child environment, empty `PATH`, argument-array invocation, fixed cwd, time and output
  budgets, and non-reflective failure stages;
- an exact secretless `windows-2025` workflow declaration with no artifact action;
- configuration-policy regression cases for missing, drifted, incomplete, and widened jobs; and
- the unchanged Rust format, check, test, and strict Clippy gates.

The local smoke executes a repository-built binary but does not establish a pristine workstation,
real installed Codex, real native credential, live account, network privacy result, or remote GitHub
Actions pass. No installer, update, revoke composition, package, signature, checksum record, SBOM,
provenance, release, supported version, or deployment is proven.

## References

- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [CI trust model](../architecture/CI_TRUST_MODEL.md)
- [Compatibility policy](../architecture/COMPATIBILITY_POLICY.md)
- [Codex compatibility matrix](../reference/codex-compatibility.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Release policy](../../RELEASE.md)
- [Connector boundary](../../crates/connector/README.md)
- [Candidate artifact diagnostic](0052-bounded-candidate-artifact-diagnostic.md)
