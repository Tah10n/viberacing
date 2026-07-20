# Migration runner workspace guidance

Read the root `AGENTS.md`, this directory's `README.md`, `database/AGENTS.md`, the database
migration workflow, ADR 0064, security invariants, abuse cases, and privacy data map before editing
this workspace. The root public-data, dependency, documentation, and staged-review rules all apply.

## Non-negotiable boundaries

- Keep this a default-off one-shot process. Exact `VIBERACING_MIGRATIONS_ENABLED=true` must be
  resolved before catalog loading, protected database configuration, pool construction, or network
  work. Accept no process arguments, alternate truthy values, runtime toggle, or generic command.
- Load only `database/migrations/manifest.json` and its exact repo-relative file inventory. Verify
  closed manifest shape, contiguous revisions, canonical paths, source bounds, UTF-8, and SHA-256
  before removing the exact psql-only preamble. Never accept a caller-selected path, SQL, revision,
  manifest, repair statement, or rollback script.
- The login is a distinct NOINHERIT non-owner principal with exactly one non-admin, non-inherited
  `SET` membership in the NOLOGIN, NOINHERIT `viberacing_owner` role, which itself has no outbound
  memberships. Before taking migration authority, verify the expected login, role flags, membership
  scope, database privileges, search path, read-write state, and configured TLS state. Never place
  this authority in Web, Ingest, Jobs, Admin, or a long-running service.
- Hold one fixed session advisory lock for the whole catalog. Only after acquiring it may the runner
  set the owner role, reread the ledger, apply the remaining exact SQL bodies in order, and require
  a complete exact ledger. Release the lock only after resetting the role; destroy the client on
  every failure so PostgreSQL releases any session lock.
- Keep one pool and one client. Do not add parallel migration execution, retries, down migrations,
  automatic repair, bootstrap role mutation, arbitrary queries, filesystem discovery outside the
  fixed catalog, or subprocess execution.
- Do not log configuration, SQL, revisions, names, paths, counts, database errors, stack traces, or
  stored rows. Process output remains one stable disabled, success, or failure sentence.
- Do not claim PostgreSQL execution, concurrent-controller success, production credentials/TLS,
  replica coordination, staging migration/rollback, deployment, or recovery evidence until the
  separate integration and operational gates exist.

## Commands

Run from the repository root:

```text
pnpm run lint:migrate
pnpm run typecheck:migrate
pnpm run test:migrate:coverage
pnpm run build:migrate
pnpm run check:migrate-entrypoint
pnpm run verify
```

Before committing, stage only intended files, run `git diff --cached --check` and
`pnpm run check:public:staged`, then inspect every staged source, test, package, lockfile, ADR, and
documentation line.
