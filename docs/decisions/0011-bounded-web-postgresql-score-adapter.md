# ADR 0011: Bounded Web PostgreSQL score adapter

- Status: Accepted (adapter and local route implemented; cache/deployment pending)
- Date: 2026-07-15
- Decision owners: Web, Database, Security, Privacy, and Operations
- Supersedes: None
- Superseded by: None

## Context

Revision 0011 and ADR 0010 provide a Web-only score function, a closed top-32 response, and a
fail-closed mapper, but they previously stopped before a PostgreSQL client. A real application read
must not reuse the compose bootstrap owner, concatenate a season into SQL, let the driver convert
calendar labels through local time, trust pooled session state, wait without deadlines, or reflect a
driver error containing a host, login, query, or credential.

The deployment login remains infrastructure-owned because the repository cannot publish or invent a
real credential. It must nevertheless have an executable application contract: one dedicated
principal, one runtime group, certificate-verified transport outside loopback development, and a
fixed procedure call whose result still crosses the mapper boundary as unknown data.

## Decision

Use the exact pinned `pg` 8.22.0 client and its bounded pool in the server-only Web workspace. The
package, its transitive graph, declared licenses, integrity metadata, maintenance state, optional
native peer, and absence of install scripts were reviewed. Exact versions, the installed graph,
licenses, and integrity metadata are recorded by the existing deterministic dependency gates; the
remaining observations are review-time evidence. No ORM or general query builder is added because
this slice has one fixed procedure call and must not grow application-selected table access.

The adapter consumes only six namespaced settings:

- `VIBERACING_WEB_DATABASE_HOST`, `PORT`, `NAME`, `USER`, and `PASSWORD`; and
- `VIBERACING_WEB_DATABASE_TLS_MODE`, which is exactly `disable` or `verify-full`.

These settings are separate from the `DATABASE_*` compose bootstrap owner. The tracked Web login and
password remain non-working placeholders. Cleartext requires explicit `NODE_ENV=development` or
`test` and one of `localhost`, `127.0.0.1`, or `::1`. Every other environment requires
`verify-full`, a bounded multi-label DNS hostname, normal certificate and hostname verification, and
TLS 1.2 or later. IP-based TLS, connection strings, `prefer`, `rejectUnauthorized: false`, and
tracked custom certificate material are unsupported.

The pool is fixed at zero to four connections. Checkout/connect wait is two seconds, each PostgreSQL
statement has a five-second server deadline, each client query has a six-second deadline, lock wait
is one second, and an idle transaction is terminated after five seconds. Idle clients expire after
ten seconds, 1,000 uses, or five minutes. TCP keep-alive is enabled. The config object is frozen,
its password is non-enumerable, and JSON serialization returns only a redaction marker; application
code still must never deliberately read and log the password.

Every connection starts with `SET ROLE` semantics for `viberacing_web`, a `pg_catalog,pg_temp`
search path, UTF-8, and read-only transactions. Before every score query, not merely the first use
of a pooled client, one fixed probe requires all of the following:

- effective `CURRENT_USER` is exactly `viberacing_web`;
- the distinct deployment login can log in, has none of PostgreSQL's broad role attributes, has
  database `CONNECT` but neither `CREATE` nor `TEMPORARY`, and is a member of no role other than
  `viberacing_web`;
- search path is exactly the startup value; and
- `default_transaction_read_only` remains on.

A malformed or false probe destroys that checked-out client. This also rejects the local compose
owner even if that superuser can switch to the Web group. Pool idle errors reach an optional
monitoring hook as only `idle_client_error`; the driver exception is not forwarded, and a failing
hook cannot crash the process.

The store accepts an unknown season value and permits only a real canonical ISO Monday from
`1999-12-27` through `2099-12-28`. It executes one fixed parameterized call to
`viberacing_api.list_public_community_scores($1::date, $2::integer)` with the schema-derived
limit 32. The outer query names exactly the ten reviewed columns, casts both PostgreSQL `date`
values to text, and orders by display position. No caller controls SQL, limit, sort, filter, cursor,
table, or field.

After a successful query, the client is released before the unknown rows reach the existing mapper.
Role or query failure destroys the client; release/close failure, unavailable connection, invalid
season, runtime-boundary drift, query failure, and rejected projection each become a bounded code
behind the same generic message. No driver exception, input value, SQL text, environment value,
projected row, or unexpected field name is attached as a cause. The configured store exposes
explicit sanitized `close()` and does not create a connection until a read is attempted.

This is a database adapter only. It does not add a Next.js route, OpenAPI path, public cache,
request metadata, session behavior, rate limit, edge proof, route-wide deadline, load evidence,
monitoring backend, deployment login, TLS certificate, or live database configuration. The visible
Phase 1 page continues to use synthetic fixtures.

## Security and privacy consequences

The fixed query and parameters remove SQL-text selection from the request boundary. The per-checkout
probe and dedicated pool preserve VR-DATA-001 even if a login, membership, startup option, or pooled
session drifts. Conservative pool and query ceilings limit one process, but ranking still evaluates
all visible entries and a future public route still needs request concurrency, backpressure, cache,
rate, and capacity policy.

The adapter reads only fields already classified Public and creates no cache, log field, analytics,
browser state, or retained copy. A password exists only in server process configuration and driver
state; tracked examples remain placeholders. Public handles and scores remain observable and
archivable once a route is intentionally enabled, and hide/delete still requires immediate cache
invalidation in that future layer.

Affected invariants are VR-PUBLIC-001, VR-TRUST-001, VR-ABUSE-001, VR-DATA-001, and VR-DELETE-001.
Primary attacker stories are VR-ABUSE-DATABASE-ROLE, VR-ABUSE-RESOURCE-EXHAUSTION,
VR-ABUSE-PUBLIC-SCRAPE, VR-ABUSE-DELETE-RESURRECTION, and VR-ABUSE-DEPENDENCY-PR.

## Alternatives considered

- **Reuse `viberacing_local`:** rejected because it is the disposable compose bootstrap owner and
  defeats runtime least privilege even if the session later changes role.
- **Use a connection string:** rejected because credentials and transport flags become easier to
  log, parse ambiguously, or override. The adapter passes bounded fields separately.
- **Call `pool.query` directly:** rejected because explicit checkout is required to probe the exact
  session immediately before the procedure and to destroy a failed client deliberately.
- **Probe each physical connection only once:** rejected because later session drift or accidental
  pool sharing would remain trusted.
- **Let `pg` parse dates:** rejected because its default date conversion enters JavaScript date/time
  semantics; explicit SQL text casts preserve canonical calendar labels.
- **Add an ORM or generic repository:** rejected because it adds dependency and query surface
  without a second approved use case.
- **Permit opportunistic or certificate-disabled TLS:** rejected because production database
  identity must fail closed. Custom private CA support can be designed when deployment requirements
  and secret delivery exist.

## Migration and rollback

There is no database migration, route, or persisted-state change. Rollback removes the adapter,
driver declarations and reviewed dependency metadata, namespaced example settings, tests, and this
ADR together. A caller can disable the capability by not constructing the configured store; no
fallback may use the compose owner, direct tables, synthetic response, or weaker TLS.

After an HTTP consumer exists, rollback must disable that route with bounded public failure behavior
and purge any separately reviewed cache. It must not keep serving stale score rows or widen the
response while the database adapter is unavailable.

## Verification

Current repository evidence covers:

- exact required environment names, bounded host/port/identifier/password values, both supported TLS
  modes, missing/unknown/production environment and non-loopback cleartext denial, IP/single-label
  verify-full denial, frozen settings, and non-reflective unreadable-environment failures;
- a checker that locks the tracked bootstrap and non-working Web credential examples apart;
- the narrow driver wrapper, copied parameter arrays, normal/destructive release, sanitized explicit
  close, stable idle-client signal, and monitoring-hook containment;
- valid and invalid season boundaries before checkout;
- the fixed role/login-membership/database-capability/search-path/read-only probe on every checkout;
- exact parameterized function name, schema-derived limit 32, date-to-text casts, deterministic
  outer ordering, and successful canonical mapping;
- malformed, extra, missing, inherited, accessor-backed, and false boundary results; connection,
  query, release, and projection failures; client destruction versus healthy release; and no
  reflected private failure value; and
- exact dependency versions, lock integrity, license inventory/notices, registry metadata, and a
  zero-known-vulnerability audit at review time.

There is no integration test through a real deployment-style login, certificate, network, or
PostgreSQL connection because the repository intentionally supplies none. The existing PostgreSQL
integration separately proves the function, output, deadlines, grants, and negative role matrix.
HTTP, cache, load, deployment, and end-to-end hide/purge evidence remain open.

## References

- [Public Community score projection](0009-public-community-score-projection.md)
- [Community score response contract](0010-community-score-response-contract.md)
- [Service and database isolation](0004-edge-service-and-database-isolation.md)
- [Database capability boundary](../../database/README.md)
- [Web workspace](../../apps/web/README.md)
- [Dependency policy](../security/DEPENDENCY_POLICY.md)
- [Dependency inventory](../reference/dependency-inventory.json)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
