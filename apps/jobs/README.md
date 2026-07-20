# Vibe Racing Jobs

This private workspace is the local one-shot application boundary for eighteen existing PostgreSQL
maintenance capabilities:

- delete one bounded batch of abandoned `enrolling` profiles only after all exact enrollment-session
  and registration-challenge authority expires and no other profile-bound runtime state exists,
  permanently removing the redeemed invite while retaining redacted audit evidence;
- delete one bounded batch of expired authentication challenges and restricted recovery state;
- delete one bounded batch of database audit events only after 180 days of retention;
- delete one bounded batch of expired unredeemed invites while preserving redeemed provenance;
- delete one bounded batch of expired private CarRecipe proposals while preserving active recipes;
- delete one bounded batch of expired ingest nonces and raw snapshots;
- delete one bounded batch of finalized source/day values only after a terminal season has retained
  its exact rows for 30 days and a smaller rounded freshness projection passes integrity checks;
- delete one bounded batch of expired non-activated pairings and their pending keys;
- delete one bounded batch of passkeys only after 180 days in revoked state and only when no
  session, verifying/authorized challenge, or pairing reference remains;
- delete one bounded batch of minimized activated pairings and their exact revoked device-key rows
  only after 180 days and only when no approval, challenge, nonce, or raw-snapshot reference
  remains;
- reset positive anonymous pairing request windows only after the maximum one-hour duration while
  preserving the fixed 130-row matrix;
- redact the exact approving session/passkey references from one bounded batch of activated pairings
  only after 180 days while preserving their profile/source/device bindings;
- delete one bounded batch of expired sessions that are no longer retained by rotation or pairing
  provenance;
- purge one bounded batch of due deletion-pending profiles and their primary data;
- delete one bounded batch of terminal profile-deletion jobs only after 30 days of retention;
- refresh one open Community season;
- finalize at most one oldest grace-eligible Community season already represented by open or
  retained source/day state, without a caller-selected date; and
- idempotently finalize one Community season after its server-enforced grace deadline.

It is not an external audit sink, scheduler, deployment, monitoring backend, correction system,
cache/backup/tombstone purge system, or production-capacity claim. The separate default-off
`@viberacing/jobs-scheduler` workspace can invoke this same exported runner through a fixed UTC
catalog; it adds no command or database capability. PostgreSQL remains authoritative for server
time, serialization, scoring, grace closure, finalization, deletion state, and row bounds.

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
JSON serialization. The repository contains no production login provisioning, certificate, or
environment value. Its integration harness creates only obviously synthetic logins and passwords
inside one disposable local PostgreSQL container and removes that container and storage afterward.

## Build and invoke

From the repository root:

```text
pnpm run build:jobs
pnpm run test:jobs:postgres-integration
pnpm --filter @viberacing/jobs start -- cleanup-abandoned-enrollments
pnpm --filter @viberacing/jobs start -- cleanup-expired-auth-state
pnpm --filter @viberacing/jobs start -- cleanup-expired-audit-events
pnpm --filter @viberacing/jobs start -- cleanup-expired-car-recipe-proposals
pnpm --filter @viberacing/jobs start -- cleanup-expired-invites
pnpm --filter @viberacing/jobs start -- cleanup-expired-ingest-state
pnpm --filter @viberacing/jobs start -- cleanup-finalized-source-day-values
pnpm --filter @viberacing/jobs start -- cleanup-expired-pairing-state
pnpm --filter @viberacing/jobs start -- cleanup-aged-revoked-passkeys
pnpm --filter @viberacing/jobs start -- cleanup-aged-revoked-devices
pnpm --filter @viberacing/jobs start -- reset-expired-pairing-request-windows
pnpm --filter @viberacing/jobs start -- redact-aged-pairing-approval-provenance
pnpm --filter @viberacing/jobs start -- cleanup-expired-sessions
pnpm --filter @viberacing/jobs start -- purge-profile-deletions
pnpm --filter @viberacing/jobs start -- cleanup-terminal-deletion-jobs
pnpm --filter @viberacing/jobs start -- refresh-community-season 2026-07-13
pnpm --filter @viberacing/jobs start -- finalize-community-backlog
pnpm --filter @viberacing/jobs start -- finalize-community-season 2026-07-06
```

The dates above are synthetic examples. A valid command prints only a stable completion sentence;
all failures print only a stable failure sentence and return a nonzero exit code. Neither path
prints the command input, affected counts, configuration, SQL, or exception detail.

The Docker-backed CLI integration command applies the checksum-validated migration manifest, creates
a least-privileged synthetic Jobs login plus a deliberately widened negative-control login, runs all
eighteen built CLI commands as separate processes, verifies their generic output and exact database
effects, and cleans up its container, network, and storage. The separate opt-in
`pnpm run test:jobs-scheduler:postgres-integration` mode composes the production scheduler core
under a fixed injected UTC clock/timer directly with this real runner and the same disposable
PostgreSQL boundary. It verifies the exact ordered catalog, a full private-table non-mutation
fingerprint for the widened login, and exact narrow-login effects. The timer mode advances the
injected clock by one hour, invokes the production interval handler twice during the active
real-runner cycle, proves the exact recurring catalog plus overlap and same-slot suppression, and
verifies the rearmed terminal reset; it does not prove host-timer delivery. The lifecycle mode
injects the production first-signal handler during the penultimate real database call, proves that
active call settles and no later scheduler job starts, and requires exact graceful lifecycle cleanup
plus code 0. It invokes the omitted reset only afterward for the shared final-state oracle and does
not prove OS-signal delivery. The emitted-process mode starts the built scheduler entry point with
the real host clock, reaches the terminal startup-catalog marker without process output, forcibly
ends only its persistent test child, and then verifies exact state. It does not prove controller
settlement before that forced termination, a wall-clock recurring process callback, or graceful
OS-signal settlement against PostgreSQL. A separate wall-clock process mode starts the same built
entry point without replacing its native clock or minute interval, waits for startup, holds the
scoring mutex, observes the production refresh in a later real five-minute slot, releases it, and
requires the refresh timestamp to advance before forcibly ending the persistent child. It proves one
local recurring host-timer refresh, not durable cadence or controller settlement. A separate
signal-process mode constructs a link-free, production-only runtime from this built runner and its
exact installed `pg` graph, mounts it read-only in the pinned Linux Node image, holds the emitted
first finalization call, and delivers an OS `SIGTERM`. It proves that active call settles, no later
job starts, the process exits silently with code 0, and the database session closes; the seventeen
omitted one-shot commands run only afterward for the shared exact-state oracle. Together these modes
still do not prove an external audit sink, deployed signal path, production TLS/credentials, durable
cadence, monitoring, capacity, real-user retention, or deployment.

The exact-pinned `pg` dependency is the same already reviewed PostgreSQL protocol client used by the
Web adapter. Node.js has no built-in PostgreSQL client, and reusing this package adds no new package
version or transitive dependency family. The lockfile and dependency inventory still record this
workspace as a separate direct consumer.
