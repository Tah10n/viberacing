# ADR 0028: Bounded pairing start composition

- Status: Accepted (local transport-free start; HTTP, approval, and connector client pending)
- Date: 2026-07-16
- Decision owners: Web/Auth, Database, Connector, Security, Privacy, Compatibility, and Operations
- Supersedes: None
- Superseded by: None

## Context

Revision 0003 exposes an anonymous `start_pairing` procedure that can atomically create one pending
device key and pairing transaction. ADR 0027 can resolve and activate an approved transaction, but
no application creates the identifiers, poll token, challenge, human code, keyed digests, or bounded
expiry accepted by that procedure. Calling it from a route or generic repository would let a caller
choose security identifiers and verifier material and would expose an unbounded database-write
capability.

The plan requires the connector to receive the plaintext poll token, transaction challenge, and
short code once while PostgreSQL stores only keyed verifiers. The short human code has materially
less entropy than the poll token and therefore needs its own protected HMAC key, future bounded
attempt controls, and a visible transaction confirmation rather than a reusable digest. This slice
must establish the local construction boundary without claiming an HTTP endpoint, supported
connector, browser approval, WebAuthn verification, live database login, cleanup schedule, or
deployment.

## Decision

### Exact request and generated material

The transport-free application accepts only a plain object with exactly:

- `devicePublicKeyBase64Url`: a canonical unpadded base64url encoding of exactly 32 nonzero bytes;
- `deviceLabel`: NFC text containing 1 to 64 Unicode code points, at most 128 UTF-16 code units,
  trimmed and free of control, format, and surrogate characters;
- `connectorVersion`: a syntactically bounded 5-to-64-character SemVer string;
- `osFamily`: `windows`, `macos`, or `linux`; and
- `architecture`: `x86_64` or `aarch64`.

This syntactic connector version check is not compatibility or release admission. No caller supplies
a pairing ID, pending-key ID, verifier, challenge, expiry, request ID, user code, or database field.

Every admitted attempt obtains independent server entropy for a 32-byte poll token, 32-byte
challenge, version-4 pairing UUID, version-4 pending-key UUID, and 60-bit user code. The user code
is 12 symbols from the unambiguous Crockford-style alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`,
rendered as `XXXX-XXXX-XXXX`. Sixty random bits keep a short manual value practical while making
accidental collisions negligible at expected cumulative volume, including while expired rows remain
under the permanent uniqueness constraint. Physical cleanup and edge/service attempt limits remain
mandatory before exposure.

The application expiry is exactly nine minutes after its local clock reading. This stays inside the
database procedure's authoritative ten-minute maximum and leaves one minute for local scheduling,
checkout, and clock drift. PostgreSQL still rejects an already expired or over-ten-minute value.

### Separate keyed human-code verifier

The poll token continues to use ADR 0027. The user code uses separate exact 32-byte primary and
optional secondary keys from:

- `VIBERACING_WEB_PAIRING_CODE_PRIMARY_KEY_BASE64URL`; and
- `VIBERACING_WEB_PAIRING_CODE_SECONDARY_KEY_BASE64URL`.

Both values are canonical unpadded base64url. Primary and secondary material must differ, and
neither may equal either configured poll-verifier key. The version 1 user-code verifier is
HMAC-SHA-256 over:

```text
UTF8("viberacing-pairing-user-code-verifier-v1") || LF || ASCII(canonical_user_code)
```

Pairing start persists only the primary poll and user-code digests. The optional secondary exists so
a later authenticated approval lookup can accept transactions created under the previous primary
during the bounded lifetime. Invalid codes take a fixed domain-separated two-HMAC derivation shape
but are never lookup-eligible. Missing secondary keys use a separate inactive domain. The closeable
capability retains decoded key bytes without returning a key container and overwrites retained and
candidate copies on close or settlement; this is defense in depth, not a runtime-erasure guarantee.

### Fixed database boundary

The existing dedicated `viberacing-web-pairing` pool gains one method whose SQL text is fixed at
construction. It invokes only `viberacing_api.start_pairing` with the generated IDs, primary
digests, challenge, validated public key and metadata, and canonical expiry. It exposes no generic
query, caller-selected procedure, state, profile, source, or audit field. The wrapper copies and
overwrites all byte parameters after the driver settles.

A separate high-level start adapter revalidates the complete closed input, probes the exact ADR 0027
read-write role/login/search-path boundary on every checkout, requires one closed success row, and
destroys a client after probe, query, result, or mapping failure. Release and close failures use
only stable non-reflective codes. Revision 0003 remains authoritative for transaction and key
insertion, format checks, unique digests/IDs/keys, expiry, atomic rollback, and runtime-role denial.

### Transport-free application policy

One process admits at most four start attempts concurrently and holds each admitted lease through a
minimum 250-millisecond settlement floor. This bounds long-run steady-state minimum-path work to 16
completions per second per process; it is not a strict sliding-window or distributed client-rate
limit. Overload performs no entropy or database work. Malformed admitted input still performs fresh
material and both HMAC derivations but performs no database write because there is no protected
state to query and invalid anonymous writes must not consume persistence.

After a server request ID and admission lease exist, every malformed request or public key, raced,
database, timing, cleanup, release, or internal failure returns the same frozen `not_created`
decision plus that request ID. Only a fully settled exact-boolean database success returns `created`
plus the request ID, pairing ID, poll token, challenge, user code, and expiry. It returns no
pending-key ID, digest, database value, SQL detail, or error cause. Protected-configuration or
request-ID generation failure prevents construction or execution and exposes only a stable
non-reflective error. A failure after a committed start intentionally withholds all plaintext
material; the unreachable row remains unusable and expires.

This is not an external timing contract. A future route must separately provide bounded body and
header parsing, edge and service admission, distributed attempt and IP-derived controls, request
deadline/cancellation behavior, exact response schemas, external timing analysis, and safe logging
policy. No route or visible component may import the low-level pool or start adapter.

The configured start and activation factories currently own independent admission counters and
four-connection pool instances. A future host that constructs both must add one reviewed aggregate
CPU, connection, and anonymous-attempt budget; the per-application bounds are not aggregate capacity
evidence.

## Security and privacy consequences

Starting a transaction grants no profile, source, approval, activation, or sync authority. The poll
token and code cannot activate without browser/session approval and the exact pending private-key
proof. The application rejects all-zero keys but deliberately defers strict Ed25519 point and
possession validation to ADR 0026/0027; invalid pending keys can only expire and remain subject to
future anonymous rate and cleanup controls.

The request metadata, poll token, code, digests, challenge, public key, pairing ID, pending-key ID,
expiry, and request ID are existing Security or Operational classes. This slice adds no database
column, cookie, browser state, log, metric, analytics event, cache, export, remote destination, or
supported-version claim. Plaintext secrets live only in transient strings/bytes and a successful
local decision. Real key configuration remains outside the repository and must not be logged.

Affected invariants are VR-DEVICE-001, VR-DATA-001, VR-PUBLIC-001, and VR-RELEASE-001. Primary
attacker stories are VR-ABUSE-PAIRING-GUESS, VR-ABUSE-DEVICE-KEY-THEFT,
VR-ABUSE-RESOURCE-EXHAUSTION, VR-ABUSE-DATABASE-ROLE, and VR-ABUSE-SECRET-LEAK.

## Alternatives considered

- **Store a raw SHA-256 user-code digest:** rejected because database disclosure would permit an
  immediate offline dictionary over the short human code.
- **Reuse the poll-verifier key:** rejected to preserve cryptographic and operational separation
  between a high-entropy connector bearer and a human-entered lookup value.
- **Use an 8-symbol/40-bit code:** rejected because the permanent uniqueness constraint makes
  birthday collisions material at plausible lifetime volumes even before cleanup risk is resolved.
- **Use decimal-only or words:** rejected because equivalent entropy would require a longer value or
  a locale-sensitive dictionary and normalization policy.
- **Set the application expiry to ten minutes:** rejected because procedure statement time and local
  queue/checkout delay could turn a valid local value into an over-limit database request.
- **Call the database for malformed input:** rejected because start has no protected state to hide
  and anonymous invalid data must not consume the bounded write pool.
- **Add HTTP and connector response contracts now:** rejected because client identity, body bounds,
  edge/service rate policy, deadlines, version admission, and capacity evidence are unfinished.

## Migration and rollback

This decision adds no SQL migration, route, public JSON Schema, login, supported version, real key,
or deployment. It extends the dormant pairing pool, adds the protected code-verifier and local start
database/application boundaries, records intentionally invalid public placeholders, and updates
tests and documentation.

Rollback removes these local modules and the extra pool method/configuration names together. It must
not replace keyed verifiers with raw digests, expose `start_pairing` directly, or leave a route that
can create pending rows without the complete transport and abuse-control review.

## Verification

Deterministic and production-path tests cover exact HMAC messages, primary/secondary rotation,
cross-purpose key rejection, malformed/unreadable configuration, fixed invalid work, candidate/key
clearing, generated ID/token/challenge/code/expiry bounds, hostile request and adapter shapes,
Unicode label limits, all-zero public keys, exact fixed SQL and copied parameters, per-checkout
read-write probes, closed results, destructive release, local saturation/settlement ordering,
generic failures, close, and whole-Web import confinement.

Focused Web lint, type, coverage, production build, configuration/security/documentation checks, and
the full repository verification gate pass before commit. Tests use synthetic keys and injected
pools. They do not create a live PostgreSQL row, verify a real connector key, admit a supported
version, expose an endpoint, perform browser approval/WebAuthn, prove distributed limits or cleanup,
or deploy a service.

## References

- [ADR 0003](0003-identity-step-up-and-device-authority.md)
- [ADR 0004](0004-edge-service-and-database-isolation.md)
- [ADR 0026](0026-bounded-pairing-possession-proof.md)
- [ADR 0027](0027-bounded-pairing-activation-composition.md)
- [Pairing database capability](../../database/migrations/0003_pairing_capabilities.sql)
- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
