# Vibe Racing Jobs scheduler

This private workspace is a default-off local scheduling shell around the reviewed
`@viberacing/jobs` runner. It contains no PostgreSQL query or database dependency of its own.

When exact `VIBERACING_JOBS_SCHEDULER_ENABLED=true` is present, the process evaluates one fixed UTC
catalog once at startup and then every minute. It:

- refreshes the current Monday-based Community season at most once per five-minute process slot;
- finalizes the latest season whose Wednesday grace boundary has elapsed at most once per UTC day;
- advances at most one oldest data-backed historical season per UTC hour without accepting a date;
- invokes every bounded cleanup, redaction, reset, and primary-deletion capability at most once per
  UTC hour.

The scheduler marks a slot before invocation, runs due jobs sequentially, never overlaps cycles, and
does not retry a failed job in the same slot. A process restart may repeat an idempotent current
slot. PostgreSQL still derives time-sensitive eligibility, lock order, batch limits, grace closure,
and terminal state; the scheduler supplies no authority beyond the existing closed Jobs objects.

## Security boundary

Only `config.ts` reads the scheduler enable value. The Jobs runner reads its existing database
configuration only after the exact enable latch succeeds. No command, season, batch, interval, time
zone, retry count, or concurrency value is accepted from process arguments, environment, files, or a
network source.

One runner and its one-client pool serve the process. A failed job does not start an immediate retry
and does not prevent later due jobs in the same fixed cycle; the optional signal contains only the
closed value `cycle_failed`. No result count, command, date, identifier, SQL, configuration, error,
or stack is emitted or retained. On shutdown, no later job starts, and the process waits only for
the current call under a fixed deadline.

## Build and invoke

From the repository root:

```text
pnpm run build:jobs
pnpm run build:jobs-scheduler
$env:VIBERACING_JOBS_SCHEDULER_ENABLED='true'
pnpm --filter @viberacing/jobs-scheduler start
```

The example is incomplete by design: the separate Jobs database environment must still be supplied
through protected deployment configuration. The tracked repository contains no working credential,
certificate, scheduler enable value, deployment manifest, or hosted schedule.

Unit tests use a fake clock, timer, and runner to prove UTC dates, fixed cadence, dependency order,
non-overlap, failure containment, shutdown, and default-off ordering. The built-entrypoint gate
proves disabled startup exits silently before Jobs configuration. The existing Jobs PostgreSQL
integration separately proves all eighteen emitted CLI commands. The opt-in
`pnpm run test:jobs-scheduler:postgres-integration` gate additionally composes the production
scheduler core with a fixed injected UTC clock/timer, the real Jobs runner, and one disposable
PostgreSQL database. It proves the exact ordered catalog, full private-table non-mutation for a
deliberately widened login, and exact stored state for the narrow login. It does not execute the
emitted scheduler process. The separate opt-in
`pnpm run test:jobs-scheduler:timer-postgres-integration` gate advances the injected clock by one
UTC hour, invokes the production interval handler twice during the active real-runner cycle, proves
the exact recurring catalog plus overlap and same-slot suppression, and verifies the rearmed
terminal reset. It does not prove host-timer delivery or an emitted recurring callback. The separate
opt-in `pnpm run test:jobs-scheduler:lifecycle-postgres-integration` gate injects the production
first-signal handler during the penultimate database job, requires that active call to settle,
proves the later scheduler reset does not start, and requires exact graceful lifecycle cleanup and
exit code 0. It invokes the omitted reset only afterward before the shared state oracle; it does not
prove OS-signal delivery or emitted-process graceful shutdown. The separate opt-in
`pnpm run test:jobs-scheduler:process-postgres-integration` gate starts the built entry point with
the real clock from a link-free read-only production graph under pinned Linux Node and requires
host/database UTC-date agreement. The harness temporarily revokes only the Jobs role's exact
backlog-function execution grant. The first process emits one generic cycle-failure line, leaves the
backlog unchanged, reaches the later terminal marker, and exits with code 0 after an OS `SIGTERM`.
The harness restores and verifies the grant, rearms the marker, holds the scoring mutex, and starts
the same runtime again. It observes the first finalization lock-wait, delivers `SIGKILL`, requires
exit 137 plus session release, and proves the backlog and marker remain unchanged. After releasing
the holder, a restart finalizes the backlog before a silent code-0 signal exit. One more
rearm/restart proves a silent repeated cycle. All four starts leave no scheduler sessions, the
runtime fingerprint is unchanged, and the exact stored-state oracle passes. This is local
failure/crash containment and restart retry, not partial-write recovery, automatic privilege repair,
a deployed-controller restart, or orchestrator grace policy. The separate opt-in
`pnpm run test:jobs-scheduler:wall-clock-postgres-integration` gate starts the same built process
from the same bounded runtime shape without replacing `Date.now()` or native `setInterval(60_000)`.
After the startup catalog settles, an owner session holds the scoring mutex until the emitted
production refresh is observed in a later real five-minute slot; the harness delivers a real
`SIGTERM`, releases the mutex before the database deadline, and requires the active refresh to
commit before silent code-0 exit, session release, and runtime-fingerprint revalidation. This proves
one local recurring host-timer refresh and graceful signal settlement but not a deployed controller,
orchestrator grace, or durable cadence. The separate opt-in
`pnpm run test:jobs-scheduler:signal-postgres-integration` gate copies only the built scheduler,
built Jobs runner, and exact 14-package installed production graph into a link-free temporary
runtime, mounts it read-only under the pinned Linux Node 24.18 image, and joins only the disposable
PostgreSQL container's network namespace. An owner session holds the first finalization mutex until
the emitted scheduler is observed in an exact database lock wait; the harness then delivers a real
`SIGTERM`, releases the mutex before the database deadline, and requires the finalization call to
settle without starting refresh or any later job. The process must exit silently with code 0,
release its database session, leave the runtime fingerprint unchanged, and pass the shared exact
state oracle after the seventeen omitted one-shot commands run separately. These are local synthetic
Linux OS-signal results. Together the three emitted gates still do not prove partial-write recovery,
a deployed signal route, controller/orchestrator grace policy, managed restart, production
TLS/login, durable cadence, monitoring, capacity, deployment, or real-user retention.
