# Railway configuration migration

This is a prepared migration for the existing `viberacing` service in `robust-celebration` /
`production`. It has **not been applied**. Keep `railway.json` unchanged until the separately
approved cutover is healthy. Merging this preparation does not apply IaC, although the existing
GitHub `main` autodeploy can deploy the application when this PR is eventually merged.

Railway
[deprecates Config as Code](https://docs.railway.com/infrastructure-as-code#iac-vs-config-as-code)
with a hard cutoff of **2026-12-01**. The replacement is evaluated explicitly by the CLI; Railway
does not read `.railway/railway.ts` during an ordinary application deployment. No workflow applies
IaC; the Railway step in `pnpm verify` is an offline type/contract check. No Railway credentials are
needed in CI.

## Scope and preserved settings

The named partial `viberacing` declares only `service.viberacing`. It must not own `Postgres` or
`postgres-volume`. Do not remove or rename the partial: whole-project ownership could delete omitted
resources. The authoring function rejects any other project or environment ID.

| Existing Config as Code setting  | IaC setting                      | Value                          |
| -------------------------------- | -------------------------------- | ------------------------------ |
| `build.builder`                  | `build.builder`                  | `DOCKERFILE`                   |
| `build.dockerfilePath`           | `build.dockerfilePath`           | `Dockerfile`                   |
| `deploy.preDeployCommand`        | `deploy.preDeployCommand`        | `["node scripts/migrate.mjs"]` |
| `deploy.healthcheckPath`         | `deploy.healthcheckPath`         | `/ready`                       |
| `deploy.healthcheckTimeout`      | `deploy.healthcheckTimeout`      | `300`                          |
| `deploy.restartPolicyType`       | `deploy.restartPolicyType`       | `ON_FAILURE`                   |
| `deploy.restartPolicyMaxRetries` | `deploy.restartPolicyMaxRetries` | `3`                            |
| `deploy.drainingSeconds`         | `deploy.drainingSeconds`         | `40`                           |

The imported GitHub source remains `Tah10n/viberacing`, branch `main`, with Wait for CI enabled.
Build environment V3, runtime V2, one replica in `europe-west4-drams3a`, the existing CPU/memory
limits, and runtime switches are retained. The Dockerfile supplies the start command. The generated
`viberacing.up.railway.app` domain remains platform-managed, as in Railway's importer.

All 11 existing variable names use `preserve()`: Railway retains values, sealed metadata and
reference expressions, including the database connection. The file does not set or decrypt any
value. A preserved name is an inventory entry, not an endorsement of its value. Refresh that
inventory before applying; omitting a newly added variable could delete it. Changes to runtime
variables, runtime dependencies, databases, volumes, domains, replicas or resource limits are
outside this migration.

## Read-only checks

Use the locked dependencies and Railway CLI **5.71.0** (the version checked for this migration).
Recheck command help and the plan if using another CLI version. The SDK is pinned to
`railway@3.16.0` as a development dependency; the production image does not depend on it.

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm railway:check
railway --version
railway link --project 9c93a77d-9033-4045-b34c-f8755cf1d6b6 \
  --environment 2edee876-7008-4fe5-922e-917085a6f21e \
  --service 04065ef3-a69b-4e6d-87bb-5b362e9aa28b
railway config pull --json
railway config partials list --json
railway config plan
```

`link` selects the local CLI target. `pull --json` only reads the graph and preserves variable
values; do not add `--include-variables`, `--decrypt-variables` or `--show-values`. Keep full
snapshots and plan artifacts outside the repository. Do not run `pull --force`: it would replace
this narrow partial with a whole-project import. Do not regenerate over the reviewed file with
`migrate --force`.

The 2026-10-30 read-only plan with CLI 5.71.0 returned `ok: true`, no diagnostics, and exactly two
`resource.update` entries, both for `viberacing`:

```text
Update viberacing build.builder
  build.builder -> DOCKERFILE
Update viberacing deploy settings
  drainingSeconds -> 40
  healthcheckPath -> /ready
  healthcheckTimeout -> 300
  preDeployCommand -> ["node scripts/migrate.mjs"]
  restartPolicyMaxRetries -> 3
  restartPolicyType -> ON_FAILURE
```

The root `Dockerfile` path is present in the evaluated graph and normalizes to Railway's default.
There were no creates, deletes, variable, source, networking, database or volume changes. The
evaluated build/deploy objects were also compared against the live imported settings overlaid with
**all eight** legacy settings. No staged patch, apply result or deployment was created by the plan.
This preview is evidence, not a reusable approval or an assertion that cutover is complete.

### CLI migration caveats

The official
[migration guide](https://docs.railway.com/infrastructure-as-code#migrating-from-config-as-code)
describes a legacy-config conflict check. At inspection time the service's `railwayConfigFile` was
`null` (automatic discovery), but `resolvedFileConfig.configFile` was `/railway.json` at commit
`3fc5dbf04397379c460ea623a0d4db4051cf13b6`. Thus the file was still active despite a successful
plan. CLI 5.71.0's `migrate status` and `cutover` inspect explicit config paths, so their empty
inventory must not be treated as proof that automatic discovery is disabled. Verify the resolved
deployment config as well as the service settings.

CLI 5.58.0's migration preview also omitted restart/draining settings and left Dockerfile settings
in comments. Its `migrate --apply` clears remote config paths. CLI 5.71.0 separates local generation
from `migrate cutover`, but cutover still changes service settings and triggers a deployment.
Neither generator is a substitute for the reviewed configuration and parity check here. The
versioned
[CLI implementation](https://github.com/railwayapp/cli/blob/v5.71.0/src/commands/config/migrate.rs)
defines these behaviors.

## One-time cutover — separate approval required

Do not execute this section as part of PR preparation. It changes production settings and can
trigger deployments. Coordinate a deployment window, including any environments inheriting
production; prevent concurrent merges/configuration edits until verification finishes.

1. Refresh the read-only snapshots above. Record the active healthy deployment and rollback target,
   current `railwayConfigFile`, resolved file manifest, source, domains, placement/limits and
   variable **names**. Confirm only the existing web service is targeted, the partial is unclaimed
   or already owned by `viberacing`, and all inherited environments are in the approved scope.
   Reconcile drift before continuing. Keep `railway.json` available for rollback before the cutoff
   date.

2. Preserve the fallback settings **in the same service-settings update that disables file
   discovery**. Clearing the path alone can launch a deployment without the migration command or
   readiness gate because those platform fields were null. Use Railway's service settings API
   (`serviceInstanceUpdate`) for service `04065ef3-a69b-4e6d-87bb-5b362e9aa28b` and environment
   `2edee876-7008-4fe5-922e-917085a6f21e` with the following reviewed input. This is a proposed
   production mutation, not a command run by this PR:

   ```json
   {
     "builder": "DOCKERFILE",
     "dockerfilePath": "Dockerfile",
     "preDeployCommand": ["node scripts/migrate.mjs"],
     "healthcheckPath": "/ready",
     "healthcheckTimeout": 300,
     "restartPolicyType": "ON_FAILURE",
     "restartPolicyMaxRetries": 3,
     "drainingSeconds": 40,
     "railwayConfigFile": ""
   }
   ```

   The empty string is the CLI's explicit disable value; `null` was the automatic-discovery state.
   This update leaves variables, source, networking, resource limits and the database untouched.
   Never substitute a path-only `migrate cutover` while the fallback fields are missing.

3. Inspect the resulting service settings and deployment. All eight settings must be persisted; the
   new resolved config must no longer read `/railway.json`. Verify the migration log, `/health`,
   `/ready`, the homepage and `/og`, plus Wait for CI, the domain, one web replica and the unchanged
   database. If discovery is still active, deployment fails, or scope differs, stop and restore the
   saved config path before any IaC apply. Do not infer success from `migrate status` alone.

4. From the reviewed committed checkout, create a **fresh** plan outside the repo:

   ```sh
   railway config plan --out /tmp/viberacing-railway.plan.json
   ```

   Expect no configuration changes after step 2; the first apply still records partial ownership. If
   a moved setting remains in the plan, explain and review it before continuing. Reject resource
   creates/deletes, variable changes, unrelated settings or any database/volume/domain change. After
   separate approval of that exact plan, apply it with:

   ```sh
   railway config apply --plan /tmp/viberacing-railway.plan.json
   ```

   Do not use `--confirm-destructive`. A stale environment etag or `.railway/` tree requires a new
   plan and review. Verify a subsequent plan has no changes and partial ownership contains only
   `service.viberacing`. Repeat deployment/readiness checks if apply caused another rollout.

5. Remove `railway.json` in a follow-up change only after the switch is verified. At that point
   replace the temporary legacy parity comparison in `scripts/check-railway-config.mjs` with an
   explicit deployment contract. Keep the offline check and manual apply workflow. Do not install
   Railway's automatic apply-on-merge GitHub Action as part of this migration.

## Rollback

Before **2026-12-01**, restore the saved config-file path (or explicitly `/railway.json` for the
auto-discovered baseline) on this service while retaining the equivalent platform fallback values.
Verify the resolved file manifest and health of the resulting deployment. The atomic manual handover
above does not create the CLI's `.cac-migration.json`, so `migrate undo` is not its rollback.

After the cutoff, restoring the legacy file cannot recover settings: repair the explicit platform
settings or review/apply the last known good IaC configuration. An application rollback does not
undo platform settings or partial ownership. Keep the eight fallback values intact, do not delete
resources or variables, and use the recorded healthy Railway deployment if an application rollback
is separately authorized. This migration contains no schema or data changes.
