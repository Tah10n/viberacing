# Vibe Racing Jobs

This private workspace is the one-shot application boundary for the clean-bootstrap maintenance
catalog. It can invoke exactly thirteen reviewed PostgreSQL capabilities:

1. ensure the current UTC Community season;
2. refresh at most one due dirty Community leaderboard;
3. finalize at most one due Community season;
4. delete a bounded batch of expired ranking/audit events;
5. delete bounded expired origin and device nonces;
6. redact expired observation provenance while preserving accepted cumulative totals, then delete
   bounded expired observation and idempotency evidence;
7. delete bounded expired pairing batches plus their unbound provisional installations and
   AgentAccounts;
8. delete bounded expired authentication challenges, sessions, invites, and used recovery codes;
9. redact aged pairing approval provenance and delete bounded unreferenced revoked passkeys,
   devices, and installations;
10. delete bounded abandoned or superseded non-final snapshot revisions while retaining every
    published pointer and finalized snapshot;
11. purge at most ten deletion-pending profiles only after no current mutable public snapshot
    contains their handle;
12. delete bounded terminal deletion-job evidence after its fixed 30-day retention; and
13. reset expired positive pairing-admission windows while preserving the exact 130-row inventory.

PostgreSQL owns clocks, season selection, eligibility, deterministic ordering, row bounds,
maintenance mutexes, retry state, snapshot publication, deletion state, and transactionality. The
runner accepts no date, SQL, identifier, provider, trust tier, retry count, or caller-selected batch
size. It returns no private row, date, identifier, or affected count to the CLI.

This package is not a scheduler, external audit sink, monitor, correction system, backup/cache
purger, deployed service, or production-capacity result. The separate default-off
`@viberacing/jobs-scheduler` package can invoke only the same exported runner.

## Security boundary

The pool ceiling is one. Before every capability the runner proves:

- the effective role is exactly `viberacing_jobs`;
- the distinct login can set only that reviewed group role;
- the login has no superuser, owner, create-database, create-role, replication, bypass-RLS, database
  CREATE, or TEMPORARY authority;
- the search path is exactly `pg_catalog,pg_temp`; and
- the session is read-write.

It then executes one fixed parameterized function, validates one closed result row, destroys a
failed client, and closes the pool. Only these environment names are read:

```text
NODE_ENV
VIBERACING_JOBS_DATABASE_HOST
VIBERACING_JOBS_DATABASE_PORT
VIBERACING_JOBS_DATABASE_NAME
VIBERACING_JOBS_DATABASE_USER
VIBERACING_JOBS_DATABASE_PASSWORD
VIBERACING_JOBS_DATABASE_TLS_MODE
```

TLS is `verify-full`, except explicit test/development loopback may select `disable`. Configuration
objects hide the password from enumeration and JSON serialization. No credential, certificate, or
enable value is tracked.

## Build and invoke

From the repository root:

```text
pnpm run build:jobs
pnpm run test:jobs:postgres-integration
pnpm --filter @viberacing/jobs start -- ensure-current-season
pnpm --filter @viberacing/jobs start -- refresh-dirty-leaderboard
pnpm --filter @viberacing/jobs start -- finalize-due-season
pnpm --filter @viberacing/jobs start -- cleanup-expired-audit-events
pnpm --filter @viberacing/jobs start -- cleanup-expired-usage-nonces
pnpm --filter @viberacing/jobs start -- cleanup-expired-usage-history
pnpm --filter @viberacing/jobs start -- cleanup-expired-pairing-state
pnpm --filter @viberacing/jobs start -- cleanup-expired-auth-state
pnpm --filter @viberacing/jobs start -- cleanup-aged-revoked-authority
pnpm --filter @viberacing/jobs start -- cleanup-snapshot-history
pnpm --filter @viberacing/jobs start -- purge-profile-deletions
pnpm --filter @viberacing/jobs start -- cleanup-terminal-deletion-jobs
pnpm --filter @viberacing/jobs start -- reset-expired-pairing-request-windows
```

A valid command prints only `Vibe Racing Jobs command completed.`. Every failure prints only
`Vibe Racing Jobs command failed.` and returns nonzero. Neither path prints command input, results,
configuration, SQL, exceptions, or protected values.

The Docker-backed command integration applies the seven-revision checksum-validated clean bootstrap,
creates one narrow login and one deliberately widened negative control, fingerprints every private
table around the denial, runs all thirteen built commands as separate processes, verifies exact
generic output, current-season creation, admission-window mutation, connection cleanup, and removes
the disposable database. The database integration separately exercises every retention and deletion
mutation, including observation-provenance redaction followed by a higher cumulative sync and
fresh-passkey profile deletion before purge.

These are local synthetic results. They do not prove production credentials or TLS, deployed
cadence, orchestration, monitoring, capacity, real-user retention, committed external-side-effect
recovery, backup/cache purge, or deployment.
