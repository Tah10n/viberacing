# Local development

## Current scope

The repository provides a synthetic Web experience, closed public contracts, provider-neutral
connector code, independently gated Edge/Ingest/Web/Jobs/Migration processes, and 7
checksum-ledgered database migrations.

All normal verification is local and synthetic. Docker-backed commands create disposable PostgreSQL
databases, roles, certificates, and fixtures. Nothing here proves a supported provider, real-account
read, hosted service, production credential, public route, representative capacity, released
connector, or real-user ingestion. Read the
[implementation evidence ledger](../IMPLEMENTATION_STATUS.md) before translating a green command
into a product claim.

The generated OpenAPI document contains 7 paths: 4 marked `implemented-local` and 3 marked
`contract-only`.

## Prerequisites

- Node.js `24.18.0`, matching `.node-version`;
- pnpm `11.7.0`, matching `package.json`;
- Rust `1.94.0` with `rustfmt` and `clippy`;
- Git; and
- Docker with Compose v2 only for opt-in PostgreSQL evidence.

Use a trusted toolchain or package manager. Do not pipe remote installation scripts into a shell.

## Install and verify

From the repository root:

```text
pnpm install --frozen-lockfile --ignore-scripts
pnpm run verify
```

If the shell does not activate the pinned package manager automatically, use the same commands with
`corepack pnpm`.

Dependencies are exact and the lockfile is committed. The repository rejects unreviewed dependency
build scripts, exotic sources, untrusted registry redirects, newly published packages inside the
quarantine window, and public-host allowlist widening.

`verify` is the bounded deterministic development gate. It covers configuration/public boundaries,
generated contracts, migration integrity, workspace lint/types/unit tests, and Rust
format/check/test/Clippy. It intentionally excludes Docker-backed integrations, production builds,
coverage thresholds, hosted checks, and live services.

For broad release preparation:

```text
pnpm run verify:release
```

That gate adds coverage, production builds, documentation, history, spelling, licenses, formatting,
visual/policy checks, checker mutations, and platform evidence available on the current host. It is
still local evidence.

## Run the synthetic Web experience

```text
pnpm run dev:web
```

Open the reported `localhost` URL. The root experience uses explicit repository-owned synthetic
snapshots and requires no database, account, connector, `.env`, OAuth app, authenticator, or
provider data.

The synthetic surface includes EN/RU, three themes, current/history controls, pagination/filtering,
public profile/garage views, forced-colors and reduced-motion behavior, and a lazy decorative race
with semantic text/table fallback.

## Capability defaults

Copy `.env.example` to an ignored `.env` only when a focused local slice needs configuration. Never
put a real secret or personal value in a tracked file.

| Decision                              | Tracked default | Scope                                   |
| ------------------------------------- | --------------- | --------------------------------------- |
| `VIBERACING_PUBLIC_SNAPSHOTS_ENABLED` | `false`         | Three public snapshot route modules     |
| `VIBERACING_ENROLLMENT_ENABLED`       | `false`         | Invite/OAuth/initial-passkey enrollment |
| `VIBERACING_INVITE_GATE_ENABLED`      | `false`         | Optional invite-only beta policy        |
| `VIBERACING_PAIRING_ENABLED`          | `false`         | Pairing start/poll and browser approval |
| `VIBERACING_CAR_PROPOSALS_ENABLED`    | `false`         | Browser/connector proposal mutation     |
| `VIBERACING_USAGE_SYNC_ENABLED`       | `false`         | Exact Edge usage route                  |
| `VIBERACING_INGEST_ENABLED`           | `false`         | Ingest listener construction            |
| `VIBERACING_JOBS_SCHEDULER_ENABLED`   | `false`         | Scheduler construction                  |

The one-shot migration runner has its own exact `VIBERACING_MIGRATIONS_ENABLED=true` decision and
does not read the Web environment. Every other spelling, case, whitespace variant, missing value, or
unreadable value fails closed.

These are startup/module-load decisions. Changing a value requires process replacement; they are not
dynamic production kill switches. Use the
[capability containment runbook](../operations/CAPABILITY_CONTAINMENT_RUNBOOK.md) when reasoning
about closure or recovery order.

## Public contracts

Canonical schemas and policies live under `contracts/v1`; generated TypeScript and OpenAPI files are
drift-checked derivatives.

```text
pnpm run generate:contracts
pnpm run check:contracts
pnpm run lint:contracts
pnpm run typecheck:contracts
pnpm run test:contracts:coverage
```

The four locally implemented product routes are:

- `POST /v1/usage`;
- `GET /v1/leaderboards/current`;
- `GET /v1/leaderboards/{seasonStart}`; and
- `GET /v1/profiles/{handle}`.

Three connector pairing/proposal operations remain contract-only. The four former score/race/status
and token-ranking routes and the old source-oriented Community usage route are absent. See
[public contracts](../../contracts/README.md).

## Disposable PostgreSQL

Start only the loopback development service:

```text
docker compose up -d postgres
docker compose ps
```

`compose.yaml` binds PostgreSQL to `127.0.0.1:54329`. Its owner credentials are disposable local
bootstrap values. Runtime applications must never consume them.

To stop it:

```text
docker compose down
```

The integration scripts normally create their own isolated Compose project, hostname-verified TLS
database, narrow logins, and synthetic fixtures, then remove them. They do not use the persistent
local service above.

## Database and migration checks

Static and checker-regression gates:

```text
pnpm run check:database
pnpm run test:database-check
pnpm run check:migration-runbook
pnpm run test:migration-runbook-check
pnpm run check:restore-runbook
pnpm run test:restore-runbook-check
pnpm run check:deletion-failure-runbook
pnpm run test:deletion-failure-runbook-check
```

Disposable database semantics:

```text
pnpm run test:database:integration
pnpm run test:migrate:postgres-integration
```

The first command applies the clean seven-revision ledger and proves identity/auth races,
least-privilege roles, batch pairing, exact-decimal multi-device accounting, replay/idempotency,
10,001-profile snapshot semantics, finalization, deletion/retention, and two bounded
current-snapshot restores preserving a completed deletion, one independent revoked device, and a
finalized snapshot. The second proves the emitted one-shot controller under a narrow owner-member
login, advisory-lock convergence, widened-login denial, exact ledger completion, and cleanup.

Read [database guidance](../../database/README.md),
[migration runbook](../operations/MIGRATION_RUNBOOK.md),
[restore runbook](../operations/CURRENT_SNAPSHOT_RESTORE_RUNBOOK.md), and
[deletion failure runbook](../operations/PROFILE_DELETION_FAILURE_RUNBOOK.md) before changing those
surfaces.

## Web checks

```text
pnpm run lint:web
pnpm run typecheck:web
pnpm run test:web:coverage
pnpm run build:web
pnpm run test:web:postgres-integration
pnpm run test:web:standalone
```

The PostgreSQL gate uses one disposable narrow Web login and synthetic OAuth/passkey/device/account
fixtures. The standalone gate imports or starts production Web processes locally. Neither proves
live OAuth, a real authenticator, external TLS, edge admission, public reachability, or deployment.

## Edge and Ingest checks

```text
pnpm run lint:edge
pnpm run test:edge
pnpm run lint:ingest
pnpm run typecheck:ingest
pnpm run test:ingest:coverage
pnpm run lint:ingest-host
pnpm run typecheck:ingest-host
pnpm run test:ingest-host:coverage
pnpm run test:edge-ingest-compatibility
pnpm run test:ingest:postgres-integration
pnpm run test:ingest:signal-postgres-integration
```

The Edge gate uses Fetch/Web Crypto fixtures. Ingest integrations exercise independently signed
loopback requests, one narrow database login, concurrency admission, persistent origin replay, exact
atomic state, a separate built child, and a real local termination signal. They prove no Cloudflare
binding/secret, deployed Worker, Railway route, direct-origin denial, production certificate/login,
or capacity.

## Jobs and scheduler checks

```text
pnpm run lint:jobs
pnpm run typecheck:jobs
pnpm run test:jobs:coverage
pnpm run lint:jobs-scheduler
pnpm run typecheck:jobs-scheduler
pnpm run test:jobs-scheduler:coverage
pnpm run test:jobs:postgres-integration
pnpm run test:jobs-scheduler:postgres-integration
pnpm run test:jobs-scheduler:timer-postgres-integration
pnpm run test:jobs-scheduler:lifecycle-postgres-integration
pnpm run test:jobs-scheduler:process-postgres-integration
pnpm run test:jobs-scheduler:signal-postgres-integration
pnpm run test:jobs-scheduler:wall-clock-postgres-integration
```

The one-shot runner has only thirteen reviewed capabilities. The scheduler supplies no caller date
or batch, runs sequentially, suppresses overlap, and bounds shutdown. These commands prove local
fixed/real clocks, native timers, emitted processes, PostgreSQL rollback, failure/retry, and
signals; they do not prove hosted cadence, replica topology, monitoring, external-effect recovery,
or orchestrator behavior.

## Connector checks

```text
pnpm run check:codex-compatibility
pnpm run test:connector:release-candidate
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --all-targets --all-features --locked
```

On Windows x86_64:

```text
pnpm run test:connector:windows-portable
```

The Windows gate builds the repository binary, copies it into a bounded temporary directory,
exercises only public-safe CLI/missing-candidate behavior, checks inventory/digests, and deletes the
copy. Candidate reader tests use exact synthetic App Server fixtures and privacy sentinels. No
command contacts a real account by default.

Codex `0.144.5` is an exact recognized candidate, not a supported version. The provider
compatibility table names the missing evidence. Do not run `connect` or `sync` against real
credentials or services without an explicitly authorized live test plan.

## Admin checks

```text
pnpm run lint:admin
pnpm run typecheck:admin
pnpm run test:admin:coverage
pnpm run build:admin
pnpm run test:admin:postgres-integration
```

These prove a transport-free invitation kernel, injected authorization/audit order, Access
assertion/member prerequisites, and one narrow database capability. There is no Admin host, page,
CLI, operational issuer, complete authorization adapter, real Access policy/key refresh, passkey,
external audit backend, or deployment.

## Documentation, public safety, and release review

```text
pnpm run check:documentation-currentness
pnpm run test:documentation-currentness-check
pnpm run check:architecture
pnpm run check:docs
pnpm run check:public
pnpm run check:history
pnpm run check:licenses
pnpm run check:config
pnpm run test:config-check
pnpm run check:agent-skills
pnpm run check:publication
```

Before committing, stage only the intended files and run:

```text
pnpm run check:public:staged
git diff --cached --check
```

The staged scanner checks the exact index, while `check:public` checks tracked working-tree content.
Neither makes an automated secrecy guarantee. Manually review every staged blob and commit message.

The publication gate currently passes the tracked public source-only boundary: maintainer and
CODEOWNERS identity, canonical GitHub remote, private vulnerability-reporting status, and restricted
interaction policy. It does not query hosted settings or prove CI for the current commit. Read those
back separately, and never weaken the gate to make a local tree appear published.

## Dependency changes

Read [dependency policy](../security/DEPENDENCY_POLICY.md) before changing a dependency or CI pin.
After an intentional change:

```text
node scripts/check-licenses.mjs --write
pnpm install --frozen-lockfile --ignore-scripts
pnpm audit --audit-level high
pnpm run verify:release
```

Inspect the lockfile, package provenance, license inventory, quarantine dates, native/build scripts,
and target-specific metadata. Inventory regeneration records evidence; it is not approval.

## Live or hosted work

Local gates never authorize access to a provider account, OAuth application, credential store,
hosted database, Cloudflare zone, Railway project, GitHub release, or production endpoint. A live
check needs explicit user authorization, a narrowly documented data/secret/logging scope, rollback
and cleanup steps, and a status update that distinguishes local, hosted, and production evidence.
