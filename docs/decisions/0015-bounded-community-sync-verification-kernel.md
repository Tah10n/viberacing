# ADR 0015: Bounded Community sync verification kernel

- Status: Accepted (local verification kernel implemented; HTTP and live integration pending)
- Date: 2026-07-15
- Decision owners: Ingest, Edge, Connector, Security, Privacy, Contracts, and Database
- Supersedes: None
- Superseded by: None

## Context

`ConnectorSyncV1` already closes the client-writable Community payload, and revision 0007 exposes
only minimal active-device verification material plus one procedure-only submission capability.
Neither boundary defined how an application preserves and authenticates the exact received bytes.
Without that boundary, a future server could normalize JSON before signing, lose duplicate-key
evidence, trust duplicate security headers, parse an oversized request before edge authentication,
or accept a device signature under permissive curve-point semantics.

The first application slice must make the cryptographic and parsing boundary executable without
claiming a working HTTP service, edge deployment, replay database, PostgreSQL adapter, connector, or
real-user synchronization. This crosses TB-05 and TB-06 and prepares, but does not complete, TB-07.

## Decision

Add a private `apps/ingest` TypeScript workspace and a language-neutral
`connector-sync-authentication.json` policy. The workspace exposes one pure verifier over a closed
raw request envelope: exact method, exact request target, a dense raw header pair array, and copied
body bytes. It owns no listener, framework request object, environment reader, database pool,
response serializer, or log sink.

The version 1 policy fixes:

- `POST /v1/community/sync` with exact `application/json` and a body of 1 through 8192 bytes;
- at most 64 raw header pairs, 64 characters per header name, and 256 per header value;
- required device, idempotency, and origin headers, with case-insensitive duplicate rejection;
- UTF-8 JSON with no BOM, duplicate decoded object keys, trailing syntax, or invalid byte sequence;
- parser budgets of depth 8, 128 values, 64 object members, 64 array items, 64 number characters,
  and 256 decoded UTF-16 code units per string;
- unpadded canonical base64url binary fields and canonical millisecond UTC timestamps; and
- LF-separated UTF-8 proof messages with no trailing LF.

The verifier copies the body and required header values before its first asynchronous dependency. It
computes SHA-256 over the exact copied body and never serializes JSON again for a proof. First, it
verifies a 32-byte HMAC-SHA-256 edge proof that binds protocol prefix, key ID, method, target, body
digest, timestamp, and 16-byte nonce. One or two exact 32-byte keys support bounded rotation. The
proof must be strictly younger than 60 seconds and may use at most five seconds of inclusive future
skew. The oldest accepted millisecond therefore leaves a positive replay-retention interval. Only
after a valid proof does the verifier call an injected one-time nonce consumer; false, non-boolean,
throwing, or repeated results fail closed. Body parsing and device lookup occur only after that
origin step.

The bounded parser feeds the generated `validateConnectorSyncV1` validator. The device timestamp
must equal `observedAt`, and the idempotency header must equal `syncId`. An injected lookup returns
only the internal device-key ID, bound source ID, and 32-byte public key. Unknown devices take the
same cryptographic verification path with a fixed valid dummy key. The Ed25519 signature binds the
protocol prefix, method, target, exact-body digest, public device ID, 16-byte nonce, timestamp, and
idempotency key. Source equality is checked independently after verification.

Node's native OpenSSL-backed verification accepted an all-zero Ed25519 public key and all-zero
signature for an arbitrary message in the local security probe. The kernel therefore uses
exact-pinned `@noble/ed25519@3.1.0` with `zip215: false`, which requests strict RFC 8032/FIPS point
semantics, and retains a regression test for the zero-key/zero-signature case. Native verification
alone is not an allowed fallback. Backend exceptions fail as an invalid device proof.

Success returns a frozen allowlist containing the canonical validated payload, public device ID,
internal device-key ID, idempotency key, submitted signature, exact-body SHA-256 hex digest, and
device-nonce SHA-256 hex digest. It returns neither an origin proof nor an origin secret. ADR 0016's
database adapter now maps only this record to the existing submission procedure and still lets
PostgreSQL decide server receipt time, replay, idempotency, source lifecycle, season closure, and
quarantine.

## Security and privacy consequences

Origin authentication happens before attacker-controlled JSON work or device lookup. Exact-byte
binding, duplicate header/key rejection, strict curve semantics, source equality, canonical
encodings, constant-time HMAC comparison, dummy-key verification, and closed dependency results
reduce substitution, replay, cross-source, parser differential, key-confusion, and timing-oracle
paths. Parser and envelope budgets limit local work, but they do not replace socket deadlines,
stream limits, admission control, backpressure, edge rate policy, or capacity evidence.

The kernel collects and retains no new field. During one call it transiently handles the private
Usage payload and Security values already mapped for sync: public device ID, source ID, timestamps,
nonces, idempotency key, signature, public key, edge key ID, proof, and exact body. It has no
logging, analytics, cache, export, network, or persistence sink. An origin replay store, HTTP log,
metric, database adapter, or response correlation field requires its own mapped access and retention
policy. ADR 0016 now maps only the local database adapter; the other sinks remain absent. Raw
bodies, usage values, public keys, signatures, nonces, proof material, and dependency errors must
not enter general logs.

A valid device signature authenticates only one registered Community device and its exact request.
It does not prove that Codex produced the values, that the values are honest, that one source maps
to one upstream account, or that Community data is OpenAI verified. Plausible self-reported forgery
inside public bounds remains possible and grants no prize, money, authorization, or valuable
benefit.

Affected invariants are VR-PUBLIC-001, VR-DEVICE-001, VR-DEVICE-002, VR-INGEST-001, VR-INGEST-002,
VR-ORIGIN-001, and VR-DATA-001. Primary attacker stories are VR-ABUSE-USAGE-FORGERY,
VR-ABUSE-DEVICE-KEY-THEFT, VR-ABUSE-DEVICE-ESCALATION, VR-ABUSE-ORIGIN-BYPASS,
VR-ABUSE-DATABASE-ROLE, VR-ABUSE-DEPENDENCY-PR, and VR-ABUSE-RESOURCE-EXHAUSTION.

## Dependency review

`@noble/ed25519@3.1.0` is exact-pinned and confined to the private server-side Ingest workspace. Its
official registry manifest and lock integrity match, it has no runtime or optional dependency, no
install lifecycle script, and an MIT license recorded in third-party notices. The canonical GitHub
release is signed and immutable, the project documents its security-review history, and the direct
interface is one strict verification call. It adds nothing to the browser, public route, connector,
database, or deployment graph.

The removal condition is a reviewed runtime verifier that proves equally strict point and signature
semantics across every supported platform and passes the same adversarial vectors. An update must
repeat source/release/advisory/license/script/transitive review and may not silently enable ZIP 215
compatibility. Rollback removes this workspace rather than substituting permissive native
verification.

## Alternatives considered

- **Use only Node `crypto.verify`:** rejected because the local zero-key/zero-signature probe was
  accepted and the API does not expose the required strict point-policy switch.
- **Add repository-owned Ed25519 point validation around OpenSSL:** rejected because custom curve
  validation would create a larger cryptographic implementation and review burden than one bounded,
  reviewed verifier.
- **Normalize or serialize JSON again before signing:** rejected because semantically similar JSON
  can have different received bytes and parser behavior; the proof must bind transport reality.
- **Parse before checking the edge proof:** rejected because unauthenticated callers would reach the
  more complex parser and device dependency first.
- **Use a bearer origin secret or trust forwarding headers:** rejected because neither binds the
  exact body, time, nonce, method, or route and both can be replayed when copied.
- **Build the Fastify listener and PostgreSQL adapter in the same slice:** rejected because socket
  framing, proxy trust, configuration, replay storage, deadlines, admission, public errors, and live
  role integration are separate reviewable boundaries. The pure kernel is their reusable input.

## Migration and rollback

This change adds one private workspace, one canonical authentication policy, root verification
gates, one exact runtime dependency, generated dependency evidence, and documentation. It adds no
database migration, grant, credential, environment variable, origin key, route registration,
listener, stored row, response, external destination, or deployment.

Rollback removes the workspace, policy, direct dependency, lock importer, generated dependency
evidence, scripts, and documentation. The existing sync contract and procedure-only database
capability remain disabled at the application boundary. A future HTTP server may wrap the verifier
and inject a real edge-nonce store plus ADR 0016's minimal database adapter. Any change to the proof
message, header set, algorithms, bounds, path, or accepted encoding requires a new version or a
superseding ADR rather than silent reinterpretation.

## Verification

Current local evidence includes:

- exact policy-to-code drift assertions and canonical proof-message vectors;
- full UTF-8/JSON grammar, BOM, decoded duplicate-key, nesting, node, fanout, number, string, body,
  header, encoding, timestamp, and base64url boundary cases;
- proxy, accessor, prototype, sparse-array, subclass, shared-buffer, and mutation-after-call cases;
- proof-key rotation, unknown key, old/future time, nonce replay, body/header tamper, dependency
  throw/non-boolean, and proof-before-parser/device-lookup ordering;
- contract, timestamp/body, idempotency/body, device/source, unknown/revoked/malformed material,
  signature, and backend-failure rejection;
- an explicit zero-public-key/zero-signature bypass regression and strict verification success;
- exact frozen success output with no origin proof, raw body, public key, or callback detail; and
- 117 unit/security tests with 100% statement, branch, function, and line coverage, plus strict
  lint, type checking, production TypeScript build, dependency/license inventory, root deterministic
  verification, and staged public-data review.

The tests use synthetic keys and injected in-memory capabilities. They do not exercise HTTP byte
framing, Cloudflare or Railway, a persistent origin replay store, PostgreSQL, an Ingest deployment
login, rate limits, deadlines, backpressure, load, a connector, or real data.

## References

- [Connector authentication policy](../../contracts/v1/connector-sync-authentication.json)
- [Contract boundary](../../contracts/README.md)
- [Ingest verification kernel](../../apps/ingest/README.md)
- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [System context](../architecture/SYSTEM_CONTEXT.md)
- [Data flow](../architecture/DATA_FLOW.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Dependency policy](../security/DEPENDENCY_POLICY.md)
- [Database capability boundary](../../database/README.md)
- [Edge, service, and database isolation](0004-edge-service-and-database-isolation.md)
