# Releasing

The connector follows Semantic Versioning. The web application is deployed continuously, but a
protocol or shared user-experience change must be documented with the connector release it affects.
Never infer a GitHub release tag from package metadata alone, reuse an npm name/version pair, or
publish from a feature branch or pull-request workflow.

## Stable release process

Every version bump is an explicit, reviewable release pull request:

1. Start from an up-to-date `main` with no unrelated changes.
2. Choose the next stable connector version from the actual compatibility impact.
3. Update `packages/connector/package.json` and `CHANGELOG.md`.
4. Run `corepack pnpm --filter @viberacing/connector prepack` and commit the regenerated
   `packages/connector/lib/version.mjs`.
5. Run `corepack pnpm verify`, `corepack pnpm connector:package:check`, local smoke, browser E2E,
   the production image build, and the production dependency audit.
6. Merge only after `ci-required`, `Dependency review`, and every platform/browser/production job is
   green.
7. Create an annotated `vX.Y.Z` tag on that exact merge commit.
8. Create a non-draft, non-prerelease GitHub Release for that exact tag.
9. The `publish-connector.yml` workflow validates the tag, version, generated module, package
   metadata, main ancestry, clean package, npm availability, and full repository gate.
10. The workflow publishes `@viberacing/connector@X.Y.Z` with npm Trusted Publishing and moves
    `latest` to that stable version.
11. The workflow succeeds only after bounded registry checks find both the exact version and
    `dist-tags.latest === X.Y.Z`.

The workflow never modifies `package.json`, `CHANGELOG.md`, commits, or tags. It has no npm token or
password and does not pass `--provenance`; npm Trusted Publishing creates provenance automatically.
Prereleases are rejected by this stable workflow. A future `next` channel requires separate design
and review.

For protocol changes, preserve server-first ordering: deploy and verify a server that accepts the
old and new protocols, publish the compatible connector, and only then raise
`VIBERACING_MIN_CONNECTOR_VERSION` if the server intentionally stops supporting an older version.
That variable is a compatibility floor, not a latest-version tracker; normal patch and minor
releases do not change it.

Ordinary releases also do not change Railway. The official service permanently uses
`VIBERACING_CONNECTOR_DISTRIBUTION=npm` after rollout, while self-hosted deployments default to
`archive`. There are no npm package-name or version environment variables.

## First npm publication

Trusted Publisher configuration normally belongs to an existing npm package. The first publication
is therefore an explicit interactive bootstrap; GitHub Actions intentionally exits with
`CONNECTOR_RELEASE_BOOTSTRAP_REQUIRED` while the package is absent.

### 1. Prepare npm ownership

The project owner manually:

- creates or confirms the npm account or organization for the `@viberacing` scope;
- enables two-factor authentication for authorization and writes;
- confirms that `@viberacing/connector` is available or already belongs to the project;
- does not create a long-lived automation token.

Keep Railway on:

```text
VIBERACING_CONNECTOR_DISTRIBUTION=archive
```

### 2. Publish the first version interactively

Use the exact reviewed `main` commit and npm 2FA. The connector version must match
`packages/connector/package.json`; do not reuse it if it already exists.

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

### 3. Configure npm Trusted Publisher

In the npm package settings configure:

```text
Provider: GitHub Actions
Organization or user: Tah10n
Repository: viberacing
Workflow filename: publish-connector.yml
Environment name: npm-production
Allowed action: npm publish
```

Use only the workflow filename, not `.github/workflows/publish-connector.yml`. Configure the
matching GitHub `npm-production` environment without a publish token.

### 4. Verify OIDC on a real patch release

Prepare the next patch version through the normal release pull request. After publishing its exact
GitHub Release, confirm:

- **Publish connector** succeeded;
- the immutable version exists in npm and `latest` moved to it;
- npm displays provenance;
- the workflow used no `NPM_TOKEN` or `NODE_AUTH_TOKEN`;
- `npx --yes @viberacing/connector@latest --version` prints the new version.

### 5. Tighten npm publishing access

Only after successful OIDC publication, open package **Settings → Publishing access**, choose
**Require two-factor authentication and disallow tokens**, remove any legacy publish or automation
tokens, and recheck the Trusted Publisher configuration.

### 6. Switch official production once

First verify npm connect, `doctor --repair`, and uninstall on Linux, Windows, and macOS. Then set
this once in Railway and redeploy:

```text
VIBERACING_CONNECTOR_DISTRIBUTION=npm
```

Confirm the dashboard renders:

```bash
npx --yes @viberacing/connector@latest connect --origin https://viberacing.com
```

Normal releases never change the variable again.

## Distribution rollback

If the npm registry or npm distribution causes a problem:

1. Set only `VIBERACING_CONNECTOR_DISTRIBUTION=archive` in Railway.
2. Redeploy the web service.
3. Confirm the dashboard again shows the same-origin archive commands.

No database migration, device-token rotation, account reconnect, or connector data change is
required. Existing installations keep working. Do not delete the npm package, attempt to roll back
an immutable publication, or reuse the published version.
