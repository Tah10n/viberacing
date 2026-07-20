# Jobs scheduler workspace guidance

Read the root `AGENTS.md`, `apps/jobs/AGENTS.md`, this directory's `README.md`, ADR 0063, the
security invariants, abuse cases, threat model, privacy data map, and current implementation status
before changing this workspace.

## Non-negotiable boundaries

- This workspace owns only the default-off UTC schedule, sequential invocation, and bounded process
  lifecycle. It consumes `@viberacing/jobs`; it must not import PostgreSQL, filesystem, network,
  subprocess, migration, Web, Ingest, Admin, or interactive-auth capabilities.
- Require exact `VIBERACING_JOBS_SCHEDULER_ENABLED=true` before creating the Jobs runner or reading
  its database configuration. Missing, false, malformed, or tracked example state remains disabled.
- The schedule is a code-reviewed closed catalog. Do not accept command names, dates, batch sizes,
  intervals, time zones, retry counts, or concurrency from arguments, environment, files, or network
  input.
- Run due capabilities sequentially through one Jobs runner. Never overlap cycles, start the next
  capability after shutdown begins, or retry within a schedule slot. Database procedures remain the
  authority for time, eligibility, serialization, and idempotency.
- Keep schedule state in process memory only. Do not add run history, queue rows, identifiers,
  counts, dates, errors, SQL, environment values, metrics, traces, or an external monitoring sink
  without a separate privacy and operations decision.
- The first SIGINT/SIGTERM waits only for the current bounded Jobs call and runner close under the
  fixed deadline. A second signal, deadline, or close failure exits unsuccessfully.
- A local scheduler is not evidence of a deployed replica count, production login/TLS, durable
  cadence, monitoring, alert ownership, capacity, backup purge, restore replay, or real-user
  retention.

## Required checks

Run from the repository root:

```text
pnpm run lint:jobs-scheduler
pnpm run typecheck:jobs-scheduler
pnpm run test:jobs-scheduler:coverage
pnpm run build:jobs
pnpm run build:jobs-scheduler
pnpm run check:jobs-scheduler-entrypoint
pnpm run test:jobs-scheduler:postgres-integration
pnpm run test:jobs-scheduler:timer-postgres-integration
pnpm run test:jobs-scheduler:lifecycle-postgres-integration
pnpm run test:jobs-scheduler:process-postgres-integration
pnpm run test:jobs-scheduler:wall-clock-postgres-integration
pnpm run test:jobs-scheduler:signal-postgres-integration
pnpm run verify
```

The PostgreSQL commands are opt-in synthetic acceptance gates. The first composes the production
scheduler core with a fixed injected UTC clock/timer, the real Jobs runner, and one disposable
database. The second advances the injected clock by one hour, invokes the production interval
handler twice during the active real-runner cycle, proves the exact recurring catalog plus overlap
and same-slot suppression, and verifies the rearmed terminal reset. The third composes the
production process lifecycle, starts the penultimate real-runner call before injecting its first
handler, proves that call settles without starting the later job, and requires graceful cleanup and
code 0. The fourth starts the built entry point from a link-free read-only production graph under
pinned Linux Node with the real clock, waits for the terminal startup-catalog marker without output,
delivers a real `SIGTERM`, and proves silent code-0 exit, session release, and runtime immutability.
The timer result is not host-timer delivery and the lifecycle result is not OS-signal delivery. The
fifth uses the same bounded runtime shape, leaves the native clock/timer unchanged, holds the
scoring mutex only after startup, observes refresh in a later real five-minute slot, delivers a real
`SIGTERM`, releases the mutex, and proves active-refresh settlement, silent code-0 exit, session
release, and runtime immutability. The sixth uses the same bounded runtime shape, blocks the emitted
first finalization call, delivers a real `SIGTERM`, and proves graceful settlement without starting
refresh or any later job. The fourth is local post-startup OS-signal evidence, the fifth is local
host-timer plus OS-signal evidence, and the sixth is a third local OS-signal path. None proves a
deployed controller or orchestrator grace policy, a deployed signal route, restart, durable/deployed
cadence, production credential/TLS, monitoring, capacity, or real-user behavior.

Before committing, inspect the exact staged diff and run `git diff --cached --check` plus
`pnpm run check:public:staged`.
