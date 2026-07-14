# Implementation status

This page records only evidence that exists in the public working tree. The
[project plan](PROJECT_PLAN.md) remains the source of intended behavior.

## Current phase

Phase 0, public foundation, is in progress. No application service, production deployment, released
connector, real-user ingestion, or verified ranking exists.

## Implemented and locally verified

- Public-safe project, security, contribution, and agent guidance.
- Apache-2.0 source license.
- Local checks for relative Markdown links and duplicate heading anchors.
- Local checks for common credentials, private-key files, personal email addresses, non-reserved
  public IPv4 addresses, and local user-home paths.
- Black-box regression cases for safe examples, secret-shaped values, personal email, local paths,
  environment files, and staged-snapshot isolation.
- Black-box documentation cases for valid links, missing files and anchors, duplicate anchors, and
  attempts to escape the repository root.
- Tracked symbolic links are rejected before repository checks can follow them.
- Pinned Node, pnpm, and Rust toolchains with committed pnpm and Cargo lockfiles.
- A pnpm workspace with release quarantine, trust and source policy, exact direct dependencies, and
  install-script denial by default.
- Prettier, Markdownlint, YAML/configuration policy, and Rust workspace gates.
- Positive and negative workflow-policy tests for action pins, permissions, secrets, shell
  interpolation, timeouts, checkout credentials, and forbidden triggers.
- A secretless, read-only GitHub Actions CI definition and bounded weekly Dependabot configuration.
- A loopback-only disposable PostgreSQL Compose service pinned to a version and index digest.
- Cross-platform root verification entry point: `pnpm run verify`.

The local Compose smoke test pulled the pinned index, reached `healthy`, exposed only
`127.0.0.1:54329`, returned the expected synthetic database and user from a read-only query, and
then removed its test container, network, and volume.

These checks are defense in depth. They do not prove that a file is safe, scan binary metadata,
validate external links, or replace manual staged-diff review and GitHub secret scanning. The CI
definition is locally parsed and policy-tested but has not run on GitHub because no remote
repository is configured yet.

## Phase 0 still pending

- Remaining community health, governance, DCO, issue, pull-request, and release-policy files.
- Threat model, abuse cases, privacy data map, compatibility policy, architecture views, and ADRs.
- A confirmed public maintainer identity, conduct-reporting channel, CODEOWNERS entry, and remote
  GitHub security/branch settings; private details will not be inferred from the workstation.
- External-link, spelling, license inventory, history secret scan, and hosted CI evidence.

## Not implemented yet

Every product feature remains proposed, including the web interface, authentication, passkeys,
application database schema, ingest API, scoring jobs, Codex connector, release signing, deployment,
and public beta operations.

## Evidence commands

Run from the repository root:

```text
pnpm run verify
pnpm run check:public:staged
git diff --cached --check
```

The staged check reads blobs from the Git index, not potentially different working-tree copies.
Review `git diff --cached` manually before every commit.
