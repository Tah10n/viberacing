# Vibe Racing Jobs scheduler

This private workspace is a default-off local scheduling shell around the reviewed
`@viberacing/jobs` runner. It contains no PostgreSQL query or database dependency of its own.

When exact `VIBERACING_JOBS_SCHEDULER_ENABLED=true` is present, the process evaluates one fixed UTC
catalog once at startup and then every minute. It:

- refreshes the current Monday-based Community season at most once per five-minute process slot;
- finalizes the latest season whose Wednesday grace boundary has elapsed at most once per UTC day;
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
integration separately proves all seventeen emitted CLI commands. The opt-in
`pnpm run test:jobs-scheduler:postgres-integration` gate additionally composes the production
scheduler core with a fixed injected UTC clock/timer, the real Jobs runner, and one disposable
PostgreSQL database. It proves the exact ordered catalog, full private-table non-mutation for a
deliberately widened login, and exact stored state for the narrow login. It does not execute the
emitted scheduler process. The separate opt-in
`pnpm run test:jobs-scheduler:lifecycle-postgres-integration` gate injects the production
first-signal handler during the penultimate database job, requires that active call to settle,
proves the later scheduler reset does not start, and requires exact graceful lifecycle cleanup and
exit code 0. It invokes the omitted reset only afterward before the shared state oracle; it does not
prove OS-signal delivery or emitted-process graceful shutdown. The separate opt-in
`pnpm run test:jobs-scheduler:process-postgres-integration` gate starts the built entry point with
the real host clock, requires host/database UTC-date agreement, waits for the terminal catalog
marker without process output, forcibly ends only its otherwise persistent test child, and then
verifies the same exact stored state. It does not prove controller settlement before that forced
termination. None proves a recurring timer callback, OS-signal lifecycle delivery, production
TLS/login, durable cadence, monitoring, capacity, deployment, or real-user retention.
