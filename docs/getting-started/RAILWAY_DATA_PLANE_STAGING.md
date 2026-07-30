# Railway data-plane staging preparation

This document maps the repository's current deployment declarations into an operator rehearsal. It
contains no credential and proves no hosted service, database, route, migration, monitoring, or
deployment. Platform compatibility and every acceptance item must be verified at the exact revision
and recorded separately.

| Component      | Configuration                        | Entry point                          |
| -------------- | ------------------------------------ | ------------------------------------ |
| Web            | `railway.json`                       | Next standalone `apps/web/server.js` |
| Ingest         | `deploy/railway/ingest.json`         | `apps/ingest-host/dist/main.js`      |
| Jobs scheduler | `deploy/railway/jobs-scheduler.json` | `apps/jobs-scheduler/dist/main.js`   |
| Migration      | `deploy/railway/migrate.json`        | `apps/migrate/dist/main.js`          |
| Edge           | `apps/edge/wrangler.jsonc`           | Cloudflare module Worker             |

The Web-only synthetic preview is covered by
[Railway Web staging preparation](RAILWAY_WEB_STAGING.md). A stable-release workflow can replace
sources in the order Migration, Web, Ingest, Jobs, Edge after protected-environment approval, but it
does not provision or validate any prerequisite below.

## Hard prerequisite: verified PostgreSQL

Every production client requires:

- a certificate-valid DNS hostname, never an IP literal or `localhost`;
- exact `verify-full` TLS mode;
- a trusted CA chain for that hostname;
- one distinct `NOINHERIT` login for Migration, Web, Ingest, and Jobs; and
- exactly one corresponding non-login group per login.

| Login     | Sole group          |
| --------- | ------------------- |
| Migration | `viberacing_owner`  |
| Web       | `viberacing_web`    |
| Ingest    | `viberacing_ingest` |
| Jobs      | `viberacing_jobs`   |

Run `database/roles/bootstrap.sql` once through a protected administrative principal. Runtime probes
must reject owner login, inheritance, administrative capability, extra group membership, unsafe
search path, and TLS mismatch.

Do not weaken hostname verification to accommodate a managed database template. Select or configure
a service whose certificate contract is actually compatible.

## Verify the pinned source locally

```text
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm run verify:release
corepack pnpm run test:database:integration
corepack pnpm run test:migrate:postgres-integration
corepack pnpm run test:web:postgres-integration
corepack pnpm run test:edge-ingest-compatibility
corepack pnpm run test:ingest:postgres-integration
corepack pnpm run test:jobs-scheduler:process-postgres-integration
docker build --tag viberacing-web:local .
docker build --file deploy/Dockerfile.ingest --tag viberacing-ingest:local .
docker build --file deploy/Dockerfile.jobs-scheduler --tag viberacing-jobs-scheduler:local .
docker build --file deploy/Dockerfile.migrate --tag viberacing-migrate:local .
```

These are local synthetic prerequisites. They prove the seven-row migration ledger, 36 forced-RLS
private tables, exact route/application behavior, narrow roles, TLS fixtures, Edge/Ingest signature
compatibility, and local process composition. They do not pre-approve a hosted environment.

## 1. Run migrations once

Create a one-replica service from `deploy/railway/migrate.json`. Supply only:

- exact `VIBERACING_MIGRATIONS_ENABLED=true`;
- the six protected `VIBERACING_MIGRATIONS_DATABASE_*` values; and
- protected CA trust when the runtime does not already trust the chain.

The service has restart policy `NEVER`. Success is code zero, the generic completion line, exact
seven-row ledger, exact provider state, all 36 forced-RLS private tables, expected narrow grants,
and released database sessions/lock. On any other result, stop and follow the
[migration and forward-recovery runbook](../operations/MIGRATION_RUNBOOK.md).

Do not auto-retry, run ad hoc SQL from a runtime service, grant migration authority to another
service, or leave the enable value in place after success.

## 2. Deploy Web closed

Deploy the Web preview with all five Web decisions false as documented in
[Railway Web staging preparation](RAILWAY_WEB_STAGING.md). This provides a rollback target without
requiring protected data-plane configuration.

After the exact database and narrow Web login pass their probes, add the six protected
`VIBERACING_WEB_DATABASE_*` values. If the reviewed staging scope includes data-backed synthetic
reads, enable only `VIBERACING_PUBLIC_SNAPSHOTS_ENABLED=true`, replace the process, and validate:

- current and historical leaderboard contracts;
- current public profile contract;
- exact cache policy by season state;
- no private-table mutation;
- no raw-usage aggregation on requests; and
- generic failure on malformed, unavailable, or saturated requests.

Do not enable enrollment, invite policy, pairing, or CarRecipe mutation as part of this read smoke.

## 3. Deploy Ingest closed

Create one service from `deploy/railway/ingest.json`. Railway supplies `PORT`. Supply:

| Variable                                         | Required value                  |
| ------------------------------------------------ | ------------------------------- |
| `VIBERACING_INGEST_ENABLED`                      | `true`                          |
| `VIBERACING_USAGE_SYNC_ENABLED`                  | `false`                         |
| `VIBERACING_INGEST_TLS_TERMINATION`              | `railway-edge`                  |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`            | `40`                            |
| `VIBERACING_INGEST_DATABASE_*`                   | protected narrow connection     |
| `VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_ID`        | canonical protected key ID      |
| `VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_BASE64URL` | canonical protected 32-byte key |

Do not set the loopback listener host/port, add a health route, widen the restart policy, or
override the entry point. Confirm startup is silent apart from approved generic lifecycle output and
that an unsigned direct request produces no device lookup or private mutation.

Keep `/v1/usage` closed until the matching Edge source, rate-limit bindings, secrets, synthetic
device/account fixture, rollback, and containment sequence are all ready.

## 4. Deploy Edge closed, then coordinate usage enablement

`workers_dev` is disabled. Configure the intended custom route, seven named rate-limit bindings, one
fixed HTTPS Ingest origin, and the shared origin key pair in protected platform state.

The repository config keeps `VIBERACING_USAGE_SYNC_ENABLED=false`. First deploy that closed source
and verify removed/unknown routes, methods, malformed framing, and caller-supplied origin headers
fail before forwarding.

Usage enablement requires one coordinated Ingest replacement and one Edge replacement with exact
`true`. Activate only after the synthetic staging request has:

- a valid active AgentAccount-bound device signature;
- passed all seven rate-limit policies;
- reached exact `POST /v1/usage`;
- consumed origin replay before device/idempotency work;
- committed one exact atomic account/day/event/dirty-season result; and
- produced no sensitive logs.

Changing only one side must leave usage unavailable. This is a containment sequence, not a protocol
migration.

No provider is currently supported and no connector is released. Therefore even a successful
synthetic route check does not authorize real participant ingestion.

## 5. Start Jobs scheduler

Create one service from `deploy/railway/jobs-scheduler.json`. Supply exact
`VIBERACING_JOBS_SCHEDULER_ENABLED=true` and the protected narrow `VIBERACING_JOBS_DATABASE_*`
values. Keep exactly one replica and the checked entry point.

Do not add Railway cron, a second scheduler, a queue, caller-selected job/date/batch, or overlapping
processes. Acceptance must distinguish:

- minute dirty refresh;
- five-minute refresh/finalization;
- hourly dependency-ordered retention/deletion/reset;
- failure without reflective output;
- bounded first-signal drain; and
- PostgreSQL idempotency under restart.

Hosted cadence, capacity, alerting, and external-effect recovery remain separate evidence.

## 6. Participant capabilities

Enrollment, optional invite policy, pairing, and CarRecipe mutation are independent exact decisions.
Do not enable them together as a smoke test.

Enrollment additionally requires a dedicated GitHub OAuth app, exact callback and WebAuthn
origin/RP, fresh purpose-separated session/recovery material, reviewed Argon2 parameters, a working
invite issuance policy if enabled, recovery-attempt controls, and a real authenticator test.

Pairing additionally requires distinct poll/code verifier keys, reviewed private rate windows,
working protected Web login, supported provider/accounting revision, released connector, full batch
review, fresh-passkey step-up, credential persistence, and first-sync evidence.

The repository has no Admin host or invite UI and zero supported providers. Do not bypass those
boundaries with direct table access or manual participant creation.

## Hosted acceptance record

Record only redacted, non-sensitive evidence:

- exact source digest and image digest per service;
- exact seven-row ledger and 36 forced-RLS tables;
- sole-group login/TLS probes for Migration, Web, Ingest, and Jobs;
- three snapshot routes and four removed-route results;
- disabled capability results before enablement;
- direct-origin non-mutation;
- one exact synthetic Edge-to-Ingest atomic usage result if explicitly authorized;
- one settled Jobs cycle with one scheduler;
- SIGTERM settlement within the configured drain;
- backup/restore, containment, rollback, monitoring, and capacity results where actually performed.

Local commands do not establish these hosted facts. Do not update
[implementation status](../IMPLEMENTATION_STATUS.md) until the exact environment, controls, negative
cases, cleanup, and evidence boundary have been independently reviewed.
