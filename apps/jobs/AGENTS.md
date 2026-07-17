# Jobs workspace agent guidance

Read the root `AGENTS.md`, this directory's `README.md`, `docs/PROJECT_PLAN.md`, the current
implementation status, database capability documentation, security invariants, abuse cases, and
privacy data map before editing this workspace. The root public-data, dependency, documentation, and
staged-review rules all apply.

## Non-negotiable boundaries

- The Jobs login is a distinct least-privileged principal that may set only `viberacing_jobs`.
  Preserve the effective-role, login-scope, database-capability, and search-path probe before every
  capability call.
- Keep the database pool at one client. A job invocation calls exactly one reviewed `viberacing_api`
  function with positional parameters; do not add a generic query, migration, table, owner, Web,
  Ingest, Admin, or interactive-auth capability.
- Authentication, CarRecipe-proposal, ingest, and pairing cleanup each accept only the fixed
  1000-row CLI batch. Scoring commands accept one canonical Monday season inside the database
  contract. Primary profile purge accepts only the separate fixed 10-profile CLI batch. Unknown
  commands, fields, arguments, result columns, rows, accessors, and prototypes fail before they can
  widen work.
- Hold the client until the PostgreSQL call settles. Destroy failed clients, close the pool on every
  CLI path, and keep the client deadline outside the database function's 30-second deadline.
- Do not log dates, counts, identifiers, SQL, environment values, database errors, stack traces, or
  retained data. CLI output is one stable success/failure sentence; monitoring hooks receive only a
  closed signal enum.
- This workspace is a local one-shot runner. Do not claim that a scheduler, production login/TLS
  path, monitoring backend, deployment, correction flow, cache/backup/tombstone purge, restore
  replay, or live retention policy exists without separate implementation and evidence.

## Commands

Run from the repository root:

```text
pnpm run lint:jobs
pnpm run typecheck:jobs
pnpm run test:jobs:coverage
pnpm run build:jobs
pnpm run verify
```

Before committing, stage only intended files, run `git diff --cached --check` and
`pnpm run check:public:staged`, then inspect every staged manifest, lockfile, generated inventory,
source, test, and documentation line.
