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
integration separately proves all eighteen emitted CLI commands. The six opt-in PostgreSQL gates
(`postgres-integration`, `timer-postgres-integration`, `lifecycle-postgres-integration`,
`process-postgres-integration`, `wall-clock-postgres-integration`, `signal-postgres-integration`)
compose the production scheduler core with the real Jobs runner and disposable PostgreSQL under
fixed and real clocks. Together they prove the exact ordered catalog, widened-login non-mutation,
recurring execution with overlap suppression, graceful lifecycle and OS-signal settlement,
failure/crash containment with clean-schema retry, one controlled uncommitted post-insert
transaction rollback, and one local host-timer recurring refresh. They are local synthetic results:
they do not prove recovery from committed/external effects, a deployed signal route,
controller/orchestrator grace policy, managed restart, production TLS/login, durable cadence,
monitoring, capacity, deployment, or real-user retention. Full evidence is in
[IMPLEMENTATION_STATUS.md](../../docs/IMPLEMENTATION_STATUS.md) and
[ADR 0063](../../docs/decisions/0063-default-off-local-jobs-scheduler.md).
