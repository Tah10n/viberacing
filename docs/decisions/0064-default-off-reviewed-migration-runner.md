# ADR 0064: Default-off reviewed migration runner

- Status: Accepted (local PostgreSQL/TLS integration; deployment evidence pending)
- Date: 2026-07-20
- Decision owners: Database, Security, Privacy, Operations, and Release
- Supersedes: None
- Superseded by: None

## Context

Every immutable SQL migration uses one transaction, bounded local lock and statement timeouts, the
fixed transaction advisory lock, `SET LOCAL ROLE viberacing_owner`, and one exact ledger insert. The
static checker validates the catalog and migration shape. The disposable database gate now runs two
exact copies of revision 0039 behind that lock and proves one complete application plus one atomic
duplicate-object rollback.

That behavior is safe against partial DDL but is not migration orchestration: two raw deployment
processes do not both succeed. The second process has no controller-level opportunity to acquire the
catalog lock, reread the ledger, and decide that another process already completed the revision. The
repository also has no executable boundary separating temporary migration authority from runtime
services.

This crosses TB-09 and TB-11. A path or manifest injection could execute arbitrary SQL with schema
owner authority. A widened login could turn a migration process into cluster or unrelated service
authority. A leaked database error, path, configuration value, or SQL fragment could expose
operational details. An unbounded controller wait or parallel application could deadlock deployment
and leave operators uncertain about canonical state.

## Decision

Add a private `@viberacing/migrate` workspace as a default-off, argument-free, one-shot process. It
is not imported by Web, Ingest, Jobs, Admin, or their schedulers. Only `database-pool.ts` may import
the PostgreSQL driver. The package root exports no reusable capability, and its package export map
exposes no internal subpath.

Startup is admitted only when `VIBERACING_MIGRATIONS_ENABLED` is the exact string `true`. This value
is resolved before reading the catalog, any `VIBERACING_MIGRATIONS_DATABASE_*` value, or
constructing a pool. Missing, false, malformed, and getter-failing values stop with one generic
disabled result. No alternate truthy parser, command, request, file, or runtime toggle can enable
the process.

The catalog loader derives one fixed path from the built module to `database/migrations`. It accepts
no path input from arguments or environment. It rejects non-files, symbolic links, unknown entries,
open JSON shapes, non-contiguous revisions, non-canonical names/paths, duplicate inventory, invalid
UTF-8, files over 512 KiB, and SHA-256 mismatch. The original public bytes must match the manifest
before the loader removes only the exact first `\set ON_ERROR_STOP on` psql preamble. The remaining
database statements are not generated or repaired.

Configuration creates one maximum-one pool with one-use clients, fixed application name, UTF-8, safe
search path, connection/lock/query/statement/idle-transaction deadlines, and bounded password.
Production accepts only certificate-verifying TLS to a DNS name; the synthetic gate uses a generated
certificate for its fixed local DNS hostname. Cleartext is allowed only on explicit development/test
loopback. Protected password material is non-enumerable and JSON-redacted; process output never
reflects it.

Before taking the lock, the session must prove all of the following in one closed row:

- `CURRENT_USER` and `SESSION_USER` equal the configured distinct login;
- the NOINHERIT login has exactly one non-admin, non-inherited `SET` membership in the NOLOGIN,
  NOINHERIT `viberacing_owner` group and has no unrelated membership;
- the login is not superuser, database/role creator, replication, or RLS-bypass authority;
- the login has CONNECT but not direct CREATE or TEMPORARY on the database;
- the owner group remains NOLOGIN and non-privileged at cluster level, with no outbound membership;
- search path is exactly `pg_catalog,pg_temp`, the session is read-write, and observed TLS state
  matches configuration.

The runner then acquires the fixed migration key as one session advisory lock. Only that client may
set the owner role and inspect the forced-RLS ledger. The ledger must be an exact contiguous prefix
of the reviewed catalog. The runner submits only remaining reviewed SQL bodies sequentially, rereads
the ledger, and requires the complete exact catalog. It resets the role before releasing the session
lock. On any query, result-shape, migration, reset, unlock, or close failure it emits no detail and
destroys the client; connection teardown releases any remaining session lock and rolls back an open
transaction.

Successful output is one fixed sentence with no revision or count. Disabled and failed output are
separate fixed sentences. There is no retry, repair, down migration, bootstrap role mutation,
parallel application, dynamic SQL source, migration history rewrite, run ledger, metric, trace,
health route, listener, or monitoring backend.

## Security and privacy consequences

The process has intentionally powerful but short-lived schema authority. Its fixed catalog and
exact-digest boundary prevent configuration or caller input from becoming SQL. The login probe keeps
migration authority distinct from runtime roles and rejects a widened principal before owner role
selection. One session lock plus a post-lock ledger read lets concurrent controllers converge
without making immutable migrations idempotent or weakening their transactions.

This does not protect a host that can replace both code and manifest, compromise the protected
migration credential, alter the trusted CA store, or administer PostgreSQL. Artifact provenance,
secret delivery, operator authorization, replica rollout, monitoring, and incident response remain
deployment controls. A 60-second controller lock deadline and 120-second client query deadline are
local safety bounds, not measured production SLOs; individual migrations retain their stricter
server-side limits.

No product, account, identity, usage, credential value, or stored row is newly collected. Catalog
names, revisions, paths, SQL, digests, and process application name are public repository or
Operational control data. The password is transient Security configuration. The process retains no
run history and emits only one aggregate sentence. A deployment log, metric, operator identity,
timestamp, migration name/count, database error, or audit record would be a new Operational/Security
collection and requires a privacy-map decision before collection.

The opt-in synthetic integration now proves that PostgreSQL accepts the driver-submitted
multi-statement bodies, the closed probe admits one real narrow role and rejects a deliberately
widened role before schema creation, and the session lock composes with every migration's
transaction lock. It observes two emitted narrow controllers behind one external holder, then
requires both to succeed and converge on the exact 42-row ledger, 28 owner-owned forced-RLS tables,
and the identity invariant oracle over hostname-verified TLS. This remains local disposable
evidence, not successful staging migration orchestration/rollback, a production credential,
deployed-replica behavior, monitoring, capacity, deployment, or recovery.

## Alternatives considered

- **Continue invoking raw psql files concurrently:** rejected because the losing process exits on an
  expected duplicate object and cannot distinguish canonical completion from a failed rollout.
- **Make every immutable migration idempotent:** rejected because broad `IF NOT EXISTS` and
  exception swallowing can conceal partial or drifted state, while rewriting reviewed migrations
  breaks the ledger contract.
- **Put migration commands in Jobs:** rejected because Jobs is a runtime non-owner role with exactly
  eighteen prepared maintenance capabilities; adding schema authority would violate VR-DATA-001.
- **Accept a catalog path, SQL, revision, or repair command:** rejected because deployment input
  must not become owner-authorized filesystem or query selection.
- **Use only each migration's transaction advisory lock:** retained as defense in depth but
  insufficient for a successful second controller, which must reread the ledger after serialization.
- **Add automatic retries or down migrations:** rejected because an unknown DDL failure needs
  operator review and forward repair; repeated owner-authorized SQL or destructive generic rollback
  would widen impact.
- **Claim deployment readiness from local tests:** rejected because the synthetic gate observes
  driver protocol, PostgreSQL role/TLS behavior, overlap, and stored state, but not protected
  production configuration or an operational rollout.

## Migration and rollback

There is no database, public protocol, or product-data migration in this slice. The workspace graph
and lockfile gain one internal importer using the already reviewed exact `pg` version. Runtime
services receive no dependency or grant.

Rollback is to leave the exact enable value absent or non-`true`, then remove the workspace, root
scripts, verifier wiring, ADR, and documentation in a reviewed change. Existing psql migration files
and the static/disposable database gates remain unchanged. Once this runner applies a future
migration in a shared environment, database rollback remains forward-only under the existing policy;
removing the runner must never rewrite a ledger row or introduce a destructive down script.

## Verification

Current local evidence includes:

- 97 unit and lint-policy tests covering exact enable ordering, argument denial, redacted config,
  loopback/TLS policy, catalog paths/digests/UTF-8/bounds, boundary/result shapes, prefix/complete
  ledger rules, migration failure, client destruction, cleanup failure precedence, generic output,
  and every static/dynamic/exported/legacy PostgreSQL import escape outside the adapter;
- 99.34% statements, 98.59% branches, 100% functions, and 99.34% lines under the checked thresholds;
- strict TypeScript, production compilation, and a built-entrypoint check for disabled,
  enabled-without-protected-configuration, and argument-bearing startup;
- one opt-in disposable PostgreSQL integration that builds the emitted entry point, proves a
  widened-login denial before schema creation, observes two narrow controllers behind an external
  lock holder over hostname-verified TLS, requires both generic-success exits, verifies the exact
  42-row ledger, all 28 owner-owned forced-RLS tables, the identity invariant oracle, and complete
  connection/lock cleanup;
- root verifier wiring, frozen lockfile supply-chain policy, and the existing immutable migration
  checker; and
- a checked staging migration and forward-recovery runbook whose eighteen ordered controls and seven
  commands are bound to the runner's package scripts, exact enablement, generic success output, and
  forward-only policy, with thirteen unsafe or drifted regression variants.

The next independent operational gate must run the reviewed controller through protected
environment-owned credentials and trust material in isolated staging, coordinate the intended
replica topology, prove service compatibility and forward rollback, and exercise monitoring plus
recovery. The local disposable result does not prove any of those properties.

## References

- [Database migration workflow](../../database/README.md#migration-workflow)
- [Staging migration and forward-recovery runbook](../operations/MIGRATION_RUNBOOK.md)
- [Cloudflare and database capability isolation](0004-edge-service-and-database-isolation.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
