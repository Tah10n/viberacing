# ADR 0024: Bounded candidate Community sync composer

- Status: Accepted (unsigned composition boundary; consumed by ADR 0025 signer)
- Date: 2026-07-15
- Decision owners: Connector, Ingest, Security, Privacy, Compatibility, and Release
- Supersedes: None
- Superseded by: None

## Context

ADR 0022 returns a privacy-minimized, bounded `DailyUsage` value and ADR 0023 proves its one-shot
collection through a synthetic child. ADR 0015 separately defines the exact Community sync body,
SHA-256 digest, source-bound Ed25519 message, header grammar, and 8 KiB body ceiling accepted by
Ingest. The connector still had no implementation joining those trust boundaries, so a future signer
could otherwise serialize different bytes, reorder or omit device-message fields, accept
caller-selected identifiers, or drift independently from the TypeScript verifier.

This slice must prove exact unsigned request material without prematurely adding a device-key store,
random generator, clock, source/device lookup, signature operation, HTTP client, scheduler, or live
Codex path. TB-03 treats App Server output as hostile, TB-04 treats local execution and secret
storage as separate authorities, and TB-05 requires the signed bytes to bind the exact body and
source submitted to Ingest.

## Decision

Add `CandidateCommunitySyncV1Composer` to the non-publishable Rust connector library. It consumes
the existing minimized `DailyUsage` plus `ReviewedCommunitySyncContext`, a one-use capability whose
source ID, sync ID, millisecond UTC timestamp, device ID, and 16-byte nonce are private. The context
has no public constructor, accessor, `Clone`, or diagnostic representation. A later reviewed
source/device boundary must load the paired source/device identifiers, obtain canonical time, and
generate a cryptographically fresh sync identifier and nonce before it may construct this capability
inside the crate.

For that already-reviewed input, the composer:

- revalidates the exact `src_`, `syn_`, and `dev_` identifier grammars, a real `20xx` calendar date,
  canonical 24-byte millisecond UTC time, sorted unique nonempty daily entries, the 31-entry bound,
  and the JavaScript-safe token ceiling;
- consumes the minimized daily entries and manually serializes the seven-field `ConnectorSyncV1`
  object in one fixed order, with connector version fixed by the crate and Codex version fixed to
  the unsupported `0.144.4` candidate;
- rejects an empty or greater-than-8192-byte exact body;
- computes SHA-256 over those exact returned bytes with exact `sha2@0.11.0`, default features
  disabled, and encodes the digest and nonce with a repository-owned unpadded base64url encoder;
- builds the exact eight-field LF-separated device message with no trailing separator; and
- returns `PreparedCommunitySync`, containing only the bounded body, signing message, and four
  already-validated unsigned HTTP header values.

At acceptance, `PreparedCommunitySync` had bounded read-only accessors but no `Debug`, `Display`,
`Clone`, or serialization implementation. ADR 0025 removes every public accessor so only its
isolated signer can consume it. The composer and error type do not accept or reflect arbitrary
fields. They load no key, generate no randomness or time, create no signature or header map, open no
file or credential store, retain no log, and perform no network or process operation.

A synthetic language-neutral vector under `contracts/v1` fixes the exact JSON bytes, SHA-256 digest,
nonce encoding, and device message. Rust produces those bytes from the real handshake/account/usage
state machines; the Ingest test independently parses and validates the same body and recomputes the
digest and canonical message through production TypeScript code.

## Security and privacy consequences

The body and signing message contain private per-day usage plus opaque source/device identifiers and
replay material. They remain transient capability-owned memory and are deliberately excluded from
diagnostics, logs, persistence, fixtures derived from users, and network sinks. The shared vector
uses only obvious synthetic identifiers and values. Exact-body hashing prevents a signer from
authorizing one body while transport submits another; fixed source/device/time/nonce/idempotency
fields match the server verifier's replay and source-binding contract.

The inaccessible context is a compile-time staging boundary, not a claim that local attackers cannot
control a future connector. Secure operating-system key storage, fresh entropy, trusted clock
policy, key zeroization, signature creation, upload, retry behavior, and executable admission remain
separate review gates. The SHA-256 dependency adds no network client and its upstream unsafe and
CPU-dispatch surface remains outside repository-owned code, which continues to forbid unsafe code.

Affected invariants are VR-PUBLIC-001, VR-CODEX-001, VR-CODEX-002, VR-DEVICE-001, VR-INGEST-001, and
VR-RELEASE-001. Primary attacker stories are VR-ABUSE-USAGE-FORGERY, VR-ABUSE-DEVICE-KEY-THEFT,
VR-ABUSE-CONNECTOR-LOCAL, VR-ABUSE-RESOURCE-EXHAUSTION, and VR-ABUSE-RELEASE-SUBSTITUTION.

## Alternatives considered

- **Expose a public context constructor:** rejected because callers could select stale timestamps,
  reused nonces, or arbitrary source/device identifiers before the source-bound authority exists.
- **Serialize with a generated Rust DTO or derive macros:** rejected for this slice because the
  language-neutral schema already owns the wire contract and a tiny manual serializer keeps the
  exact field order and dependency surface explicit.
- **Sign a parsed JSON value:** rejected because signatures must bind the exact transmitted bytes,
  not a second serialization with potentially different member order or escaping.
- **Use a handwritten SHA-256 implementation:** rejected because cryptographic primitive
  implementation is not a project capability; the narrowly pinned RustCrypto implementation has a
  smaller review and maintenance risk.
- **Add Ed25519 and HTTP transport together:** rejected because key storage, signing authority,
  retries, origin routing, and egress each need independent threat, privacy, dependency, and
  platform evidence.

## Migration and rollback

This change adds no route, database object, environment variable, persistent field, key, signature,
network destination, supported compatibility row, executable, package, or release artifact. It adds
one direct Cargo dependency and nine lock records, one library module, one shared synthetic vector,
and cross-language tests. Rollback removes the composer exports/module/vector and SHA-256
dependency; the upstream parser, process supervisor, public sync contract, and Ingest verifier
remain valid independent boundaries.

ADR 0025 now consumes this exact message behind an inaccessible one-use signing-key capability. The
next source/device slice may construct `ReviewedCommunitySyncContext` only after it documents source
binding, identifier and nonce generation, clock behavior, storage lifetime, and failure recovery.
Key storage and transport must not make this candidate Codex version supported.

## Verification

Six Rust unit cases prove:

- exact body bytes, SHA-256 digest, unpadded base64url nonce, LF message, and owned header values
  against the shared vector;
- rejection of invalid source, sync, time, device, empty-usage, and bound violations with stable
  non-reflective errors;
- real calendar, time-of-day, 31-entry, body-size, and base64url boundary behavior; and
- executable constant agreement with the versioned authentication policy.

The Rust cases obtain every `DailyUsage` value through the production handshake and candidate
account/usage parser. One Ingest test independently validates the shared body through the generated
runtime contract and production digest/message functions. Root verification additionally checks all
Rust targets/features, Clippy with warnings denied, 100% Ingest coverage, generated contract drift,
architecture documentation, license inventory, and public-data safety. These six composer cases do
not sign; ADR 0025 separately adds synthetic signing evidence. Neither boundary uploads, executes an
official Codex artifact, or establishes support.

## References

- [ADR 0015](0015-bounded-community-sync-verification-kernel.md)
- [ADR 0022](0022-candidate-codex-account-usage-adapter.md)
- [ADR 0023](0023-bounded-candidate-app-server-supervisor.md)
- [Connector library](../../crates/connector/README.md)
- [Current Usage Sync schema](../../contracts/v1/usage-sync.schema.json)
- [Current Usage Sync authentication policy](../../contracts/v1/connector-usage-sync-authentication.json)
- [Current single-protocol decision](0075-single-unreleased-usage-sync-protocol.md)
- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Dependency policy](../security/DEPENDENCY_POLICY.md)
