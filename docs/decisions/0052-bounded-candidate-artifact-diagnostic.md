# ADR 0052: Bounded candidate artifact diagnostic

- Status: Accepted (local Windows candidate diagnostic implemented; release and support pending)
- Date: 2026-07-19
- Decision owners: Connector, Security, Privacy, Compatibility, and Release
- Supersedes: None
- Superseded by: None

## Context

ADR 0051 lets the Windows x86_64 candidate sync select one exact Codex artifact through bounded
fixed-name discovery or an explicit path, but deliberately performs that local inspection only after
validating an active native credential. That order remains correct for a command that can read an
account and upload usage. It does not provide a safe way to check candidate artifact admission
before pairing or to distinguish that point-in-time local prerequisite from connector support.

The Phase 4 roadmap and connector threat and abuse models require safe compatibility diagnostics,
but a diagnostic must not become a second process launcher, an account probe, a credential-store
reader, a network client, a support claim, or a path disclosure surface. Reimplementing admission in
a diagnostic would also risk drift from the exact selection used by `sync`.

## Decision

The connector adds one explicitly invoked command:

```text
viberacing-connector check-codex [--codex <absolute-path>]
```

`check-codex` accepts no origin, device label, account selector, output mode, or other flag. Without
`--codex`, it uses ADR 0051's exact bounded fixed-name `PATH` selection. With `--codex`, it uses the
same explicit-path fallback. Both forms call the same production selector used by `sync` and retain
all existing Windows x86_64, candidate-version, canonical-path, regular-file, size, SHA-256,
directory/path/hash-budget, deduplication, and no-write-sharing-handle requirements.

Explicit invocation of `check-codex` is the sole exception to ADR 0051's active-credential-first
ordering. The command:

- opens no native credential-store account and reads, creates, changes, or deletes no connector
  credential;
- starts no Codex process, speaks no App Server method, creates no child working directory, and
  reads no account or usage value;
- constructs no source, device, key, request, nonce, signature, or sync capability;
- performs no HTTP, browser, telemetry, update, install, or other network action; and
- retains no result, path, metadata, digest, environment value, cache, log, metric, or exported
  diagnostic record.

After successful exact admission, the file handle is released and the command emits only:

```text
Candidate Codex 0.144.5 artifact admission passed; no Codex version is supported.
```

Failure remains stable and non-reflective. It does not print the supplied or discovered path,
filename, digest, directory, `PATH`, metadata, operating-system error, or rejected version. A
successful check is a point-in-time candidate artifact result only. It is not stored or reused, and
every later `sync` must again validate the active credential first and then repeat exact admission
before constructing any launch capability.

The command adds no support-matrix row, supported version, clean-machine result, process/privacy
egress result, installer, updater, package, signature, provenance, release, or deployment claim.

## Security and privacy consequences

The diagnostic intentionally permits the same bounded local artifact reads before pairing because
the user explicitly requested that check. This widens when local inspection may occur, but not what
may be inspected: default discovery still reads only the bounded `PATH` hint and fixed candidate
locations, while the explicit form reads only the supplied exact path. Fixed size and hash budgets
bound attacker-controlled work, and immutable digest admission prevents `PATH` ordering or filename
from establishing trust.

The selected path, directory strings, file metadata, digest, and operating-system errors remain
transient Security/Operational material. There is no new data class, retained field, sink, log,
metric, cache, analytics event, browser storage, credential-store access, or network destination.
Generic failure reduces troubleshooting detail, but avoids turning local filesystem state into a
diagnostic disclosure surface.

The local computer remains outside the trust boundary. Malware running as the user can replace the
connector or candidate after a successful check. Re-admission by `sync` prevents the diagnostic from
becoming reusable authority, but cannot make a compromised local machine trustworthy.

Affected invariants are VR-PUBLIC-001, VR-CODEX-001, VR-CODEX-002, and VR-RELEASE-001. Primary
attacker stories are VR-ABUSE-CONNECTOR-LOCAL, VR-ABUSE-RELEASE-SUBSTITUTION, and
VR-ABUSE-RESOURCE-EXHAUSTION.

## Alternatives considered

- **Require an active pairing before every diagnostic:** rejected because artifact admission is a
  useful pre-pairing prerequisite and does not need device authority, account data, or a network.
- **Implement diagnostic-specific discovery or version detection:** rejected because it could drift
  from `sync`, run a binary before admission, or widen the fixed selection contract.
- **Return the selected path, digest, or detailed operating-system failure:** rejected because those
  values are unnecessary for the binary admission decision and would create a local disclosure
  surface.
- **Cache a successful admission for later sync:** rejected because filesystem state can change and
  a diagnostic result must not become launch or upload authority.
- **Launch the artifact and query its reported version:** rejected because executable identity must
  be established without running untrusted code, and this diagnostic is process-free.

## Migration and rollback

There is no database migration, credential-record change, public HTTP contract, dependency,
generated compatibility artifact, network destination, retained field, or support-matrix change.
Rollback removes only `check-codex` and its documentation. The shared admission selector and the
active-record-first `sync` behavior remain unchanged.

A future released diagnostic may add platform-specific provenance, ownership/link, signature,
package, or clean-machine evidence only through a new reviewed decision and without converting
candidate admission into support implicitly.

## Verification

Repository evidence covers:

- closed parsing of the default and explicit-path forms plus rejection of origin, label, missing,
  extra, duplicate, and over-budget arguments;
- one shared production selector for diagnostic and sync admission;
- one admission call per invocation and fixed success output that contains the exact candidate
  version plus the explicit unsupported statement but no path;
- stable error mapping, no partial output on admission failure, and fail-closed output errors;
- the existing synthetic fixed-name, path, size, digest, canonical-deduplication, resource-budget,
  and retained-handle admission cases;
- the unchanged refusal by `sync` before admission when its native record is not active; and
- 72 Rust tests plus strict formatting, check, and Clippy gates.

All repository fixtures and candidate files are synthetic. No test discovers or launches an
installed Codex binary, opens a real native credential, reads a real account, performs diagnostic
network traffic, or proves a package, release, supported version, or clean-machine result.

## References

- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [Compatibility policy](../architecture/COMPATIBILITY_POLICY.md)
- [Codex compatibility matrix](../reference/codex-compatibility.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Connector boundary](../../crates/connector/README.md)
- [Candidate executable discovery](0051-bounded-candidate-executable-discovery.md)
- [One-shot candidate Community sync](0031-one-shot-candidate-community-sync.md)
