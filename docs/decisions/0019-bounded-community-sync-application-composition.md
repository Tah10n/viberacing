# ADR 0019: Bounded Community sync application composition

- Status: Accepted (local application boundary; consumed by ADR 0020)
- Date: 2026-07-15
- Decision owners: Ingest, API, Database, Security, Privacy, Contracts, and Operations
- Supersedes: None
- Superseded by: None

## Context

ADRs 0015 through 0018 separately implement the exact-body verification kernel, protected origin key
reader, persistent origin replay capability, minimal device lookup, and fixed submission adapter. A
caller could still compose them incorrectly: use a different replay store from the device lookup,
submit before verification settles, acknowledge a failed write, trust an accessor or mutable
verifier result, expose a database or proof error, reuse an inbound correlation value, or return a
response that drifts from `ConnectorSyncResultV1` or `ProblemDetailsV1`.

The next local slice must make that orchestration executable without claiming an HTTP listener,
socket framing, proxy policy, edge deployment, working PostgreSQL login, or production capacity. It
crosses TB-05, TB-06, and TB-07 but remains a transport-free application decision.

## Decision

Add one private Community sync application boundary. Its configured factory creates exactly one
bounded Ingest database adapter, injects that same object's atomic origin consume and minimal device
lookup capabilities into the protected-key verifier factory, and binds the same object's submission
capability to the application. If verifier construction fails after pool creation, it closes the
database boundary before propagating the bounded configuration failure. The returned frozen object
exposes only `execute` and `close`.

Every execution first requests exactly 16 bytes from Node's cryptographic random source. Unpadded
base64url plus the fixed `req_` prefix creates the contract's opaque 128-bit request ID. No inbound
header, request field, or application-factory argument can supply or replace it; the production API
exposes no entropy callback. Entropy failure or final contract rejection throws one generic
construction error; the application does not invent a weak fallback identifier or claim a malformed
public response.

The execution order is fixed:

1. create the request ID;
2. call the exact raw-request verifier;
3. require its closed, frozen result and copy only the stable sync ID and entry count summary;
4. submit the original verifier allowlist through the bounded database adapter; and
5. reconstruct and validate one success or problem contract.

The database adapter still revalidates and copies every submission field. The application accepts
only an exact own-data result with coherent counts: `accepted` equals the submitted entry count,
while `duplicate` and `quarantined` equal zero. A successful decision is HTTP-neutral metadata with
status 200 and a frozen null-prototype `ConnectorSyncResultV1`. It returns only schema version,
server request ID, sync ID, coarse outcome, and accepted count. It never returns a quarantine
reason, body, source, device, usage value, signature, nonce, proof, key, SQL detail, or exception.

Failures map to a closed subset of `ProblemDetailsV1`:

| Internal condition                                     | Public code               | Status | Retryable |
| ------------------------------------------------------ | ------------------------- | ------ | --------- |
| Invalid raw request                                    | `invalid_request`         | 400    | No        |
| Contract-invalid body                                  | `validation_failed`       | 422    | No        |
| Origin or device proof rejected                        | `unauthorized`            | 401    | No        |
| Verifier dependency unavailable                        | `temporarily_unavailable` | 503    | Yes       |
| Connection, query, release, or runtime-boundary outage | `temporarily_unavailable` | 503    | Yes       |
| Invalid internal input/result/identifier or unknown    | `internal_error`          | 500    | No        |

Origin and device failures deliberately share one response. Database codes, callback exceptions,
causes, submitted values, and configuration details never enter the body. Every problem is a frozen
null-prototype object validated as `ProblemDetailsV1` and carries the same server-generated request
ID.

This boundary does not create a `Response`, serialize JSON, select HTTP headers, accept a framework
request, open a socket, trust a proxy, enforce a stream deadline, allocate an admission lease,
implement backpressure or rate limiting, log an event, provide a live credential, or deploy an
endpoint. A future HTTP wrapper must preserve the verifier's raw bytes and duplicate-header
evidence, add those transport controls, serialize only these validated decisions, and hold any
admission lease until database settlement.

## Security and privacy consequences

One factory now makes the intended least-authority composition hard to bypass accidentally. Origin
replay remains before parsing and device lookup; submission remains after exact-body device
verification; PostgreSQL remains authoritative for receipt time, lifecycle, device nonce,
idempotency, season closure, and quarantine. Runtime reconstruction, frozen summaries, exact result
keys, final generated-contract validation, and generic error translation contain compromised or
drifting internal boundaries.

The application collects no new user field and creates no persistence, log, cache, metric,
analytics, or export sink. It transiently handles the existing Security and Usage values already
mapped for sync. The new opaque request ID and coarse decision are Operational data: returned only
to the eventual response recipient, discarded after the call in current code, and not
authentication, authorization, replay, idempotency, CSRF, or rate-limit authority. A future log or
metric must separately define access, retention, and deletion in the privacy data map.

Affected invariants are VR-PUBLIC-001, VR-DEVICE-001, VR-DEVICE-002, VR-INGEST-001, VR-INGEST-002,
VR-ORIGIN-001, VR-DATA-001, and VR-ABUSE-001. Primary attacker stories are VR-ABUSE-USAGE-FORGERY,
VR-ABUSE-DEVICE-KEY-THEFT, VR-ABUSE-ORIGIN-BYPASS, VR-ABUSE-DATABASE-ROLE, and
VR-ABUSE-RESOURCE-EXHAUSTION.

## Alternatives considered

- **Let the future HTTP route call each boundary directly:** rejected because route code could
  reorder, split, or inconsistently translate the security-critical sequence.
- **Return database or verifier errors to help the connector debug:** rejected because they reveal
  proof, lifecycle, role, SQL, or infrastructure distinctions and create an unstable public API.
- **Acknowledge before the database settles:** rejected because a client could stop retrying a
  submission that never committed.
- **Accept an inbound request ID:** rejected because it permits correlation injection and reflected
  header/body content.
- **Add Fastify and transport controls now:** deferred because raw stream limits, duplicate-header
  preservation, trusted proxy semantics, socket timeouts, admission, and response serialization are
  a separate trust boundary and dependency review.
- **Use a generic success object without runtime validation:** rejected because the existing
  response schema is the public source of truth and generated consumers reject drift.

## Migration and rollback

This decision adds no dependency, database migration, grant, environment field, network destination,
listener, route registration, deployment value, stored row, or retained log. Rollback removes the
application/composition module, its exports, tests, documentation, and this ADR. The separate
verifier, protected key reader, replay store, database adapter, and SQL capabilities remain locally
available but must not be exposed through an ad hoc replacement wrapper.

After an HTTP consumer exists, rollback must disable ingestion or preserve the exact decision and
error contract through an equivalent reviewed boundary. It must not bypass persistent replay, submit
an unverified record, acknowledge before settlement, accept an inbound request ID, or fall back to a
framework error.

## Verification

Current local evidence includes:

- all five verifier error classes, all eight database error classes, unknown exceptions, malformed
  dependencies, unavailable or malformed Node entropy, rejection of a caller-selected entropy
  argument, and non-reflective generic decisions;
- frozen/null-prototype success and problem bodies, accepted/duplicate/quarantined coherence, and
  fail-closed generated-contract rejection;
- mutable, decorated, accessor-backed, throwing-prototype, sparse, empty, invalid-ID, and malformed
  verifier or database results;
- one synthetic signed raw request passing through the actual production verifier, origin consume,
  minimal device lookup, bounded database adapter, and submission mapper in the required order;
- configured factory construction, explicit close, and database cleanup after invalid origin
  configuration; and
- 54 new adversarial/composition cases, bringing the Ingest suite to 317 tests at 100% statement,
  branch, function, and line coverage, plus strict lint, type checking, and production build.

The composed production-path test uses a synthetic key and mock PostgreSQL pool. It does not prove a
working deployment login, certificate, live PostgreSQL connection, Cloudflare signer, direct-origin
denial, HTTP framing, public header/serialization policy, admission, backpressure, rate limits,
capacity, connector behavior, or real-user synchronization.

## References

- [Follow-on Fastify HTTP boundary](0020-bounded-community-sync-fastify-http-boundary.md)
- [Community sync verification kernel](0015-bounded-community-sync-verification-kernel.md)
- [Bounded Ingest PostgreSQL adapter](0016-bounded-ingest-postgresql-adapter.md)
- [Protected origin key configuration](0017-protected-ingest-origin-key-configuration.md)
- [Persistent origin replay store](0018-persistent-ingest-origin-replay-store.md)
- [Public protocol contracts](../../contracts/README.md)
- [Ingest workspace](../../apps/ingest/README.md)
- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [System context](../architecture/SYSTEM_CONTEXT.md)
- [Data flow](../architecture/DATA_FLOW.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
