# ADR 0016: Bounded Ingest PostgreSQL adapter

- Status: Accepted (local adapter and ADR 0019 composition implemented; live login/HTTP pending)
- Date: 2026-07-15
- Decision owners: Ingest, Database, Security, Privacy, Dependencies, and Operations
- Supersedes: None
- Superseded by: None

## Context

ADR 0015 returns a closed, exact-body-authenticated Community submission, while database revision
0010 exposes only minimal active-device verification material and one procedure-only submission
capability. The application still stopped between those boundaries. A future wrapper could otherwise
reuse the compose owner, trust arbitrary PostgreSQL rows, expose a general query method, concatenate
values into SQL, pass mutable proof bytes to the driver, or reflect a host, login, credential, SQL,
row, or driver error.

The repository cannot provide a real deployment login or certificate. It can make the local
application-to-database contract executable without adding the HTTP listener, origin-key reader,
persistent origin replay store, public acknowledgement, or deployment path.

## Decision

Add a bounded database adapter inside the private `apps/ingest` workspace. It reuses the
exact-pinned `pg@8.22.0` client already reviewed for the Web and Jobs adapters; this adds one
workspace importer but no new package or transitive version. ESLint permits the driver import only
in `database-pool.ts`. The pool wrapper exposes fixed device-lookup, submission, runtime-probe,
release, and close operations, never a caller-selected query.

The adapter consumes only these namespaced settings:

- `VIBERACING_INGEST_DATABASE_HOST`, `PORT`, `NAME`, `USER`, and `PASSWORD`; and
- `VIBERACING_INGEST_DATABASE_TLS_MODE`, exactly `disable` or `verify-full`.

The settings are separate from compose bootstrap authority and the Web and Jobs settings. Cleartext
requires explicit `NODE_ENV=development` or `test` and exactly `localhost`, `127.0.0.1`, or `::1`.
Every other environment requires `verify-full`, a bounded multi-label DNS name, normal certificate
and hostname verification, and TLS 1.2 or later. Connection strings, IP-based TLS, opportunistic
TLS, certificate disabling, tracked certificate material, and invented deployment values remain
unsupported. The frozen config keeps the password non-enumerable and serializes only a redaction
marker; code must still never deliberately read and log it.

The pool has zero to four clients. Checkout/connect wait is two seconds, the PostgreSQL statement
deadline is 31 seconds around the procedure's 30-second bound, the driver query deadline is 32
seconds, lock wait is six seconds around the procedure's five-second bound, and idle transactions
end after five seconds. Idle clients expire after ten seconds, 1,000 uses, or five minutes. TCP
keep-alive is enabled. These are local fail-safe ceilings, not production capacity evidence; the
future HTTP boundary still needs no-queue admission, socket deadlines, backpressure, edge shaping,
and load measurement.

Every checkout starts with `viberacing_ingest` role and `pg_catalog,pg_temp` search path settings.
Immediately before either capability, one fixed probe requires:

- `CURRENT_USER` exactly `viberacing_ingest`;
- a distinct login that can log in, has no broad PostgreSQL role attribute, has database `CONNECT`
  but neither `CREATE` nor `TEMPORARY`, can set exactly the Ingest group role, and is a member of no
  other role; and
- the exact safe search path.

The probe rejects the compose owner even if that superuser can change role. A false, malformed,
accessor-backed, proxy-failing, or throwing probe destroys the client. Pool idle errors become only
the optional signal `idle_client_error`; a synchronous or asynchronous monitoring-hook failure is
contained and receives no driver exception.

The device reader accepts only a canonical public device ID and calls exactly
`viberacing_api.read_device_verification_material($1::text)`. Zero exact rows means unknown device.
One row must contain only a canonical internal device-key UUID, bound source ID, and exact 32-byte
public key. The key is copied before returning the frozen tuple. Multiple, decorated, inherited,
accessor-backed, malformed, or unexpected rows fail closed and destroy the client.

Submission accepts an unknown value rather than trusting a TypeScript assertion. It reconstructs
only the seven verifier fields through own enumerable data descriptors, accepts plain or null
prototype records, requires dense standard arrays, revalidates the canonical `ConnectorSyncV1`,
checks the device/key/idempotency identifiers, and decodes exact lowercase SHA-256 hex plus
canonical 64-byte base64url signature values. It creates a server-side version 4 UUID and copies
both digests, the signature, dates, and token values before calling the pool.

The pool issues one fixed 13-parameter call to `viberacing_api.submit_community_sync`, with explicit
PostgreSQL casts for UUID, text, timestamp, binary, text-array, and bigint-array values. JavaScript
safe integers cross as decimal strings rather than driver-selected numeric conversions. The database
remains authoritative for receipt time, freshness, nonce replay, idempotency, current
device/source/profile state, season closure, quarantine, and transaction locks. In particular, a
revocation between application lookup and submission is still rejected by the procedure.

Exactly one result row is required. `accepted` must report the submitted entry count; `duplicate`
and `quarantined` must report zero. No other outcome, count, column, row shape, or prototype is
accepted. A healthy client is released normally; role, query, or result failure destroys it.
Unavailable connection, invalid input, identifier failure, runtime drift, query/result, release, and
close failure remain bounded internal codes behind one generic message without a cause or
submitted/dependency detail.

This is not an HTTP service. It does not configure origin HMAC keys, persist origin replay, accept a
socket or framework request, translate a public response, log a request, implement rate or admission
policy, supply a real login/certificate, connect to the integration database, or deploy anything.

## Security and privacy consequences

The fixed SQL and closed mapper remove caller-selected SQL and PostgreSQL type/result selection from
TB-07. The every-checkout probe and dedicated role preserve VR-DATA-001 under login, membership,
startup-option, or pooled-session drift. The database independently revalidates lifecycle and replay
state, so the earlier device lookup grants no lasting authority. Conservative pool and deadline
settings limit one process but do not establish safe public capacity.

No new user field is collected or retained. The adapter transiently handles only the Usage and
Security fields already mapped for sync and sends them to the existing procedure. It adds one Ingest
deployment login/password class parallel to the existing Web credential class: protected
configuration and driver memory only, never tracked or logged, rotated when exposed or disabled. The
adapter creates no cache, analytics, export, metric, request ID, log sink, or new database row type.
The database's existing 15-minute device-nonce and 30-day raw-snapshot rules remain unchanged.

Affected invariants are VR-DEVICE-001, VR-INGEST-001, VR-DATA-001, VR-ABUSE-001, VR-DELETE-001, and
VR-INGEST-002. Primary attacker stories are VR-ABUSE-DEVICE-KEY-THEFT, VR-ABUSE-DATABASE-ROLE,
VR-ABUSE-RESOURCE-EXHAUSTION, VR-ABUSE-DELETE-RESURRECTION, and VR-ABUSE-DEPENDENCY-PR.

## Alternatives considered

- **Build the HTTP listener and replay store in the same slice:** rejected because transport
  framing, origin secrets, replay persistence, response mapping, admission, and socket behavior are
  separate TB-05/TB-06 boundaries.
- **Reuse the compose owner or another service login:** rejected because role switching by a broad
  login is not least privilege and would merge independently revocable runtime principals.
- **Expose `pool.query` or an ORM:** rejected because there are exactly two reviewed functions and
  no use case for caller-selected SQL, table, column, transaction, or query-builder behavior.
- **Trust the verifier's TypeScript type without remapping:** rejected because internal misuse,
  mutation, accessors, proxies, or future refactors must not change the fixed database call.
- **Keep one client across proof verification and submission:** rejected because origin replay must
  occur before device lookup and should not hold a scarce database client while parsing or doing
  cryptography. The submission procedure already closes the lifecycle race.
- **Generate the snapshot UUID in PostgreSQL:** deferred because the existing reviewed procedure
  deliberately receives the opaque identifier; changing it would require a new migration and
  database integration evidence without improving authority.

## Migration and rollback

There is no database migration, grant, route, replay row, or deployment change. Rollback removes the
adapter/config/pool, `pg` and type declarations from the Ingest importer, dependency-inventory
references, tests, documentation, and this ADR. The verification kernel and SQL procedures remain
separately disabled at the application boundary. No fallback may use the compose owner, another
service pool, direct tables, a general query, or weaker TLS.

After an HTTP consumer exists, rollback must disable that route with its reviewed generic public
failure and must not acknowledge a submission that did not reach the procedure. Origin replay state
remains independently managed and must not be weakened to keep ingestion available.

## Verification

Current local evidence includes:

- exact namespaced environment fields; bounded host, port, identifier, and password values;
  loopback-only cleartext; DNS/certificate-verified TLS; frozen redacted configuration; and
  non-reflective unreadable-environment failure;
- a four-client pool with fixed wait/deadline/recycling options, one isolated driver import, copied
  byte/array parameters, structured queries only, explicit close/release, stable idle signal, and
  monitoring-hook containment;
- the every-checkout effective-role, login-attribute/membership, database-capability, and
  search-path probe before either procedure;
- exact device lookup with zero/one-row semantics, copied key bytes, and rejection of malformed,
  decorated, inherited, accessor-backed, proxy-failing, or multiple rows;
- reconstruction and contract revalidation of the verifier output, version 4 UUID dependency, exact
  13-parameter submission, safe bigint strings, and coherent accepted/duplicate/quarantined result
  mapping;
- connection, role, query, result, release, close, and identifier failure containment with
  destructive client release; and
- 214 total Ingest unit/security tests, including 97 new adapter/configuration/boundary cases, with
  100% statement, branch, function, and line coverage, plus strict lint, type checking, and
  production TypeScript compilation.

Tests use synthetic inputs and mock pools. They do not authenticate through a deployment login,
negotiate TLS, or execute these calls against PostgreSQL. The existing isolated PostgreSQL suite
separately proves both functions, grants, constraints, deadlines, role denials, and concurrency. ADR
0019 later adds one signed synthetic verifier-to-adapter execution through a mock pool. HTTP
framing, live origin secret/replay integration, working login/TLS, admission/load, monitoring
backend, connector, Cloudflare/Railway, and deployment evidence remain open.

## References

- [Community sync verification kernel](0015-bounded-community-sync-verification-kernel.md)
- [Edge, service, and database isolation](0004-edge-service-and-database-isolation.md)
- [Ingest workspace](../../apps/ingest/README.md)
- [Database capability boundary](../../database/README.md)
- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [System context](../architecture/SYSTEM_CONTEXT.md)
- [Data flow](../architecture/DATA_FLOW.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Dependency policy](../security/DEPENDENCY_POLICY.md)
- [Dependency inventory](../reference/dependency-inventory.json)
