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
  public IPv4 addresses, local user-home paths, and printable metadata inside binary files.
- Black-box regression cases for safe examples, secret-shaped values, personal email, local paths,
  environment files, and staged-snapshot isolation.
- Black-box documentation cases for valid links, missing files and anchors, duplicate anchors, and
  attempts to escape the repository root.
- Tracked symbolic links are rejected before repository checks can follow them.
- A complete-reachable-history gate that refuses shallow clones and scans refs, commit messages,
  every historical path/blob, forbidden modes, oversize objects, and printable binary metadata, with
  six black-box cases including deleted-history and unreachable-object scope.
- Pinned Node, pnpm, and Rust toolchains with committed pnpm and Cargo lockfiles.
- A pnpm workspace with release quarantine, trust and source policy, exact external direct
  dependencies in every bounded workspace, `workspace:*` internal references, private workspace
  manifests, and install-script denial by default.
- Prettier, Markdownlint, CSpell 10.0.1, YAML/configuration policy, and Rust workspace gates.
- An offline external-link gate with 12 reviewed hosts, HTTPS/credential/port/query/address rules,
  no dormant host permissions, and eight black-box cases. A separate online mode pins public DNS
  results, sends no credentials, follows no redirects, and is excluded from deterministic PR CI.
- A deterministic dependency inventory covering 194 locked npm packages, zero Cargo dependencies,
  two pinned GitHub Actions, and one pinned local-development container. License expressions,
  installed manifests, every root/workspace importer, dependency scopes, direct notices, and
  external-artifact usage are checked with seven black-box cases.
- Positive and negative workflow-policy tests for action pins, permissions, secrets, shell
  interpolation, timeouts, complete-history checkout, checkout credentials, and forbidden triggers.
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

These checks are defense in depth. They do not prove that a file is safe, fully decode every binary
format, fully parse/render Mermaid, perform legal analysis, or replace manual staged-diff review and
GitHub secret scanning. Deterministic verification validates external-link policy but does not make
network requests. The hardened online link mode is currently blocked here because this environment
resolves public hosts through a non-public proxy address; it correctly failed closed. The CI
definition is locally parsed and policy-tested but has not run on GitHub because no remote
repository is configured yet.

## Phase 0 still pending

- A confirmed public maintainer identity, conduct-reporting channel, CODEOWNERS entry, and remote
  GitHub security/branch settings; private details will not be inferred from the workstation.
- Hosted CI evidence and a successful hardened online-link run from a public-DNS runner.

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
