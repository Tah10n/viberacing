# Implementation status

This page records only evidence that exists in the public working tree. The
[project plan](PROJECT_PLAN.md) remains the source of intended behavior.

## Current phase

Phase 0, public foundation, is in progress. No application service, production
deployment, released connector, real-user ingestion, or verified ranking exists.

## Implemented baseline

- Public-safe project, security, contribution, and agent guidance.
- Apache-2.0 source license.
- Local checks for relative Markdown links and duplicate heading anchors.
- Local checks for common credentials, private-key files, personal email
  addresses, non-reserved public IPv4 addresses, and local user-home paths.
- Black-box regression cases for safe examples, secret-shaped values, personal
  email, local paths, environment files, and staged-snapshot isolation.
- Black-box documentation cases for valid links, missing files and anchors,
  duplicate anchors, and attempts to escape the repository root.
- Cross-platform root verification entry point: `pnpm verify`.

These checks are defense in depth. They do not prove that a file is safe, scan
binary metadata, validate external links, or replace manual staged-diff review
and GitHub secret scanning.

## Not implemented yet

Every feature outside the baseline above remains proposed, including the web
interface, authentication, passkeys, database, ingest API, scoring jobs, Codex
connector, release signing, deployment, and public beta operations.

## Evidence commands

Run from the repository root:

```text
pnpm verify
pnpm run check:public:staged
git diff --check
```

The staged check reads blobs from the Git index, not potentially different
working-tree copies. Review `git diff --cached` manually before every commit.
