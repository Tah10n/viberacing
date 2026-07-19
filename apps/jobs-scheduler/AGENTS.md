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
pnpm run verify
```

Before committing, inspect the exact staged diff and run `git diff --cached --check` plus
`pnpm run check:public:staged`.
