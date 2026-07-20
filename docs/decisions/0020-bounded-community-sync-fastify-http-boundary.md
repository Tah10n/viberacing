# ADR 0020: Bounded Community sync Fastify HTTP boundary

- Status: Accepted
- Date: 2026-07-15
- Decision owners: Ingest, API, Security, Privacy, Contracts, Dependencies, and Operations
- Supersedes: None
- Superseded by: None

## Context

ADR 0019 composes verification, persistent origin replay, minimal device lookup, and submission into
one transport-free application decision. It deliberately leaves HTTP parsing and serialization
outside that boundary. A careless wrapper could normalize the signed body, collapse duplicate
security headers, trust forwarded identity or an inbound request ID, expose framework errors, queue
unbounded work behind the four-client database pool, keep slow sockets indefinitely, or advertise a
public operation that differs from the generated contract.

The next local slice must make the exact `POST /v1/community/sync` transport executable without
claiming Cloudflare/Railway ingress, a host or port configuration, TLS termination, a working
database login, real origin keys, load capacity, or deployment. It crosses TB-05 and TB-06 before
handing the closed raw envelope to ADR 0019 at TB-07.

## Decision

Use exact-pinned `fastify@5.10.0` for one private Ingest HTTP server factory. Only
`community-sync-http-server.ts` may import, re-export, dynamically import, or require Fastify; the
workspace lint policy fails closed everywhere else. The factory accepts only a frozen plain object
with the exact `execute` key and optional exact `close` key. It registers no plugin, logger, cookie,
session, CORS helper, authentication alternative, health route, general router, environment reader,
or deployment entry point.

The server exposes one exact case-sensitive path. `POST /v1/community/sync` accepts only Fastify's
bounded `application/json` raw-buffer parser. The default parsers are removed. The application
receives a copied `Buffer`, a copied immutable raw-header sequence, the raw method, and the raw
request target; the transport never parses and serializes JSON again for either signature. Required
header duplication, canonical encodings, request-target equality, body structure, origin proof,
device signature, and persistent replay remain the verifier's responsibility.

The transport policy is versioned in `connector-sync-authentication.json` and bound to executable
constants:

| Control                     | Local policy                          |
| --------------------------- | ------------------------------------- |
| Raw body                    | 8192 bytes                            |
| Parsed header bytes         | 16384 bytes                           |
| Raw header pairs            | 64                                    |
| Active application calls    | 4, no queue                           |
| Node connections            | 32                                    |
| Requests per socket         | 16                                    |
| Request receive timeout     | 5 seconds                             |
| Handler timeout             | 33 seconds                            |
| Connection timeout          | 34 seconds                            |
| Keep-alive timeout          | 5 seconds                             |
| Proxy trust                 | Disabled                              |
| Inbound request ID          | Disabled                              |
| Framework request logging   | Disabled                              |
| Response cache/CORS posture | `no-store`, same-origin/no CORS grant |

The four-call admission lease is acquired without waiting and held until the application promise
settles, including after a framework timeout response. The 33-second handler policy exceeds the
adapter's 32-second client deadline, and the connection policy exceeds the handler deadline. The
server also rejects insecure HTTP parsing, duplicate-slash and trailing-slash normalization,
constructor/prototype poisoning, non-standard body writes, and missing HTTP/1.1 Host; it closes idle
connections naturally within the five-second keep-alive bound during shutdown. It deliberately sets
`forceCloseConnections: false`: Node may otherwise classify a socket as idle after reading the
request body while its asynchronous application handler is still waiting on PostgreSQL, destroying
the exact response before database settlement. Fastify still stops new admission on close, and the
host's independent 36-second deadline remains the terminal bound.

`Accept` uses a bounded closed grammar. Missing `Accept`, JSON, or a compatible wildcard with
positive selected quality is accepted; the most specific matching range takes precedence, so an
explicit JSON exclusion cannot be bypassed by a positive wildcard. Malformed, over-budget, non-JSON,
zero-quality, duplicated parameters, quoted parameters, or unknown parameters fail with 406 before
application work. Parser-accepted non-POST methods on the exact path return 405 and `Allow: POST`;
unknown routes return 404. Parser/client errors return a generic 400. Admission exhaustion and
handler-style 503 failures return a generic retryable 503. Other framework or application-boundary
failures return generic 500. None reflects a URL, header, body, exception, proxy value, or submitted
request ID.

Every response is reconstructed from own enumerable data and validated against
`ConnectorSyncResultV1` or `ProblemDetailsV1` immediately before serialization. Success uses JSON;
problems use problem JSON. All replies include `Cache-Control: no-store`, `Vary: Accept`,
`X-Content-Type-Options: nosniff`, and one server-generated opaque 128-bit request ID. The transport
does not emit `Access-Control-Allow-Origin`, cookies, or a caller-controlled correlation value. A
malformed HTTP parser error receives the same bounded raw response; entropy or socket-write failure
destroys the socket rather than inventing a weak identifier or partial public body.

The canonical manifest now defines both the public score GET and Community sync POST. The generator
supports method-specific query or request-body contracts, no-queue admission metadata, an explicit
authentication-policy reference, and grouped OpenAPI paths. Its source digest includes the
referenced sync authentication policy. The checker binds each `implemented-local` operation to its
exact production and test evidence and rejects generated drift.

## Dependency review

Fastify is preferred over a repository-owned HTTP parser/router because maintained parsing, timeout,
shutdown, injection-test, and Node server integration reduce risk at this boundary. Version 5.10.0
was the current official release reviewed on 2026-07-15 and supports the repository's Node 24
runtime. The package and its added lock graph install without lifecycle or native build scripts. The
42 added package records declare only MIT or BSD-3-Clause licenses. Canonical repository, release
recency, maintenance, security guidance, exact registry integrity, transitive lock diff, licenses,
scripts, and supported runtime were reviewed. The official-registry advisory gate reported no known
moderate, high, or critical vulnerability at review time.

The framework remains an HTTP mechanism, not a security authority. Generated schemas, the raw
verifier, the protected key reader, PostgreSQL procedures, and final response validators remain the
sources of truth. Updating Fastify requires the same dependency review plus all raw-framing, proxy,
timeout, overload, generic-error, contract, and production-build regressions.

## Security and privacy consequences

The transport adds no new application payload field and no persistence, cache, analytics, metric,
log, or export sink. It transiently holds the existing Usage and Security request values already
mapped for Community sync. Raw bodies and raw headers are copied only in process for verification
and are never logged. Framework logging is disabled. A transport-generated request ID is Operational
data, returned only in the response and discarded; it is not authentication, authorization, replay,
idempotency, rate-limit, or CSRF authority.

Disabling proxy trust means local code never treats `Forwarded` or `X-Forwarded-*` as authenticated
client identity. It does not prove that Railway is unreachable directly or that Cloudflare added a
valid proof; those controls still require deployment evidence. Connection and admission ceilings
bound one process but do not establish production capacity or distributed rate limiting. The current
server factory does not bind a port, terminate TLS, expose readiness, configure a secret manager,
connect to live PostgreSQL, or provide monitoring.

Affected invariants are VR-PUBLIC-001, VR-DEVICE-001, VR-DEVICE-002, VR-INGEST-001, VR-INGEST-002,
VR-ORIGIN-001, VR-DATA-001, and VR-ABUSE-001. Primary attacker stories are VR-ABUSE-USAGE-FORGERY,
VR-ABUSE-DEVICE-KEY-THEFT, VR-ABUSE-ORIGIN-BYPASS, VR-ABUSE-DATABASE-ROLE, VR-ABUSE-DEPENDENCY-PR,
and VR-ABUSE-RESOURCE-EXHAUSTION.

## Alternatives considered

- **Use Node `http` directly:** rejected because this slice would own more parser, routing, timeout,
  shutdown, and test-injection behavior without reducing authority.
- **Use the Next.js route runtime:** rejected because Ingest is a separately deployable principal
  with different credentials, raw-header requirements, and database capability.
- **Trust forwarded headers behind the intended edge:** rejected until the exact trusted proxy chain
  and direct-origin denial are deployed and verified. Origin proof, not source IP text,
  authenticates the edge.
- **Queue requests until a database client is free:** rejected because attacker-controlled waiting
  consumes memory and sockets and hides overload from the connector.
- **Parse JSON in Fastify and sign the object:** rejected because serializing again loses exact-byte
  and duplicate-key evidence.
- **Expose framework errors or accept inbound request IDs for diagnostics:** rejected because they
  create reflection and internal-state disclosure surfaces.
- **Add deployment host/port, TLS, secrets, or monitoring in this slice:** deferred because those
  require environment-specific authority, operational review, and live evidence.

## Migration and rollback

This decision adds one exact runtime dependency, one local server factory, one no-queue admission
primitive, generated POST documentation, and no database migration, grant, environment field,
network destination, stored row, or retained log. Rollback removes those files and dependency,
restores the manifest to the score-only operation, regenerates derived contracts and inventory, and
leaves ADRs 0015–0019 intact.

ADR 0033 now consumes this factory through a separate local host. Rolling either boundary back from
a deployed state must first disable Community sync or replace the complete transport with an
equivalent reviewed boundary. It must not expose the transport-free application directly, normalize
signed bytes, discard duplicate headers, queue without a bound, trust arbitrary proxies, weaken
proof/replay checks, or return unvalidated framework output.

## Verification

Current local evidence includes:

- construction rejection for mutable, open, accessor-backed, non-function, and hostile application
  objects, plus close-hook settlement and a real-listener regression proving an active asynchronous
  response completes before application close;
- exact raw-body and raw-header preservation, duplicated security-header evidence, strict route,
  method, content type, `Accept`, proxy, inbound-ID, and response-header behavior;
- malformed framing and duplicate `Content-Length` over a real loopback socket, body/header budgets,
  partial-request socket timeout, a completed-stream accepted response after asynchronous work,
  connection/reuse policy, and generic raw client errors;
- no-queue overload with four unsettled application calls and lease retention until settlement;
- every application success/problem mapping, thrown/rejected work, framework-style 503, malformed or
  accessor-backed decisions, generated-validator rejection, entropy failure, write failure, and
  non-reflection assertions;
- 109 additional cases, bringing the Ingest suite to 427 tests at 100% statement, branch, function,
  and line coverage, plus strict lint, type checking, and production build;
- two generated OpenAPI operations and 40 checker regression cases, including missing evidence,
  method-specific contract drift, referenced authentication-policy digest drift, and stale output;
- one opt-in emitted-host integration proving accepted/duplicate/replay/revoke response status,
  headers, unique request IDs, exact PostgreSQL state, and four admitted calls held through the
  first replay query while a fifth returns generic 503 without a fifth query;
- one separate opt-in pinned-Linux integration holding an independently signed emitted-host request
  at that replay query, delivering `SIGTERM`, then proving exact HTTP and stored-state settlement,
  silent code-0 exit, database-session release, and unchanged link-free runtime contents; and
- exact lockfile, registry metadata, direct notice, inventory, license, script, and online advisory
  review for Fastify 5.10.0.

The configured 33-second handler limit is bound to executable policy and generic 503 handling; the
controlled four-plus-one contention scenario does not claim representative load or a wall-clock
production capacity result. No test proves Cloudflare signing, direct-origin denial, trusted
deployment routing, a real protected key, TLS termination, a working deployment Ingest
login/certificate, distributed rate limits, monitoring, connector behavior, real-user
synchronization, or production capacity.

## References

- [Fastify 5.10.0 release](https://github.com/fastify/fastify/releases/tag/v5.10.0)
- [Fastify security policy](https://github.com/fastify/fastify/security/policy)
- [Community sync application composition](0019-bounded-community-sync-application-composition.md)
- [Bounded Railway Ingest host](0033-bounded-railway-ingest-host.md)
- [Community sync verification kernel](0015-bounded-community-sync-verification-kernel.md)
- [Bounded Ingest PostgreSQL adapter](0016-bounded-ingest-postgresql-adapter.md)
- [Persistent origin replay store](0018-persistent-ingest-origin-replay-store.md)
- [Public protocol contracts](../../contracts/README.md)
- [Dependency policy](../security/DEPENDENCY_POLICY.md)
- [Ingest workspace](../../apps/ingest/README.md)
- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [System context](../architecture/SYSTEM_CONTEXT.md)
- [Data flow](../architecture/DATA_FLOW.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
