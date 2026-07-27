# Jobs scheduler workspace guidance

Read the root `AGENTS.md`, `apps/jobs/AGENTS.md`, this directory's `README.md`, ADR 0063, the
security invariants, abuse cases, threat model, privacy data map, and current implementation status
before changing this workspace. Read `docs/operations/PROFILE_DELETION_FAILURE_RUNBOOK.md` before
changing deletion catalog order or claiming retry behavior.

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
pnpm run test:jobs-scheduler
pnpm run verify
```

Run coverage, builds, and the entry-point check when scheduler behavior changes. Select only the
PostgreSQL mode that covers the changed clock, timer, lifecycle, process, or signal boundary; run
the full six-mode matrix only for release evidence. Those commands are opt-in synthetic acceptance
gates. They compose the production scheduler core with the real Jobs runner and disposable
PostgreSQL under fixed and real clocks, proving the exact ordered catalog, widened-login
non-mutation, recurring execution with overlap suppression, graceful lifecycle and OS-signal
settlement, failure/crash containment with clean-schema retry, one controlled uncommitted
post-insert transaction rollback, and one local host-timer recurring refresh. None proves
committed/external-effect or every-capability recovery, a deployed controller or orchestrator grace
policy, a deployed signal route, managed restart, durable/deployed cadence, production
credential/TLS, monitoring, capacity, or real-user behavior; see
[IMPLEMENTATION_STATUS.md](../../docs/IMPLEMENTATION_STATUS.md) and
[ADR 0063](../../docs/decisions/0063-default-off-local-jobs-scheduler.md).

`pnpm run verify:release` is reserved for release/publication preparation or broad cross-cutting
work.

Before committing, inspect the exact staged diff and run `git diff --cached --check` plus
`pnpm run check:public:staged`.
