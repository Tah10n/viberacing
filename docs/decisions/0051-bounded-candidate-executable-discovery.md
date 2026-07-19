# ADR 0051: Bounded candidate executable discovery

- Status: Accepted (Windows candidate discovery implemented; release and support pending)
- Date: 2026-07-18
- Decision owners: Connector, Security, Privacy, Compatibility, and Release
- Supersedes: None
- Superseded by: None

## Context

ADR 0031 deliberately required an explicit absolute path for the first one-shot Windows candidate
sync. Exact size and SHA-256 admission plus a no-write-sharing file handle made that selected file
safe enough for the bounded child boundary, but every invocation still required the user to locate
and retype the executable. The candidate remains unsupported, so selection cannot silently widen to
another version, wrapper, platform, search mechanism, or process-launch contract.

`PATH` is hostile and potentially large. A normal command lookup can execute scripts, consult
environment-derived executable extensions, accept relative directories, stop at an unverified first
match, or perform unbounded file metadata and hashing work. Recursive filesystem or registry
discovery would widen both local data access and denial-of-service exposure. Discovery therefore
needs fixed names, fixed budgets, exact artifact admission, non-reflective failures, and an
explicit-path fallback.

## Decision

The Windows x86_64 candidate command becomes:

```text
viberacing-connector sync --origin <https-origin> --label <device-label> [--codex <absolute-path>]
```

The command must load and validate the exact active native credential before it performs explicit
admission or discovery. When `--codex` is present, ADR 0031's canonical-path, regular-file,
exact-size, exact-SHA-256, and retained no-write-sharing-handle admission remains unchanged. When it
is absent, the connector applies this closed discovery policy:

- Windows x86_64 and the exact candidate `0.144.5` policy remain mandatory;
- `PATH` is read only as a location hint and is rejected above 65,536 encoded bytes;
- at most the first 64 directories are considered, and every directory must already be absolute;
- only fixed leaf names `codex.exe` and `codex-x86_64-pc-windows-msvc.exe` are joined to those
  directories;
- candidate paths are canonicalized, bounded to 2,048 encoded bytes, and deduplicated by canonical
  path;
- only regular files with the exact official candidate byte count reach hashing;
- at most four distinct exact-size candidates are hashed; and
- success still requires the exact canonical SHA-256 and returns the same retained no-write-sharing
  file handle used for direct process launch.

The connector does not invoke a shell, derive executable extensions from environment configuration,
execute a wrapper to ask for its version, accept names without an extension, recursively scan,
inspect the registry, negotiate a version, or accept another filename. A relative, malformed,
oversized, missing, wrong-size, wrong-digest, or over-budget search fails closed through the same
generic not-admitted command result. Neither success nor failure prints a path, discovered filename,
digest, search directory, or operating-system error. Successful output still identifies only exact
version `0.144.5`.

The explicit `--codex` form remains available for controlled development and diagnosis, but it
cannot bypass exact admission. Discovery adds no scheduler, retry, updater, packaging, supported
version, support-matrix row, macOS/Linux admission, or generic process-launch API.

## Security and privacy consequences

`PATH`, its bounded directory strings, candidate paths, metadata, and digests are transient local
Security/Operational material. They are not logged, displayed, retained, exported, sent to Vibe
Racing, placed in a credential record, or exposed through a diagnostic type. Only the already
reviewed candidate version may be printed after exact admission. The active credential is checked
first so an unpaired invocation performs no local executable search.

Fixed directory, path, and hash budgets bound attacker-controlled work. Fixed leaf names reject
command wrappers and arbitrary executables, while exact digest admission means `PATH` ordering does
not establish trust. Canonical-path deduplication prevents one file reached through duplicate
entries from consuming the complete hash budget. The retained Windows handle preserves ADR 0031's
substitution protection after discovery.

The local computer remains outside the trust boundary: malware running as the user can replace the
connector, inspect its memory, or control all candidate locations. Repository tests exercise only
synthetic files and do not prove that an installed Codex artifact matches the candidate, that a real
account is read safely, or that a clean machine, package, provenance chain, released connector, or
supported version exists.

Affected invariants are VR-PUBLIC-001, VR-CODEX-001, VR-CODEX-002, and VR-RELEASE-001. Primary
attacker stories are VR-ABUSE-CONNECTOR-LOCAL, VR-ABUSE-RELEASE-SUBSTITUTION, and
VR-ABUSE-RESOURCE-EXHAUSTION.

## Alternatives considered

- **Use the platform's first normal command match:** rejected because wrapper resolution, relative
  entries, and unverified first-match behavior turn `PATH` ordering into authority.
- **Execute a candidate or wrapper to query its version:** rejected because code would run before
  artifact admission and the reported version would not prove file identity.
- **Recursively scan installation directories or query the registry:** rejected because it widens
  local data access, platform assumptions, and unbounded I/O without improving exact admission.
- **Remove the explicit path form:** rejected because a closed fallback remains useful when an exact
  candidate is intentionally stored outside bounded `PATH` discovery.
- **Admit a version range, filename alone, or size alone:** rejected because none is an immutable
  identity and each would silently widen the empty compatibility matrix.
- **Hash every fixed-name match:** rejected because attacker-controlled directories can amplify
  expensive work; exact size filtering and a four-file hash budget fail closed.

## Migration and rollback

There is no database migration, public contract change, dependency, credential-record change,
network destination, retained field, or generated compatibility artifact. Rollback removes the
discovery branch and again requires explicit `--codex`; exact artifact admission, the active native
record, one-shot collection/signing/upload behavior, and the empty support matrix remain intact.

A future supported release must replace this candidate-only decision with reviewed platform
installation, ownership/link, signature/provenance, packaging, safe-diagnostic, clean-machine
privacy, and release evidence. It must not widen these constants silently.

## Verification

Repository evidence covers:

- exact discovery through both fixed filenames and rejection of wrappers, names without extensions,
  relative directories, wrong-size files, and wrong digests;
- the 65,536-byte `PATH`, 64-directory, 2,048-byte candidate-path, and four-hash budgets plus
  canonical-path deduplication;
- drift protection tying the production discovery filename, size, and SHA-256 to the canonical
  candidate manifest;
- CLI parsing for default discovery and the explicit-path fallback, with missing, extra, and
  duplicate argument rejection;
- refusal before any admission or discovery when the native record is not active;
- the unchanged no-write-sharing handle retained through direct launch; and
- 69 Rust tests plus strict formatting, check, and Clippy gates.

All executable files, credentials, usage, keys, and HTTP responses in repository tests are
synthetic. No test discovers or launches an installed Codex binary, opens a real native credential,
reads a real account, or calls a deployed Vibe Racing service.

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
- [One-shot candidate Community sync](0031-one-shot-candidate-community-sync.md)
