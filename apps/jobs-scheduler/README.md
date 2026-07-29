# Vibe Racing Jobs scheduler

This private workspace is a default-off scheduling shell around `@viberacing/jobs`. It contains no
PostgreSQL driver, query, filesystem, network, subprocess, worker, or durable-state authority.

Only exact `VIBERACING_JOBS_SCHEDULER_ENABLED=true` admits startup. The enable decision happens
before Jobs configuration or pool construction. No process argument, command, date, time zone,
interval, batch size, concurrency value, or retry count is configurable.

The fixed in-memory cadence is:

- once at startup and once per UTC-hour process slot: all thirteen Jobs capabilities in dependency
  order;
- once per minute process slot: refresh at most one due dirty leaderboard; and
- once per five-minute process slot: refresh at most one due dirty leaderboard, then finalize at
  most one due season.

PostgreSQL derives the current, dirty, and due seasons. The scheduler never supplies a date. A
backward, fractional, non-finite, or out-of-range clock fails closed.

The hourly order refreshes public state before profile purge, removes aged ranking references before
usage evidence, expires pairing before auth and authority cleanup, preserves snapshot history before
purge, retains terminal deletion evidence after purge, and resets rate windows last. Jobs run
sequentially through one runner; a timer firing during a cycle is ignored. A failed job emits only
the closed signal `cycle_failed`, starts no immediate retry, and does not prevent later fixed jobs
in the same cycle.

On the first `SIGINT` or `SIGTERM`, the interval is cleared, no later job starts, the active call
settles under existing database deadlines, and the runner closes. A second signal, shutdown
deadline, or close failure forces an unsuccessful exit.

## Build and invoke

```text
pnpm run build:jobs
pnpm run build:jobs-scheduler
$env:VIBERACING_JOBS_SCHEDULER_ENABLED='true'
pnpm --filter @viberacing/jobs-scheduler start
```

The example intentionally omits protected Jobs database configuration. This repository contains no
working credential, certificate, tracked enable value, hosted timer, or deployed scheduler.

Unit tests cover the closed catalog, cadence, hostile inputs, non-overlap, failure containment, and
shutdown at 100% statement, branch, function, and line coverage. Six opt-in PostgreSQL modes compose
the production scheduler core with the real runner and clean bootstrap:

- fixed-clock widened/narrow catalog;
- two recurring hourly catalogs through the registered timer handler;
- injected process lifecycle;
- a read-only link-free Linux Node production entry point;
- an OS `SIGTERM` delivered while its PostgreSQL call is blocked, followed by bounded drain; and
- one native 60-second timer refresh that publishes a due dirty snapshot.

The process modes validate the exact production dependency inventory, silent success, code-zero
graceful exit, database-session release, and immutable runtime fingerprint. These are local
synthetic results, not evidence of a deployed signal route, orchestrator grace, durable cadence,
single replica, managed restart, production login/TLS, monitoring, capacity, real-user retention, or
deployment.
