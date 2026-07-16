# Vibe Racing Jobs

This private workspace is the local one-shot application boundary for four existing PostgreSQL
maintenance capabilities:

- delete one bounded batch of expired ingest nonces and raw snapshots;
- delete one bounded batch of expired non-activated pairings and their pending keys;
- refresh one open Community season; and
- idempotently finalize one Community season after its server-enforced grace deadline.

It is not a scheduler, deployment, monitoring backend, correction system, deletion worker, or
production-capacity claim. PostgreSQL remains authoritative for server time, serialization, scoring,
grace closure, finalization, and row bounds.

## Security boundary

The runner opens at most one database client and probes that the effective role is exactly
`viberacing_jobs`, the session login is a narrow non-owner login that can set no other group role,
and the search path is `pg_catalog,pg_temp`. It then calls exactly one parameterized
`viberacing_api` function, validates the one-row allowlisted result, destroys the client on failure,
and closes the pool.

Only these environment names are read:

```text
NODE_ENV
VIBERACING_JOBS_DATABASE_HOST
VIBERACING_JOBS_DATABASE_PORT
VIBERACING_JOBS_DATABASE_NAME
VIBERACING_JOBS_DATABASE_USER
VIBERACING_JOBS_DATABASE_PASSWORD
VIBERACING_JOBS_DATABASE_TLS_MODE
```

`VIBERACING_JOBS_DATABASE_TLS_MODE` is either `verify-full`, or `disable` only for an explicit
development/test loopback connection. Configuration objects redact the password from enumeration and
JSON serialization. The repository does not contain login creation, passwords, certificates, or
production environment values.

## Build and invoke

From the repository root:

```text
pnpm run build:jobs
pnpm --filter @viberacing/jobs start -- cleanup-expired-ingest-state
pnpm --filter @viberacing/jobs start -- cleanup-expired-pairing-state
pnpm --filter @viberacing/jobs start -- refresh-community-season 2026-07-13
pnpm --filter @viberacing/jobs start -- finalize-community-season 2026-07-06
```

The dates above are synthetic examples. A valid command prints only a stable completion sentence;
all failures print only a stable failure sentence and return a nonzero exit code. Neither path
prints the command input, affected counts, configuration, SQL, or exception detail.

The exact-pinned `pg` dependency is the same already reviewed PostgreSQL protocol client used by the
Web adapter. Node.js has no built-in PostgreSQL client, and reusing this package adds no new package
version or transitive dependency family. The lockfile and dependency inventory still record this
workspace as a separate direct consumer.
