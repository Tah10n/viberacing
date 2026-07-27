# GitHub Release deployment

The repository contains one protected workflow that redeploys the current service composition after
a stable GitHub Release is published. It is intentionally dormant until the external Railway,
Cloudflare, and GitHub Environment settings below exist.

The workflow deploys service source only. It does not release the candidate connector, create
infrastructure, provision PostgreSQL roles, create runtime secrets, or prove a live deployment.

## One-time GitHub setup

1. Protect `main`, require the repository gates, and require review for
   `.github/workflows/deploy-release.yml` plus its policy checker.
2. Protect stable `vMAJOR.MINOR.PATCH` tags and enable immutable releases where the repository plan
   supports it.
3. Create a GitHub Environment named exactly `production`.
4. Require an operator review for that environment. Restrict deployment branches/tags to protected
   `main` and protected stable release tags.
5. Add only these Environment secrets:

   | Secret                 | Scope                                                                 |
   | ---------------------- | --------------------------------------------------------------------- |
   | `RAILWAY_TOKEN`        | Project/environment token for only the Vibe Racing production project |
   | `CLOUDFLARE_API_TOKEN` | Token scoped to edit only the intended Worker in the intended account |

6. Add these non-secret Environment variables:

   | Variable                        | Required shape                                      |
   | ------------------------------- | --------------------------------------------------- |
   | `CLOUDFLARE_ACCOUNT_ID`         | Lowercase 32-character hexadecimal account ID       |
   | `VIBERACING_PUBLIC_ORIGIN`      | Canonical public HTTPS DNS origin, without `/`      |
   | `VIBERACING_USAGE_SYNC_ENABLED` | Exact `false` for closed deployment or exact `true` |

The workflow has top-level `contents: read`; pull-request CI never attaches this environment or
references either secret. GitHub documents the `release` event and protected environments in
[workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#release)
and
[deployment environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

## One-time Railway setup

Create one Railway project/environment with these exact service names and configure each service to
read its listed config file:

| Service name                | Railway config path                   |
| --------------------------- | ------------------------------------- |
| `viberacing-migrate`        | `/deploy/railway/migrate.json`        |
| `viberacing-web`            | `/railway.json`                       |
| `viberacing-ingest`         | `/deploy/railway/ingest.json`         |
| `viberacing-jobs-scheduler` | `/deploy/railway/jobs-scheduler.json` |

Disable Railway GitHub branch autodeploy for these services. The release workflow is the single
source replacement controller; Railway's native GitHub autodeploy is push-driven and does not
coordinate independent services. Railway documents this distinction in
[GitHub autodeploys](https://docs.railway.com/deployments/github-autodeploys).

Provision the platform variables and protected values from
[Railway data-plane staging](RAILWAY_DATA_PLANE_STAGING.md) before creating a release. Keep the
migration latch false. The workflow temporarily changes only that latch and the coordinated Ingest
Usage Sync flag; it does not populate any database or application credential.

Create `RAILWAY_TOKEN` as the narrowest project/environment token that can deploy and update
variables for only these services. The workflow runs the official Railway CLI from one immutable
container digest and waits for each attached deployment before continuing. See Railway's
[CLI deployment](https://docs.railway.com/cli/deploying) and
[`railway up`](https://docs.railway.com/cli/up) references.

## One-time Cloudflare setup

Create the intended Worker route/custom domain and set its three protected values directly in
Cloudflare:

- `VIBERACING_INGEST_ORIGIN_URL`;
- `VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_ID`; and
- `VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_BASE64URL`.

Do not copy those values into GitHub. The workflow supplies only the validated non-secret
`VIBERACING_USAGE_SYNC_ENABLED` value and uses a commit-pinned Cloudflare action with exact Wrangler
`4.112.0`. Cloudflare documents the external CI pattern in
[Workers CI/CD with GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).

## Automatic deployment

1. Merge the reviewed release source through protected `main`.
2. Create and publish a stable GitHub Release whose tag is exactly `vMAJOR.MINOR.PATCH`.
3. GitHub starts `Deploy stable release`. Drafts and prereleases do not deploy.
4. The secretless job checks tag ancestry and runs the release plus synthetic integration gates.
5. A reviewer approves the `production` Environment.
6. The protected job runs migrations, closes their latch, deploys Web, applies and deploys the
   Ingest flag, deploys Jobs, deploys Edge last, and smoke-checks Web.

Only one production deployment runs at a time, and an in-progress deployment is never cancelled by a
newer release.

## Manual redeploy

Use **Actions → Deploy stable release → Run workflow** from `main` and enter an existing stable tag.
The manual path repeats ancestry checks, all verification, and environment approval.

Use this path to redeploy the same stable tag. It is not an automatic old-version or database
rollback. An older tag carries an older migration catalog and must fail if it cannot accept the
current forward-only ledger. Handle a real rollback through a separate reviewed mixed-version and
forward-recovery decision; do not move or recreate a tag.

## Failure behavior

- Verification failure exposes no deployment credential and changes no platform state.
- Migration failure attempts to close the migration latch and stops later service deployments.
- A Web, Ingest, or Jobs failure stops before the next service.
- Edge deploys only after Ingest and Jobs succeed.
- The workflow performs no automatic reverse migration and no blind retry.

Follow the [migration runbook](../operations/MIGRATION_RUNBOOK.md) for a migration failure and the
[capability containment runbook](../operations/CAPABILITY_CONTAINMENT_RUNBOOK.md) when a deployed
capability must be closed. Record a hosted deployment claim only after inspecting the real GitHub,
Railway, Cloudflare, PostgreSQL, TLS, and smoke evidence.
