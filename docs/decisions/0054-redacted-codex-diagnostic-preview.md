# ADR 0054: Redacted Codex diagnostic preview

- Status: Accepted (local CLI preview implemented; support/export automation pending)
- Date: 2026-07-18
- Decision owners: Connector, Security, Privacy, Compatibility, Support, and Release
- Supersedes: None
- Superseded by: None

## Context

The local connector safety plan requires telemetry to remain off and any diagnostic export to be
explicit, redacted, and previewed before sharing. The existing `check-codex` command already
performs one bounded point-in-time artifact admission without opening credential storage, starting
Codex, reading an account, persisting a result, or using the network. Its normal success text is
deliberately minimal, while every failure remains a generic non-reflective error. That output is
enough for a local pass/fail decision but does not give a user one closed, reviewable support
preview that also preserves the empty support matrix.

An automated upload, logfile bundle, environment inventory, filesystem report, credential check,
account probe, or Codex process trace would widen the privacy and authority boundary before a
supported connector or trusted support channel exists. The next safe diagnostic slice therefore has
to reuse the existing selector, disclose only allowlisted fixed fields plus one coarse Operational
admission class, and leave sharing entirely under the user's control.

## Decision

`check-codex` accepts one optional exact `--diagnostic-preview` flag in either order relative to the
existing optional `--codex <absolute-path>`. The flag is valid only once and only for this command.
It creates no new command, selector, admission result, stored authority, or reusable evidence.

The command still invokes the same candidate selector exactly once. Without the flag, its success,
failure, stdout, stderr, and exit behavior remain unchanged. With the flag, it writes one exact
ASCII/UTF-8 preview to stdout:

```text
Vibe Racing connector diagnostic preview v1
connector-version: 0.0.0
candidate-platform-contract: windows-x86_64
candidate-codex-version: 0.144.5
candidate-admission: <passed|not-admitted|unsupported-platform>
supported-codex-versions: none
included-data: fixed-version-and-admission-state-only
excluded-data: paths,digests,environment,credentials,account,usage
side-effects: no-codex-process,no-credential-access,no-persistence,no-network
review-before-sharing: required
```

The connector version is the compile-time Cargo package version. The candidate platform and version
remain the fixed reviewed admission contract. Candidate admission is one closed status:

- `passed` when the exact candidate was admitted;
- `not-admitted` for unavailable discovery, an invalid path, or an unsupported artifact; or
- `unsupported-platform` when the host is outside the Windows x86_64 candidate contract.

A failed admission still returns the original nonzero command result and the same generic stderr
error after writing the explicitly requested preview. It never converts a failed check into success.
If preview output cannot be written, the command fails with the existing generic output error.

The preview writer writes only stdout; the existing generic command error can still appear on stderr
after a failed admission. The connector supplies no output path, file creation, clipboard access,
archive, upload, URL, support ticket, telemetry transport, or automatic sharing. The user can
inspect the complete preview before deliberately copying it elsewhere. The connector cannot enforce
how a shell redirects stdout, so documentation must not claim that redirecting is impossible; it
states only that the connector itself neither saves nor sends the preview.

The preview does not imply that a candidate is supported. It always states that supported Codex
versions are `none`, and a later `sync` still repeats exact admission only after active-record
validation. No preview value becomes input to pairing, signing, synchronization, proposal,
packaging, installation, release, or compatibility negotiation.

## Security and privacy consequences

The preview exposes only already-public compile-time connector/candidate versions, one fixed
platform contract, one three-value admission class, and the empty support state. The explicit
candidate path, canonical path, file size, digest, `PATH` entries, operating-system version,
architecture detail beyond the fixed contract, hostname, username, environment values, credential
state, source/device identity, account, usage, repository, prompt, conversation, and child output
remain absent.

Exact path, size, digest, and bounded default `PATH` selection may still exist transiently inside
the unchanged admission routine. They are used only for the point-in-time decision, are not added to
the preview, and are not retained. The command opens no native credential entry, creates no request
signer, starts no Codex process, reads no account or usage, persists nothing, and opens no network
connection.

A user can still share the preview with an untrusted party, and an attacker can alter their own
binary or report text. The preview is therefore troubleshooting context, not an attestation,
signature, provenance record, support grant, or proof that an official binary ran. Support staff
must not accept it as release identity.

Affected invariants are VR-PUBLIC-001, VR-CODEX-001, VR-CODEX-002, and VR-RELEASE-001. Primary
attacker stories are VR-ABUSE-CONNECTOR-LOCAL, VR-ABUSE-PUBLIC-SCRAPE, and
VR-ABUSE-RELEASE-SUBSTITUTION.

## Alternatives considered

- **Upload a diagnostic bundle automatically:** rejected because no trusted support endpoint,
  consent flow, retention contract, or released connector exists.
- **Include paths, hashes, environment variables, OS build, or native-store state:** rejected
  because those values are unnecessary for this bounded result and can disclose workstation identity
  or security material.
- **Start Codex and report account/usage parser health:** rejected because that would cross the
  process/account boundary and duplicate the separately gated sync collector.
- **Return success when a failure preview was generated:** rejected because report generation must
  not weaken artifact admission semantics.
- **Write a file and then print its location:** rejected because a retained path and diagnostic
  artifact create cleanup, disclosure, and support-channel obligations absent from this slice.
- **Add a generic JSON or key/value extension mechanism:** rejected because arbitrary diagnostic
  fields would bypass privacy review and make future data collection fail open.
- **Add a separate diagnostic command:** rejected because the only reviewed operation is candidate
  admission; an explicit mode on that same command keeps authority and parsing narrower.

## Migration and rollback

There is no database, credential, public HTTP, JSON Schema, lockfile, package, support-matrix, or
stored-data migration. Rollback removes the optional flag, exact preview writer, black-box/unit
tests, and corresponding documentation. The original `check-codex` behavior remains intact.

Future diagnostic fields require a new reviewed version and privacy-map update. A future automatic
export or support upload requires a separate decision covering consent, preview, destination,
authentication, retention, deletion, abuse controls, failure handling, and support ownership.

## Verification

Repository evidence covers:

- parser acceptance in either flag order and rejection of duplicates, values, and use by another
  command;
- exact successful, not-admitted, and unsupported-platform preview bytes;
- unchanged normal success and failure output;
- a target-built process test with a cleared environment and an explicit synthetic missing path;
- nonzero failed-admission status, generic stderr, exact redacted stdout, and no candidate creation;
- unwritable-output failure; and
- the unchanged format, test, strict Clippy, compatibility, public-data, documentation, and portable
  lifecycle gates.

The tests do not run an installed Codex artifact, inspect a real credential, read an account, use a
network, prove a clean-machine hosted run, establish support, or validate a support organization.

## References

- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [Compatibility policy](../architecture/COMPATIBILITY_POLICY.md)
- [Codex compatibility matrix](../reference/codex-compatibility.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Release policy](../../RELEASE.md)
- [Connector boundary](../../crates/connector/README.md)
- [Candidate artifact diagnostic](0052-bounded-candidate-artifact-diagnostic.md)
