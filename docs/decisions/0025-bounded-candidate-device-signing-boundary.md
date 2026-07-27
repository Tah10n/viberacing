# ADR 0025: Bounded candidate device signing boundary

- Status: Accepted (inaccessible one-use key capability; key storage and transport pending)
- Date: 2026-07-15
- Decision owners: Connector, Ingest, Security, Privacy, Compatibility, and Release
- Supersedes: None
- Superseded by: None

## Context

ADR 0024 produces an exact `ConnectorSyncV1` body and the exact LF-separated Ed25519 message
accepted by the ADR 0015 Ingest verifier. Its intentionally unsigned output still exposed bounded
read-only accessors, so a later caller could bypass signing, sign a different serialization, reuse a
signing key capability, or attach a key registered to another public device ID. The connector also
had no cryptographic implementation or cross-language signature vector.

This slice must close the exact signing boundary without claiming that key generation, operating-
system key storage, pairing proof, context construction, upload, scheduling, or a real Codex path
exists. TB-04 keeps local execution and secret storage as separate authorities; TB-05 requires one
paired device key to authorize the exact body and source that Ingest receives.

## Decision

Add `CandidateCommunitySyncV1Signer` and `ReviewedDeviceSigningKey` to the non-publishable Rust
connector library. The key capability contains one Ed25519 signing key plus the exact public device
ID to which a future reviewed key-store boundary says it is bound. It has no public constructor,
accessor, `Clone`, diagnostic representation, or serialization surface. The signer consumes both the
capability and one `PreparedCommunitySync`, rejects an exact device-ID mismatch without reflection,
signs only the already prepared message, and returns `SignedCommunitySync`.

The returned envelope exposes read-only accessors for exactly:

- the same body allocation whose SHA-256 digest appears in the signed message;
- device ID, nonce, timestamp, and idempotency-key values moved from that prepared request; and
- the 64-byte Ed25519 signature encoded as canonical unpadded base64url.

The unsigned prepared type now has no public accessors and can only be consumed by the signer. It
zeroes its private body and signing-message byte buffers on every drop, including device-binding
failure. The signed envelope zeroes its private body buffer on drop. The key capability is consumed;
the upstream `SigningKey` zeroizes secret material on drop. These controls reduce accidental
retention but do not claim guaranteed erasure of compiler copies, caller-made copies, identifiers,
or operating-system memory.

Pin `ed25519-dalek@3.0.0` with default features disabled and only `zeroize` enabled. This keeps
random key generation, allocation, batch verification, prehash/digest signing, hazmat, legacy
compatibility, PKCS8/PEM, Serde, and fast precomputed tables outside the capability. The exact ten-
record lock addition, active/cross-target features, licenses, build script, upstream unsafe surface,
release age, maintenance state, and advisory state are reviewed in the dependency policy. No
repository-owned unsafe code or generic signing API is added.

Extend the public synthetic request vector with only an Ed25519 public key and exact signature. Rust
derives a test-only key from an obvious fixed label, composes usage through the production
handshake/account parser, and signs through the production signer. Ingest independently decodes and
strictly verifies the exact signature and rejects a message with one added LF. No private-key byte
array, real credential, or user-derived fixture is tracked; the synthetic key is intentionally
reproducible from the public test label and must never be treated as a credential.

## Security and privacy consequences

The signer binds one already reviewed device capability to the exact method, path, body digest,
device ID, nonce, timestamp, and idempotency key. Because the digest covers `sourceId` and all daily
usage, changing source or usage changes the signature. Device-ID equality prevents accidentally
using a loaded capability for another request device. This is cryptographic integrity and
authentication for a paired Community device; it does not make Community usage truthful or
OpenAI-verified.

The private daily body and signing message remain transient connector memory. The production types
provide no log, display, clone, serialization, cache, file, database, analytics, or network sink.
The public vector contains only synthetic values, a public key, and a signature. A future key-store
boundary must still generate a key with reviewed OS entropy, store it only in an operating-system
credential facility with no plaintext fallback, enroll its public key through passkey-approved
pairing, and construct both inaccessible capabilities. HTTP egress, retries, clock/nonce generation,
diagnostics, revocation refresh, and release packaging remain separate review gates.

Affected invariants are VR-PUBLIC-001, VR-CODEX-002, VR-DEVICE-001, VR-INGEST-001, and
VR-RELEASE-001. Primary attacker stories are VR-ABUSE-USAGE-FORGERY, VR-ABUSE-DEVICE-KEY-THEFT,
VR-ABUSE-CONNECTOR-LOCAL, VR-ABUSE-RESOURCE-EXHAUSTION, and VR-ABUSE-RELEASE-SUBSTITUTION.

## Alternatives considered

- **Expose a public key constructor or accept raw secret bytes:** rejected because callers could
  bypass future source/device binding and duplicate long-lived secret material.
- **Let transport sign or serialize the request:** rejected because transport must receive one
  closed signed envelope, not independently reconstruct security-critical bytes.
- **Keep unsigned accessors for flexibility:** rejected because the signer now owns that boundary;
  an unsigned body or message has no legitimate external consumer.
- **Use an operating-system or OpenSSL signing API in this slice:** rejected because platform key
  custody and packaging need separate cross-platform evidence, while this boundary first proves the
  platform-independent ownership and exact-message contract.
- **Enable Dalek defaults or random-key features:** rejected because this slice neither generates
  keys nor needs allocation, batch, legacy, serialization, or precomputed-table features.
- **Implement Ed25519 locally:** rejected because cryptographic primitive implementation is not a
  project capability and would have a substantially larger audit burden.

## Migration and rollback

This change adds no route, database object, environment variable, persistent field, real or stored
private key, network destination, supported compatibility row, executable, or release artifact. It
adds one direct Cargo dependency and ten lock records, one private Rust submodule, three Rust unit
cases, two public synthetic-vector fields, one cross-language verification assertion, and ADR 0025.
Rollback removes those additions and restores the inaccessible unsigned composer; the Ingest
verifier and language-neutral authentication policy remain valid independent boundaries.

A future key-store slice may construct `ReviewedDeviceSigningKey` only after documenting entropy,
OS-store availability and fallback behavior, source/device pairing, key rotation, process access,
memory lifetime, and recovery. A transport may consume `SignedCommunitySync` only after documenting
the fixed destination, TLS, origin path, retry/idempotency behavior, redacted diagnostics, and
release compatibility gates.

## Verification

Nine Rust sync unit cases prove the prior composition boundaries plus:

- exact public key, signature, body, and five header values against the shared vector;
- one-use exact device binding with stable non-reflective mismatch failure; and
- a different production-parsed daily usage value produces different body and signature bytes.

The shared Ingest test validates the body through the generated runtime contract, recomputes the
digest and message through production TypeScript code, decodes exact 32/64-byte canonical values,
verifies the Ed25519 signature, and rejects a trailing-LF mutation. Focused Rust tests, all-target
Clippy, Ingest tests/lint/typecheck, contract drift, and license checks pass before the root gate.
None of this evidence generates or stores a real key, pairs a device, uploads, executes an official
Codex artifact, or establishes support.

## References

- [ADR 0015](0015-bounded-community-sync-verification-kernel.md)
- [ADR 0024](0024-bounded-candidate-community-sync-composer.md)
- [Connector library](../../crates/connector/README.md)
- [Current Usage Sync authentication policy](../../contracts/v1/connector-usage-sync-authentication.json)
- [Current shared synthetic signing vector](../../contracts/v1/connector-usage-sync-device-request.test-vector.json)
- [Current single-protocol decision](0075-single-unreleased-usage-sync-protocol.md)
- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Dependency policy](../security/DEPENDENCY_POLICY.md)
