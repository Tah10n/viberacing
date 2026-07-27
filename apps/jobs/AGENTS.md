# Jobs workspace agent guidance

Read the root `AGENTS.md`, this directory's `README.md`, `docs/PROJECT_PLAN.md`, the current
implementation status, database capability documentation, security invariants, abuse cases, and
privacy data map before editing this workspace. Read
`docs/operations/PROFILE_DELETION_FAILURE_RUNBOOK.md` before changing or diagnosing primary purge or
terminal deletion-job cleanup. The root public-data, dependency, documentation, and staged-review
rules all apply.

## Non-negotiable boundaries

- The Jobs login is a distinct least-privileged principal that may set only `viberacing_jobs`.
  Preserve the effective-role, login-scope, database-capability, and search-path probe before every
  capability call.
- Keep the database pool at one client. A job invocation calls exactly one reviewed `viberacing_api`
  function with positional parameters; do not add a generic query, migration, table, owner, Web,
  Ingest, Admin, or interactive-auth capability.
- Authentication, audit-event, invite, CarRecipe-proposal, ingest, finalized source/day, pairing,
  session, terminal deletion-job, aged revoked-passkey, and aged revoked-device cleanup plus pairing
  approval-provenance redaction each accept only the fixed 1000-row CLI batch. Finalized source/day
  cleanup must preserve its captured rounded freshness and prove the live/captured inventory before
  every row deletion. Scoring commands accept one canonical Monday season inside the database
  contract. Pairing rate-window reset accepts no parameters and can touch only the fixed 130-row
  matrix. Primary profile purge accepts only the separate fixed 10-profile CLI batch. Unknown
  commands, fields, arguments, result columns, rows, accessors, and prototypes fail before they can
  widen work. The runner does not assign deletion leases, attempts, backoff, or retry state; do not
  claim schema fields or scheduler recurrence provide automatic deletion retry.
- Hold the client until the PostgreSQL call settles. Destroy failed clients, close the pool on every
  CLI path, and keep the client deadline outside the database function's 30-second deadline.
- Do not log dates, counts, identifiers, SQL, environment values, database errors, stack traces, or
  retained data. CLI output is one stable success/failure sentence; monitoring hooks receive only a
  closed signal enum.
- This workspace remains a local one-shot runner. The separate `apps/jobs-scheduler/` workspace may
  invoke only this exported boundary and does not change its command or database authority. Do not
  claim that an external audit sink, deployed scheduler/cadence, production login/TLS path,
  monitoring backend, deployment, correction flow, cache/backup/tombstone purge, restore replay, or
  live retention policy exists without separate implementation and evidence.

## Commands

Run from the repository root:

```text
pnpm run lint:jobs
pnpm run typecheck:jobs
pnpm run test:jobs
pnpm run verify
```

Run Jobs coverage/build when behavior changes. Run the Jobs PostgreSQL integration when its database
adapter or capability catalog changes, and select only the scheduler mode whose boundary changed.
The full integration matrix and `pnpm run verify:release` are release evidence, not routine
iteration gates.

Before committing, stage only intended files, run `git diff --cached --check` and
`pnpm run check:public:staged`, then inspect every staged manifest, lockfile, generated inventory,
source, test, and documentation line.
