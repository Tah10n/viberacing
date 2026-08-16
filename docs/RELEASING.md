# Releasing

Vibe Racing does not yet have an authoritative GitHub Release. Do not infer a release tag from a
package version alone.

## Versioning

The connector follows Semantic Versioning. The web application is deployed continuously, but a
protocol or shared user-experience change must be documented with the connector release it affects.

## Release checklist

1. Start from an up-to-date `main` with no unrelated changes.
2. Choose the connector version from the actual compatibility impact.
3. Update `packages/connector/package.json` and `CHANGELOG.md` in a focused pull request.
4. Run `corepack pnpm verify`.
5. Run `corepack pnpm local:up`, `corepack pnpm local:test`, and `corepack pnpm local:down` when
   Docker is available.
6. Merge only after every required GitHub check succeeds.
7. Create an annotated `vX.Y.Z` tag on the verified merge commit.
8. Create a GitHub Release from that tag with user-visible changes, compatibility notes, and known
   limitations.
9. Verify the tag and release point at the intended commit.

If the connector is later published to npm, use npm trusted publishing with provenance and run
`corepack pnpm connector:package:check`. The command invokes `npm pack --dry-run` against
`packages/connector`, the same package root and validation used by CI.
