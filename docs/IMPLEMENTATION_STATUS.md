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
- Governance, maintainer, conduct, DCO, support, roadmap, changelog, release, trademark, and
  third-party notice policies.
- Structured bug, feature, documentation, and pull-request forms that warn against sensitive data
  and do not request contact details, raw logs, screenshots, or account identifiers.
- Community-health policy validation and black-box regression cases for missing policies, invalid
  issue forms, automatic assignment, unresolved ownership, modified DCO text, and missing privacy
  warnings.
- A fail-closed publication-readiness checker with regression coverage for GitHub remote,
  MAINTAINERS/CODEOWNERS agreement, protected policy ownership, private conduct reporting, and
  private vulnerability reporting state.
- A repository-scoped design threat model with assets, attacker capabilities, trust boundaries,
  realistic/out-of-scope stories, required mitigations, implemented-versus-planned status, and
  severity calibration.
- Twenty structured abuse cases covering identity/source/scoring, pairing/device/connector,
  web/privacy/content, edge/database/admin/supply-chain, deletion, and resource exhaustion.
- A privacy classification and field inventory with prohibited data, provider boundaries, user
  controls, logging rules, retention decisions, deletion, restore, and launch review gates.
- Planned system/container and enrollment, pairing, sync, public-read, deletion, and trusted-release
  Mermaid views.
- A fail-closed Codex compatibility policy and empty support matrix; no upstream or connector
  version is claimed supported without pinned schema/fixture/platform evidence.
- An ADR lifecycle/template and six accepted design decisions covering Community trust, multi-source
  aggregation, identity/device authority, edge/service/database isolation, CarRecipe, and public
  repository safety.
- Architecture-contract validation and black-box regression cases for missing threat sections,
  duplicate/incomplete abuse cases, privacy-class drift, invalid/orphaned ADRs, unclosed Mermaid
  fences, and accidental compatibility claims.

The local Compose smoke test pulled the pinned index, reached `healthy`, exposed only
`127.0.0.1:54329`, returned the expected synthetic database and user from a read-only query, and
then removed its test container, network, and volume.

These checks are defense in depth. They do not prove that a file is safe, scan binary metadata,
fully parse/render Mermaid, validate external links, or replace manual staged-diff review and GitHub
secret scanning. The CI definition is locally parsed and policy-tested but has not run on GitHub
because no remote repository is configured yet.

## Phase 0 still pending

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

`pnpm run check:publication` is intentionally failing in this pre-public tree. It becomes a required
passing gate only after the public maintainer identity, CODEOWNERS, GitHub remote, and private
reporting settings are real and verified.

The staged check reads blobs from the Git index, not potentially different working-tree copies.
Review `git diff --cached` manually before every commit.
