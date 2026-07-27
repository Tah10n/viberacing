# Vibe Racing migration runner

This private workspace is a default-off one-shot controller for the immutable PostgreSQL migration
catalog. It is separate from Web, Ingest, Jobs, and Admin and receives no runtime application
capability.

The process starts only when `VIBERACING_MIGRATIONS_ENABLED` is the exact string `true`. It accepts
no arguments. After enablement it:

1. reads only the repository-owned migration manifest and exact file inventory;
2. verifies contiguous revisions, canonical paths, bounded UTF-8 source, and every SHA-256 digest;
3. opens one PostgreSQL client through a distinct expected login;
4. proves that the NOINHERIT login has only non-admin, non-inherited `SET` authority over the
   NOLOGIN, NOINHERIT `viberacing_owner` role, which has no outbound membership;
5. acquires the fixed session advisory migration lock;
6. sets the owner role, rereads the exact ledger, applies only the missing reviewed SQL bodies in
   order, and requires the complete ledger;
7. resets the role, releases the lock, and closes the client.

Each migration still supplies its own transaction, local role, transaction advisory lock, lock and
statement timeouts, and exact ledger insert. The runner removes only the first exact psql
`ON_ERROR_STOP` meta-command after checking the original source digest; it does not rewrite SQL.

## Security boundary

The database configuration uses the fixed `VIBERACING_MIGRATIONS_DATABASE_*` namespace. Production
configuration requires `verify-full` TLS and a DNS name; cleartext is admitted only for explicit
development/test loopback. Passwords are bounded, non-enumerable in the in-memory configuration, and
JSON-redacted. A deployment may supply a reviewed CA through the Node trust boundary, but this
repository contains no certificate or credential.

The login probe rejects owner logins, superusers, role/database creators, replication or RLS-bypass
roles, inherited or admin owner authority, extra login or owner memberships, CREATE/TEMPORARY on the
login, wrong search path, read-only sessions, and TLS-state mismatch. The package root exports no
reusable API, and its export map exposes no internal subpath. A failure destroys the client, which
also releases a held session lock. No SQL, revision, path, count, configuration value, driver error,
or stored row reaches process output.

## Build and invoke

From the repository root:

```text
pnpm run build:migrate
pnpm --filter @viberacing/migrate start
```

The example is intentionally disabled and incomplete. The exact enable value, a dedicated login,
password, host, port, database, TLS mode, reviewed trust material, role bootstrap, and deployment
workflow must come from protected configuration and operations review. Do not place real values in a
tracked file or shell transcript intended for publication.

## Staging operator contract

The checked
[staging migration and forward-recovery runbook](../../docs/operations/MIGRATION_RUNBOOK.md) binds
the runner to eighteen ordered operator controls and seven exact repository commands. It requires a
pinned artifact, named private owners, isolated restore evidence, service compatibility, the narrow
verified-TLS login, one-shot enablement, exact post-apply oracles, containment, and forward-only
repair. `pnpm run check:migration-runbook` validates the document against this package's exact start
command, enablement decision, generic success output, and root script inventory;
`pnpm run test:migration-runbook-check` proves thirteen unsafe or drifted variants fail closed.

This public document contains no target, identity, credential, certificate, private threshold, or
incident detail. It is a staging prerequisite, not a successful staging run, production approval,
monitoring, rollback, stale-backup deletion replay, recovery, or deployment evidence.

Unit tests use injected pools and catalogs; they do not connect to PostgreSQL. The built-entrypoint
gate proves disabled startup stops before protected configuration and that enabled-but-incomplete or
argument-bearing startup fails generically.

The separate opt-in `pnpm run test:migrate:postgres-integration` gate builds the emitted entry point
and creates one disposable TLS-enabled PostgreSQL container with an ephemeral loopback port and
synthetic narrow and deliberately widened logins. It requires the widened emitted process to fail
generically before application-schema creation, then observes two narrow emitted processes waiting
behind one external holder of the fixed advisory key. After release, both processes must emit the
exact generic success, the ledger must equal all 43 reviewed revisions, all 28 private tables must
remain owner-owned with forced RLS, the identity invariant oracle must pass, and every controller
connection and lock must be gone. The gate removes its generated certificate/key, container,
network, and storage and never touches the normal local database volume.

This is synthetic local PostgreSQL, driver, hostname-verified TLS, and concurrent-controller
evidence only. It does not provide a production credential or certificate, deployed replica, staging
migration/rollback, service-compatibility result, monitoring, capacity, deployment, or recovery
evidence.
