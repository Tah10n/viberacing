# Releasing

The connector follows Semantic Versioning. The web application is deployed continuously, but a
protocol or shared user-experience change must be documented with the connector release it affects.
Never infer a GitHub release tag from package metadata alone, reuse an npm name/version pair, or
publish from a feature branch or pull-request workflow.

## Stable release process

Every change to files that can enter the connector archive must carry an explicit, reviewable
version bump relative to the pull-request base. Production CI enforces this before building the web
image, so changed bytes cannot be packaged under an immutable npm version. The bump may be staged in
the server-first compatibility pull request when connector regressions are part of that same review;
merging it still does not publish npm. Publication begins only after the compatible server is
deployed and healthy:

1. Start from the reviewed merge commit on `main` with no unrelated changes.
2. Confirm the staged stable connector version matches the actual compatibility impact and has not
   already been published.
3. Confirm `packages/connector/package.json`, generated `version.mjs`, and `CHANGELOG.md` agree.
4. Run `corepack pnpm --filter @viberacing/connector prepack` and commit the regenerated
   `packages/connector/lib/version.mjs`.
5. Run `corepack pnpm verify`, `corepack pnpm connector:package:check`, local smoke, browser E2E,
   the production image build, and the production dependency audit.
6. Merge only after `ci-required`, `Dependency review`, and every platform/browser/production job is
   green.
7. Create an annotated `vX.Y.Z` tag on that exact merge commit.
8. Create a non-draft, non-prerelease GitHub Release for that exact tag.
9. The unprivileged `connector-release-request.yml` workflow forwards the release event to the
   default-branch `publish-connector.yml` workflow. The publisher validates the exact event commit,
   tag, stable GitHub Release, main ancestry, version, generated module, package metadata, clean
   package, npm availability, and full repository gate.
10. The workflow publishes `@viberacing/connector@X.Y.Z` with npm Trusted Publishing and moves
    `latest` to that stable version.
11. The workflow succeeds only after bounded registry checks find both the exact version and
    `dist-tags.latest === X.Y.Z`.
12. If that release intentionally raises the compatibility floor, update Railway
    `VIBERACING_MIN_CONNECTOR_VERSION` only after step 11, wait for the new deployment and `/ready`,
    then verify that an older signed-in installation sees the same required `doctor --repair`
    command on both `/` and `/dashboard`.

The workflow never modifies `package.json`, `CHANGELOG.md`, commits, or tags. It has no npm token or
password and does not pass `--provenance`; npm Trusted Publishing creates provenance automatically.
Prereleases are rejected by this stable workflow. A future `next` channel requires separate design
and review.

For protocol changes, preserve server-first ordering: deploy and verify a server that accepts the
old and new protocols, publish the compatible connector, and only then raise
`VIBERACING_MIN_CONNECTOR_VERSION` if the server intentionally stops supporting an older version.
That variable is a compatibility floor, not a latest-version tracker; normal patch and minor
releases do not change it.

## Connector 0.6.0 current-year history staging

Connector 0.6.0 adds bounded protocol v5 history snapshots while the server continues accepting
protocols v2, v3, and v4 for rolling usage. Migration `010_current_year_history.sql` and the v5
server must be deployed and verified before the connector package is published: older connectors
keep their recent rolling sync, while only v5 connectors can resume the current UTC year's history
in at-most-31-day chunks. The legacy `weekly_agent_usage` table remains during this rollout solely
as a rollback-compatible schema artifact; v5 reads and writes use `daily_agent_usage`.

The feature pull request stages the migration, server, package bytes, tests, and documentation only.
Merging it does not authorize `npm publish`, a tag, GitHub Release, deploy, or Railway variable
change. After a separately approved server deployment is healthy, follow the stable release process
above for 0.6.0. Keep the compatibility floor unchanged unless a later, separate rollout decision
intentionally makes v5 history support mandatory; the web UI already lets older connectors continue
recent sync and explains that an update is needed only for current-year history.

## Connector 0.5.1 OpenCode plugin staging

Connector 0.5.1 adds only the local installation-owned OpenCode automatic-Sync plugin and retains
protocol v4, the existing PostgreSQL schema, ranking semantics, browser pairing, and the deployed
minimum connector version. The feature PR stages package bytes and cross-platform evidence only.
Merging it does not authorize `npm publish`, a tag, GitHub Release, deploy, Railway variable change,
or compatibility-floor increase. Perform those release actions only through the separately approved
stable release process above, then verify the immutable tarball, provenance, `latest`, a clean
consumer install, and real OpenCode restart behavior before considering any later floor change.

## Connector 0.5.0 account-switch rollout

Connector 0.5.0 keeps usage protocol v4 and the server continues to accept v2 and v3. Its new
authenticated dynamic-source endpoint must be deployed before the connector package, while the
Railway compatibility floor remains `0.4.3`. Connector 0.4.4 was separately squash-merged and
published first: annotated tag `v0.4.4` resolves to linear `main` commit
`2b16b6a8ad75b6b852adc5e2189e6d4a8d93eabd`. Its source tree matches the reviewed candidate
`e2914273e2c4105d38bcfa132c3f83d60e0debeb`, but the feature-branch SHA is not the release target.
`dist-tags.latest` remains `0.4.4` until a separately authorized 0.5.0 release.

Production already contains accepted OpenCode usage, so complete the remaining rollout in this
order:

1. Inventory every active installation with an active OpenCode source. On each real production
   computer, run immutable 0.4.4 `doctor --repair`, then 0.4.4 `sync`, then the reviewed read-only
   0.5.0 `upgrade-preflight` described below. The repair is required because a one-off 0.4.4 Sync
   can leave the installed Browser Sync handler/runtime on 0.4.3. A last-sync timestamp or connector
   version on the server is not proof of a local cutover.
2. Squash-merge the reviewed linear account-switch pull request. It must be based on the published
   0.4.4 `main` commit and must not contain either the old staging commit or a merge commit.
3. Wait for Railway to apply the server changes and migration `007_account_switch_safety.sql`.
4. Verify `/ready` and an authenticated, content-free Codex source-registration request. The request
   has exactly `agentId`, `clientSourceId`, `collectionMethod`, `profileClientSourceId`, and
   `supportedSurface`; it never contains email, provider identity, credentials, or account hints.
5. Keep `VIBERACING_MIN_CONNECTOR_VERSION=0.4.3` and confirm 0.4.4 still pairs and syncs.
6. Confirm a direct 0.4.3 -> 0.5.0 OpenCode upgrade fails closed before pending delivery,
   reconciliation, source-schema migration, pairing, or initial Sync, while a confirmed 0.4.4 state
   preserves the baseline and counts rows inserted after its accepted scan.
7. Create annotated tag `v0.5.0` and a non-draft, non-prerelease GitHub Release on the exact
   reviewed squash-merged `main` commit.
8. Wait for Trusted Publishing and verify both `@viberacing/connector@0.5.0` and
   `dist-tags.latest === 0.5.0`.
9. Run Linux, Windows, and macOS smoke tests against the immutable package, including the real macOS
   custom-scheme handler.
10. Run a real shared-profile Codex A -> B -> A check: two logical accounts, no overwrite, no third
    source on return, one physical hook, and no shared-profile component breakdown.
11. Only if production intentionally requires these local account-switch guarantees, raise
    `VIBERACING_MIN_CONNECTOR_VERSION` to `0.5.0`, wait for deployment and `/ready`, and verify the
    signed-in update notices. Publishing 0.5.0 alone is not a reason to raise the floor.

### Read-only OpenCode cutover inventory

Use a read-only production query to enumerate the active machines that require local confirmation;
do not infer completion from `installed_connector_version` or `last_successful_sync_at`:

```sql
SELECT users.handle,
       installations.name,
       max(installation_sources.last_successful_sync_at) AS last_opencode_sync_at
  FROM installations
  JOIN users ON users.id = installations.user_id
  JOIN installation_sources ON installation_sources.installation_id = installations.id
 WHERE installations.status = 'active'
   AND installation_sources.status = 'active'
   AND installation_sources.agent_id = 'opencode'
 GROUP BY users.handle, installations.id, installations.name
 ORDER BY users.handle, installations.name;
```

On each returned machine, run the reviewed 0.5.0 checkout without `sync`:

```sh
node packages/connector/bin/viberacing.mjs upgrade-preflight
```

The command reads bounded regular `config.json` and pending files, and streams `state.json` without
a whole-file size cap. It extracts only each configured OpenCode source's sequence and individually
bounded migration fields; unrelated ledgers are skipped. It emits no source IDs, paths, usage, or
identity. Exit 0 means every accepted OpenCode source has either an exact current confirmed 0.4.4
cutover or an already validated 0.5.0 migration. Exit 1 with `opencode_cutover_required` means that
machine is still outstanding and prints exactly:

```sh
npx --yes @viberacing/connector@0.4.4 sync
```

On the affected machine run `npx --yes @viberacing/connector@0.4.4 doctor --repair`, then the
command above, then repeat `upgrade-preflight`. An offline or partial collection, a one-off version
report, and server metadata alone do not establish confirmation. A pending snapshot, unfinished
cutover, or local sequence above the confirmed sequence also requires the same 0.4.4 recovery.

Claude, OpenCode, Kimi, Qwen, and Gemini remain combined local histories within each store;
Antigravity separation remains explicit per capture source. This rollout must not add provider
identity to any request or claim per-account attribution where an upstream usage event lacks it.

For the 0.4.3 rollout, the all-agent browser handler is the new supported baseline. After npm
`latest` is verified as 0.4.3, set the official Railway service to
`VIBERACING_MIN_CONNECTOR_VERSION=0.4.3`; never make that production change before the immutable npm
package is installable. This deliberately turns the 0.4.3 repair into a required update even though
the wire protocol remains backwards-compatible.

The 0.4.3 server deployment must keep the existing floor before publication. A newer one-off CLI
version is recorded only as CLI telemetry: the home notice, computer-card notice, and all-agent Sync
action use the server-confirmed installed runtime and OS-handler protocol. A pending connect/repair
attestation is not confirmed until the server returns its exact random attestation ID.

Ordinary releases also do not change Railway. The official service permanently uses
`VIBERACING_CONNECTOR_DISTRIBUTION=npm` after rollout, while self-hosted deployments default to
`archive`. There are no npm package-name or version environment variables.

## Completed npm bootstrap and recovery reference

The one-time npm rollout completed on 2026-08-25. Connector 0.4.0 created the package through an
interactive 2FA bootstrap, 0.4.1 was the first GitHub-tagged Trusted Publisher release with
provenance, and 0.4.2 completed the production hook lifecycle validation. The official Railway
service now uses `VIBERACING_CONNECTOR_DISTRIBUTION=npm`.

The controls below are retained for audit and recovery if the package or publisher configuration
must be recreated. Do not repeat the bootstrap for ordinary releases and never republish or reuse an
existing immutable version. Ordinary releases follow the procedure at the start of this document.

### 1. Audit npm ownership

The project owner must continue to:

- control the npm account or organization for the `@viberacing` scope;
- require two-factor authentication for authorization and writes;
- confirm that `@viberacing/connector` still belongs to the project;
- avoid long-lived automation tokens.

During the completed bootstrap, Railway remained on:

```text
VIBERACING_CONNECTOR_DISTRIBUTION=archive
```

### 2. Historical interactive bootstrap command

This sequence records how the package was created. Do not run it for an existing package version. A
future recovery bootstrap would require an exact reviewed `main` commit and npm 2FA, and the
connector version would have to match `packages/connector/package.json` without reusing an existing
version.

```bash
git status --short
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm --filter @viberacing/connector prepack
git diff --exit-code
corepack pnpm verify
corepack pnpm connector:package:check
cd packages/connector
npm pack --dry-run
npm publish --access public --tag latest
```

Verify the immutable package and tag:

```bash
npm view @viberacing/connector version
npm view @viberacing/connector dist-tags.latest
npx --yes @viberacing/connector@latest --version
```

All three versions must match `package.json`. Do not proceed if package contents, the version, or
`latest` differs.

### 3. Configure the protected GitHub environment (completed; audit before changes)

The GitHub `npm-production` environment must remain restricted to **Protected branches only**, with
`main` covered by the repository's branch ruleset. Do not allow tags or unprotected branches.

For every audit, do not store a publish token in the environment.

If the repository has more than one maintainer, also require a reviewer, prevent self-review, and
disable administrator bypass. If this setup must be recreated, select **Protected branches only**.

Always confirm that `main` is covered by the repository's branch ruleset.

Only then configure the publisher.

This restriction is part of the publishing security boundary. A release event is associated with its
tag and can use the workflow version stored in that tag; only the unprivileged request workflow runs
there. The OIDC publisher is triggered through `workflow_run`, whose ref is the protected default
branch. Restricting the environment to protected branches prevents a tag-modified copy of
`publish-connector.yml` from obtaining the same Trusted Publisher identity directly.

Verify the environment before every publisher configuration change:

```bash
gh api repos/Tah10n/viberacing/environments/npm-production \
  --jq '.deployment_branch_policy'
```

It must report `protected_branches: true` and `custom_branch_policies: false`. Do not publish or
change the Trusted Publisher if the environment is absent or unrestricted.

### 4. Configure npm Trusted Publisher (completed; audit before changes)

The npm package settings must retain this exact configuration:

```text
Provider: GitHub Actions
Organization or user: Tah10n
Repository: viberacing
Workflow filename: publish-connector.yml
Environment name: npm-production
Allowed action: npm publish
```

The publisher uses only the workflow filename, not `.github/workflows/publish-connector.yml`.
Recheck that the matching GitHub `npm-production` environment is restricted to protected branches
and has no publish token whenever the Trusted Publisher is changed.

### 5. Verify every OIDC release

After publishing each exact GitHub Release, confirm:

- **Publish connector** succeeded;
- the immutable version exists in npm and `latest` moved to it;
- npm displays provenance;
- the workflow used no `NPM_TOKEN` or `NODE_AUTH_TOKEN`;
- `npx --yes @viberacing/connector@latest --version` prints the new version.

npm scans newly published packages before making them installable. The publish workflow therefore
waits up to 30 minutes for both the exact version and `dist-tags.latest` to become visible. If the
publish step succeeded but the runner stopped before verification, rerun the workflow. It compares
the local tarball integrity, repository metadata, and `gitHead` with the immutable npm package. An
exact match skips the second publish and resumes bounded verification; any mismatch fails closed for
manual security review.

### 6. Keep npm publishing access tight

Package **Settings → Publishing access** must remain set to **Require two-factor authentication and
disallow tokens**. Keep legacy publish and automation tokens removed, and recheck the Trusted
Publisher configuration after any access change.

### 7. Current official production

The npm connect, `doctor --repair`, uninstall, and Codex hook-trust lifecycle were verified before
the official service switched. Railway must retain:

```text
VIBERACING_CONNECTOR_DISTRIBUTION=npm
```

Confirm the dashboard renders:

```bash
npx --yes @viberacing/connector@latest connect --origin https://viberacing.up.railway.app
```

Normal releases never change the distribution variable. A full uninstall and reconnect creates a new
Codex source identity, so the user must review the new Vibe Racing `Stop` hook through `/hooks`;
routine `doctor --repair` preserves the trusted command identity.

## Distribution rollback

If the npm registry or npm distribution causes a problem:

1. Set only `VIBERACING_CONNECTOR_DISTRIBUTION=archive` in Railway.
2. Redeploy the web service.
3. Confirm the dashboard again shows the same-origin archive commands.

No database migration, device-token rotation, account reconnect, or connector data change is
required. Existing installations keep working. Do not delete the npm package, attempt to roll back
an immutable publication, or reuse the published version.
