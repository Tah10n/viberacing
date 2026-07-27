# Railway data-plane staging

This is the shortest repository-owned composition for deploying the existing data plane after the
synthetic Web preview is healthy. It packages four separate Railway services and one dependency-free
Cloudflare Worker:

| Service        | Railway config path                        | Image entry point                       |
| -------------- | ------------------------------------------ | --------------------------------------- |
| Web            | `/railway.json`                            | `node apps/web/server.js`               |
| Ingest         | `/deploy/railway/ingest.json`              | `node apps/ingest-host/dist/main.js`    |
| Jobs scheduler | `/deploy/railway/jobs-scheduler.json`      | `node apps/jobs-scheduler/dist/main.js` |
| Migrations     | `/deploy/railway/migrate.json`             | `node apps/migrate/dist/main.js`        |
| Sync edge      | `apps/edge/wrangler.jsonc` outside Railway | Cloudflare module Worker `fetch`        |

The Web preview can be deployed independently by following
[Railway Web staging](RAILWAY_WEB_STAGING.md). The rest of this document is for an operator who
already has protected infrastructure configuration. It contains no credential and is not evidence
that a live deployment occurred.

After the project, services, roles, runtime variables, and Worker secrets in this guide exist,
follow [GitHub Release deployment](GITHUB_RELEASE_DEPLOYMENT.md) to make stable releases perform
this same order automatically. That workflow does not provision any prerequisite in this guide.

## Hard prerequisite: compatible PostgreSQL

All production database clients require:

- a DNS hostname, not an IP literal or `localhost`;
- `VIBERACING_*_DATABASE_TLS_MODE=verify-full`;
- a server certificate valid for that exact hostname and a CA trusted by Node; and
- distinct non-owner logins for migration, Web, Ingest, and Jobs.

Do not switch production to `disable`, `require`, or certificate verification without hostname
verification. The Railway PostgreSQL SSL template reviewed on 2026-07-26 generated a certificate for
`localhost` only, so it is not a drop-in match for this contract when another Railway service
connects through a different hostname. Use a PostgreSQL service with hostname-valid TLS or provide a
reviewed certificate/trust configuration before continuing.

Run `database/roles/bootstrap.sql` once through a protected database administration principal. That
script creates the five `NOLOGIN` capability groups and database defaults. Provision four distinct
`NOINHERIT` logins outside the repository and grant each exactly one group:

| Login purpose | Only group membership |
| ------------- | --------------------- |
| Migration     | `viberacing_owner`    |
| Web           | `viberacing_web`      |
| Ingest        | `viberacing_ingest`   |
| Jobs          | `viberacing_jobs`     |

The runtime probes reject an owner login, inherited or administrative membership, extra group
membership, unsafe search path, excessive cluster authority, or TLS mismatch.

## Verify the pinned source

From a clean checkout of the exact revision to deploy:

```text
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm run verify:release
corepack pnpm run test:edge-ingest-compatibility
corepack pnpm run test:migrate:postgres-integration
corepack pnpm run test:web:postgres-integration
docker build --file deploy/Dockerfile.ingest --tag viberacing-ingest:local .
docker build --file deploy/Dockerfile.jobs-scheduler --tag viberacing-jobs-scheduler:local .
docker build --file deploy/Dockerfile.migrate --tag viberacing-migrate:local .
```

The image definitions use the repository-pinned Node image, install with the frozen lockfile and
blocked scripts, copy only the emitted production graph, and run as the existing unprivileged `node`
user. The local edge compatibility test proves that the Worker's exact HMAC is accepted by the
production Ingest verifier. The migration and Web integrations prove the exact 42-row ledger and all
four public production routes through separate least-privileged verified-TLS logins. The
Docker-backed Ingest/PostgreSQL integration remains an optional stronger synthetic prerequisite:

```text
corepack pnpm run test:ingest:postgres-integration
```

## 1. Run migrations once

Create a Railway service with config path `/deploy/railway/migrate.json`. Supply only:

- `VIBERACING_MIGRATIONS_ENABLED=true`;
- the six `VIBERACING_MIGRATIONS_DATABASE_{HOST,PORT,NAME,USER,PASSWORD,TLS_MODE}` values; and
- protected CA trust through the runtime when the certificate chain is not already trusted.

The service is one replica with restart policy `NEVER`. Success is exit code zero and exactly
`Vibe Racing migrations completed.` with no standard error. On any other result, stop and follow the
[staging migration and forward-recovery runbook](../operations/MIGRATION_RUNBOOK.md). Do not retry
automatically, run raw migration SQL from a runtime service, or share this login with Web, Ingest,
or Jobs. Remove the exact enable value after success.

## 2. Deploy Web closed

Deploy the root Web service exactly as described in [Railway Web staging](RAILWAY_WEB_STAGING.md).
Keep all six feature controls `false` initially. This establishes the public origin, health check,
production headers, and rollback target without requiring database or identity secrets.

When the migrated database and narrow Web login are ready, add the six
`VIBERACING_WEB_DATABASE_{HOST,PORT,NAME,USER,PASSWORD,TLS_MODE}` values. Enable
`VIBERACING_PUBLIC_RANKING_ENABLED=true` first and require the three legacy routes to return valid
versioned responses. Then enable `VIBERACING_TOKEN_RANKING_ENABLED=true`, redeploy, and require
`/v1/community/tokens` to return a valid `CommunityTokenRaceStatusPageV1` response before enabling
another capability. The browser is token-first and keeps the legacy route as rollback fallback.

## 3. Deploy Ingest

Create a Railway service with config path `/deploy/railway/ingest.json`. Railway supplies `PORT`; do
not set the local listener host or port and do not override the image command. Supply:

| Variable                                                             | Required value                     |
| -------------------------------------------------------------------- | ---------------------------------- |
| `VIBERACING_INGEST_ENABLED`                                          | `true`                             |
| `VIBERACING_USAGE_SYNC_ENABLED`                                      | `false`                            |
| `VIBERACING_INGEST_TLS_TERMINATION`                                  | `railway-edge`                     |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`                                | `40`                               |
| `VIBERACING_INGEST_DATABASE_{HOST,PORT,NAME,USER,PASSWORD,TLS_MODE}` | protected Ingest connection fields |
| `VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_ID`                            | one canonical `edge_*` identifier  |
| `VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_BASE64URL`                     | one canonical 32-byte secret       |

Generate the origin key in a protected secret manager. Use the same pair only in Ingest and the
Cloudflare Worker. Do not add a health route or broaden the restart policy to hide startup failure.
One replica and a 40-second drain are already fixed in the Railway configuration. Keep Usage Sync
false during closed deployment. Enabling it later requires one coordinated Ingest replacement and
Cloudflare Worker replacement with exact `true`; changing only one side must leave the new route
unavailable.

## 4. Deploy the sync edge

Configure the intended Cloudflare custom domain for the Worker; `workers_dev` is disabled. From the
pinned checkout, set the three secrets through prompts and deploy:

```text
corepack pnpm dlx wrangler@4.112.0 secret put VIBERACING_INGEST_ORIGIN_URL --config apps/edge/wrangler.jsonc
corepack pnpm dlx wrangler@4.112.0 secret put VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_ID --config apps/edge/wrangler.jsonc
corepack pnpm dlx wrangler@4.112.0 secret put VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_BASE64URL --config apps/edge/wrangler.jsonc
corepack pnpm dlx wrangler@4.112.0 deploy --config apps/edge/wrangler.jsonc
```

The origin URL is the exact dedicated HTTPS Railway Ingest origin with no path, query, fragment,
credential, IP literal, or non-default port. A direct unsigned request to that Railway origin must
fail generically before device or database work. A request through Cloudflare still needs a valid
device signature; the edge proof does not authenticate a participant. The checked Worker value keeps
`VIBERACING_USAGE_SYNC_ENABLED=false`. After the matching Ingest replacement is healthy with exact
`true`, deploy the same reviewed source once with the single non-secret override:

```text
corepack pnpm dlx wrangler@4.112.0 deploy --var VIBERACING_USAGE_SYNC_ENABLED:true --config apps/edge/wrangler.jsonc
```

The current repository-built Windows connector is still candidate-only and supports only exact Codex
`0.144.5`; this coordinated route activation does not turn it into a released or supported package.

## 5. Start the Jobs scheduler

Create a Railway service with config path `/deploy/railway/jobs-scheduler.json`. Supply
`VIBERACING_JOBS_SCHEDULER_ENABLED=true` and the six
`VIBERACING_JOBS_DATABASE_{HOST,PORT,NAME,USER,PASSWORD,TLS_MODE}` fields. Keep exactly one replica.
The image already invokes the fixed sequential catalog; do not add a Railway cron, command, parallel
replica, queue, or second scheduler.

## 6. Enable participant capabilities deliberately

Ranking, enrollment, pairing, source creation, and CarRecipe proposals are independent startup
decisions. Do not turn them all on as a smoke test.

Enrollment additionally needs the dedicated GitHub OAuth application, exact callback and WebAuthn
origin/RP settings, a fresh session key, a distinct recovery pepper, reviewed Argon2 settings, the
protected Web login, and an operational invite-issuance path. Pairing additionally needs distinct
poll/code keys and reviewed private attempt/rate windows. The exact variable inventory is in
`.env.example`; its placeholders are intentionally unusable.

The repository still has no Admin host or invite UI and no released connector. Therefore this
composition can run the preview, public data reads, Ingest, migrations, and maintenance, but it is
not a self-service public beta. Do not create real participants by bypassing the invitation kernel
or by granting a browser/runtime service direct table access.

## Deployment acceptance

Record only redacted aggregate results outside the public repository:

- Web root and static assets return `200` with CSP and HSTS;
- every capability left disabled returns its documented generic failure;
- the migration ledger equals all 42 reviewed revisions;
- Web, Ingest, Jobs, and migration probes each admit only their one intended login/group;
- database connections use hostname-verified TLS;
- direct-origin sync lacks a valid proof and produces no private mutation;
- Cloudflare forwards one correctly signed `UsageSyncV1` synthetic request only through the reviewed
  path;
- one Jobs cycle settles and no second scheduler session exists; and
- SIGTERM drains Web/Ingest/Jobs within the configured platform window.

Local tests do not establish any item in this list against a hosted environment. Monitoring,
provider logs, alerting, backups, stale-backup deletion replay, real-user recovery, capacity, and
incident operation remain separate deployment work.
