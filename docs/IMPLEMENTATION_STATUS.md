# Implementation status

This page records only evidence that exists in the public working tree. The
[project plan](PROJECT_PLAN.md) remains the source of intended behavior.

## Current phase

Phase 1, visual prototype with synthetic data, is in progress locally. The Phase 0
hosted-publication controls are still blocked on real maintainer identities and GitHub
configuration. No authentication, application database, production deployment, released connector,
real-user ingestion, or verified ranking exists.

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
- A deterministic dependency inventory covering 441 locked npm packages, zero Cargo dependencies,
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
- A strict Next.js 16 and React 19 web workspace with a synthetic EN/RU race, accessible
  leaderboard, demo profile, three repository-owned CSS/canvas themes, reduced-motion controls, and
  a deterministic 16-by-8 pixel-car renderer.
- A client payload that contains bounded daily scores and public presentation fields, never raw
  token buckets, account identifiers, source identifiers, URLs, email addresses, or local paths.
- A closed-enum CarRecipe boundary with fixed sprites and palettes; arbitrary HTML, CSS, SVG, URLs,
  colors, text, and uploads are not accepted.
- Per-response nonce CSP, browser-isolation and capability headers, no remote image patterns,
  globally disabled Next.js image optimization, production HSTS, disabled framework branding, and an
  explicit Turbopack repository root that prevents parent-workspace inference.
- Device-local persistence limited to locale, theme, and motion preferences. The synthetic preview
  has no accounts, analytics, trackers, remote fonts, or runtime secrets. Its only environment
  setting is a strictly parsed, server-only public origin for absolute social metadata; hosted
  deployment without a real HTTPS DNS value remains forbidden.
- Forty-six unit, component, interaction, security-header, localization, scoring, configuration, and
  accessibility tests. The coverage gate currently reports 98.57% statements, 91.01% branches, 100%
  functions, and 98.51% lines over product components and libraries; framework entrypoints are
  verified by the production build instead of artificial unit coverage.
- A root verification pipeline that now includes web lint, strict type checking, coverage, and a
  production Next.js build on every deterministic CI run.
- A manifest-driven production artifact gate with nine black-box cases and enforced limits for
  initial raw/gzip bytes, application/CSS gzip bytes, asset count, source maps, fonts, path safety,
  and standalone output. The current initial route is 180,646 gzip bytes across seven assets.
- A lock-integrity-bound metadata cache for platform-specific npm packages, ten license-checker
  regression cases, and two expiring reviewed overrides: one resolves Next.js to patched
  `postcss@8.5.19`, and one removes unused `sharp`/libvips code while Next.js image optimization
  remains disabled. The official registry audit reports zero known vulnerabilities after resolution.
- A project-generated social preview with accessibility text, checksum/source record, explicit AI
  disclosure, and byte-preserving removal of service C2PA metadata. The public-file gate now parses
  PNG structure and CRCs and rejects unreviewed ancillary chunks; seven focused policy assertions
  and a malformed-PNG black-box case cover the boundary.

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

Local responsive, computed-contrast, interaction, browser-console, development-header, and
production-header observations are recorded in the
[Phase 1 browser matrix](testing/PHASE1_BROWSER_MATRIX.md), including the light-theme contrast
defect found and corrected during review. The report names its local-only limitations.

## Phase 0 still pending

- A confirmed public maintainer identity, conduct-reporting channel, CODEOWNERS entry, and remote
  GitHub security/branch settings; private details will not be inferred from the workstation.
- Hosted CI evidence and a successful hardened online-link run from a public-DNS runner.

## Phase 1 still pending

- Browser-level responsive visual snapshots for all themes and both languages.
- Keyboard-only, screen-reader, forced-colors, and cross-browser release evidence.
- Runtime Core Web Vitals for animation-on and reduced-motion modes.

## Not implemented yet

Authentication, invitations, passkeys, application database schema, ingest API, scoring jobs, Codex
connector, release signing, deployment, and public beta operations remain proposed. The current
scoring and ranking code operates only on clearly synthetic in-process fixtures.

## Evidence commands

Run from the repository root:

```text
pnpm run verify
pnpm run check:web-build
pnpm run check:public:staged
git diff --cached --check
```

`pnpm run check:publication` is intentionally failing in this pre-public tree. It becomes a required
passing gate only after the public maintainer identity, CODEOWNERS, GitHub remote, and private
reporting settings are real and verified.

The staged check reads blobs from the Git index, not potentially different working-tree copies.
Review `git diff --cached` manually before every commit.
