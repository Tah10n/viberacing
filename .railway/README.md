# Railway configuration

`.railway/railway.ts` manages the existing `viberacing` web service in `robust-celebration` /
`production`. Apply it before deploying the first commit without the root `railway.json`. An
ordinary application deployment does not evaluate this file. CI checks its types and deployment
contract offline; it has no Railway credentials or automatic IaC apply action.

The named partial `viberacing` owns only `service.viberacing`. Keep its name and scope: PostgreSQL
and `postgres-volume` remain outside its ownership. The authoring function rejects another project
or environment ID. Existing source (`Tah10n/viberacing`, `main`, Wait for CI), placement, one
replica, resource limits and runtime switches are preserved. The generated Railway domain remains
managed by the platform. All 11 variable names use `preserve()` so values, secrets and database
references stay in Railway. Refresh the inventory before later changes; a missing variable can mean
deletion.

## Deployment contract

The former legacy file is retained only as `.railway/deployment-contract.json`, an offline fixture
for `pnpm railway:check`. It is not a Railway Config File path. The SDK's evaluated settings must
match all eight values, and the check rejects root legacy files that would enable discovery again.

| Setting             | Value                      |
| ------------------- | -------------------------- |
| Builder             | `DOCKERFILE`               |
| Dockerfile path     | `Dockerfile`               |
| Pre-deploy command  | `node scripts/migrate.mjs` |
| Readiness path      | `/ready`                   |
| Healthcheck timeout | `300` seconds              |
| Restart policy      | `ON_FAILURE`               |
| Restart attempts    | `3`                        |
| Draining period     | `40` seconds               |

The Dockerfile supplies the start command. There are no application, schema or data changes in this
migration. The SDK is pinned to `railway@3.16.0` as a development dependency, outside the web
runtime. The checked CLI version is 5.71.0; recheck help and the plan when using another version.

## Plan and apply

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm railway:check
railway link --project 9c93a77d-9033-4045-b34c-f8755cf1d6b6 \
  --environment 2edee876-7008-4fe5-922e-917085a6f21e \
  --service 04065ef3-a69b-4e6d-87bb-5b362e9aa28b
railway config pull --json
railway config partials list --json
railway config plan --out /tmp/viberacing-railway.plan.json
```

These commands select the local target and read remote state. Run them from a reviewed committed
checkout. Keep snapshots and saved plans outside the repository. Do not use variable decryption or
`--show-values`, and do not overwrite the narrow partial with `pull --force` or regenerated code.
Reject any create/delete, variable, database, volume, domain, source, replica or resource-limit
change outside the intended operation. The first apply records ownership even if settings match.

For an authorized, reviewed plan:

```sh
railway config apply --plan /tmp/viberacing-railway.plan.json
```

Do not use `--confirm-destructive`. A stale etag or `.railway/` tree requires a fresh plan and
review. After applying, inspect service settings, partial ownership and a fresh plan. Expect no
drift and ownership of only `service.viberacing`. Monitor any deployment caused by apply.

## Initial migration order

Railway
[stops reading legacy files on 2026-12-01](https://docs.railway.com/infrastructure-as-code#iac-vs-config-as-code).
The official service was using automatic discovery: `railwayConfigFile` was null while its running
deployment resolved `/railway.json`. A successful plan or empty `migrate status` inventory does not
prove that discovery has stopped. Clearing a path alone does not remove a root file from the
builder. The updated
[migration guide](https://docs.railway.com/infrastructure-as-code#no-config-file-path-set) requires
applying the settings before deleting an automatically discovered file.

1. Require the current PR's mandatory checks to pass before changing production. Refresh the
   production snapshot, source, variable names, domains, placement/limits and current healthy
   deployment's rollback eligibility. Check for concurrent edits and inheriting environments. The
   2026-11-16 preflight matched the reviewed inventory and showed only two web-service updates: the
   builder and the six deploy settings above. The root Dockerfile path normalizes to its default.
2. While production's source still contains the old file, apply the pinned IaC plan. Confirm all
   eight effective settings now come from persisted service configuration, all existing variables
   and resources are retained, partial ownership is correct, and a fresh plan has no drift. This
   makes a deployment without the legacy file safe. Do not merge its removal before this check.
3. Confirm there is no explicit legacy Config File path. If one was added since the snapshot, stop
   and review that drift before proceeding: deleting a file still selected by a path breaks builds.
   The CLI's `migrate cutover` changes only the stored path, not deployment settings; it neither
   replaces step 2 nor creates a deployment by itself.
4. Merge the reviewed removal commit after its required checks pass. Wait for main's checks and the
   ordinary source deployment. Preserve Wait for CI. Verify the active deployment has the intended
   merge SHA and no resolved legacy config path, file manifest or property mapping. The fixture
   `.railway/deployment-contract.json` must never be set as a Config File path.
5. Verify migration logs, `/health`, `/ready`, homepage and `/og`; check source, domain, replica,
   variable inventory and the unchanged database/volume. A final IaC plan must show no changes.

## Rollback

Retain the current healthy deployment ID and image digest before applying. If a rollout fails,
restore that deployment using Railway's normal rollback while retaining the eight equivalent
platform settings. No schema changes are introduced. Application rollback does not undo platform
settings or partial ownership.

Before the cutoff, the previous source commit still contains the legacy file and can restore its old
behavior. A Config File path may only be restored when the deployed commit contains that file;
restoring `/railway.json` on the removal commit would break the next build. After 2026-12-01, repair
the explicit platform/IaC settings instead of relying on legacy discovery. Do not delete variables,
databases, volumes or the partial to roll back this migration.
