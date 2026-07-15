# Implementation status

This page records only evidence that exists in the public working tree. The
[project plan](PROJECT_PLAN.md) remains the source of intended behavior.

## Current phase

Phase 1 product code is locally complete, with the manual release-evidence items below still open.
The Phase 2 language-neutral contract and SQL persistence foundations now include database-only
passkey login, multi-passkey management, and restricted recovery; a Phase 3 database-only
source/device lifecycle slice has also started. Phase 0 hosted-publication controls remain blocked
on real maintainer identities and GitHub configuration. No authentication HTTP route,
OAuth/Argon2id/WebAuthn application flow, production deployment, released connector, real-user
ingestion, or verified ranking exists.

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
- A loopback-only disposable PostgreSQL Compose service plus an opt-in portless `tmpfs` integration
  service, both pinned to the same version and index digest.
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
- Twenty-one structured abuse cases covering identity/source/scoring, pairing/device/connector,
  web/privacy/content, edge/database/admin/supply-chain, deletion, and resource exhaustion.
- A privacy classification and field inventory with prohibited data, provider boundaries, user
  controls, logging rules, retention decisions, deletion, restore, and launch review gates.
- Planned system/container and enrollment, login/recovery, pairing, sync, public-read, deletion, and
  trusted-release Mermaid views.
- A fail-closed Codex compatibility policy and empty support matrix; no upstream or connector
  version is claimed supported without pinned schema/fixture/platform evidence.
- An ADR lifecycle/template and seven accepted design decisions covering Community trust,
  multi-source aggregation, identity/device authority, restricted recovery, edge/service/database
  isolation, CarRecipe, and public repository safety.
- Architecture-contract validation and black-box regression cases for missing threat sections,
  duplicate/incomplete abuse cases, privacy-class drift, invalid/orphaned ADRs, unclosed Mermaid
  fences, and accidental compatibility claims.
- Three canonical JSON Schema 2020-12 contracts for a bounded Community connector sync, a
  non-sensitive sync acknowledgement, and stable problem details. Every object is closed; scalar and
  collection values are bounded; connector input has an executable writable-field allowlist that
  excludes identity, trust, rank, score, season, moderation, credentials, and prohibited data.
- Deterministically generated readonly TypeScript types, embedded validator wrappers, source digest,
  and OpenAPI 3.1 components with no advertised paths. A manifest/schema/drift checker has nine
  black-box cases for unknown fields, missing bounds, client-derived fields,
  unlisted/path-traversing schemas, unsupported keywords, missing date deduplication, and stale
  generated output.
- A dependency-free runtime contract validator with fail-closed reflection handling; strict
  calendar/UTC timestamp and safe-integer checks; depth, node, key, item, and issue budgets; and
  privacy-safe issue output that never echoes unknown property names or submitted values. Fifteen
  unit/security cases cover 100% of statements, lines, and functions plus 97.14% of branches.
- An idempotent cluster-role bootstrap for separate `NOLOGIN`, non-owner Web, Ingest, Jobs, Admin,
  and schema-owner groups. The default database and `public` schema capabilities are revoked;
  database and runtime-role search paths are scoped to `pg_catalog, pg_temp`; the migration
  principal retains explicit connection authority; unexpected group-role memberships fail closed.
- Six checksum-ledgered, transactional SQL migrations with bounded lock/statement execution and 14
  forced-RLS private tables for profiles, invites, sessions, passkeys, recovery codes and restricted
  authorities, session-bound challenges, opaque sources, pending/active/revoked device keys,
  pairing, bounded audit references, deletion work/tombstones, and schema revisions. There is
  intentionally no GitHub token, account email, prompt, repository, credential, arbitrary JSON, or
  free-form diagnostic column.
- Database constraints and triggers enforce unique GitHub bindings, normalized handles, keyed
  verifier lengths, Argon2id recovery-verifier shape, exact device-key/source/pairing binding,
  terminal unlink/deletion states, state-dependent timestamps, and bounded lifecycle values. The
  public-key record itself moves from authority-free pending state to one source/device, then only
  to revoked.
- A database policy checker with 23 black-box cases for migration drift/path/revision, transaction
  and timeout omissions, unsafe SQL features, `PUBLIC`/direct runtime grants, unsafe
  `SECURITY DEFINER`, role options, passwords, and owner membership. The real PostgreSQL gate runs
  deterministic synthetic fixtures in rollbacks and proves four runtime roles cannot read private
  tables or create API objects.
- A closed procedure-only API boundary: Admin can issue bounded, reasoned invites; Web can
  atomically redeem an invite, create an enrolling profile/session, create and consume exact-session
  challenges, register the initial passkey, rotate/revoke a possessed session, and request immediate
  profile lock-down plus a deletion job. Web can also start a bounded pairing, approve its exact
  immutable key and new/existing opaque-source choice after a consumed pairing step-up, expose
  minimal external signature-verification material, activate one exact source-bound device, and poll
  only bounded status. Web can privately list its own sources/devices, immediately pause an active
  source or revoke an owned device, and reactivate/unlink one exact source only after a fresh,
  consumed, source-bound step-up. Unlink atomically revokes all active source devices, cancels
  approved pairings, and invalidates unused source actions; normal user authority cannot lift
  quarantine. Ingest and Jobs have no identity/pairing/lifecycle function. Profile-scoped functions
  derive identity from an active session ID plus keyed verifier and do not accept a caller-selected
  profile ID.
- The same boundary can create a five-minute profile-free login challenge, expose only minimal
  active-passkey verification material, atomically mint a passkey-bound session after application
  verification, privately list owned passkeys, and add or revoke an exact passkey after a fresh
  target-bound step-up. Stored sign counters never decrease; the last active key cannot be removed;
  revocation closes the key's sessions, unused challenges, and pending pairing authority while
  preserving unrelated keys and already activated devices.
- The Web boundary can rotate an 8-to-16-code recovery batch only after a fresh exact-passkey
  `recovery_change` step-up, read only one opaque selector plus unused PHC for application
  verification, consume and scrub one code into a single recovery-only authority for at most ten
  minutes, and atomically complete exact replacement-passkey registration. Completion revokes old
  browser/passkey authority, cancels approved pairings, clears codes/challenges, and creates the
  normal session only after the replacement key exists. Activated source-bound devices remain
  separate and explicitly revocable; profile deletion revokes active recovery authority.
- PostgreSQL scenarios prove invalid invite rollback, absolute invite/session/challenge lifetimes,
  wrong-verifier denial, cross-profile challenge denial, one-time challenge/action use, old-session
  invalidation after rotation, typed-handle deletion binding, full rollback after failed deletion,
  synchronous browser/passkey/device revoke, source unlink, approved-pairing cancellation, opaque
  job queueing, audit-link redaction on profile purge, new/existing-source pairing, wrong-poll and
  replay denial, post-approval competing-profile rollback, exact activation, immutable pairing
  binding, inventory isolation, lifecycle IDOR/replay denial, quarantine separation, stale challenge
  invalidation, approved-pairing cancellation, recursive device revoke, audit-failure rollback, and
  the public ceilings of 32 lifetime sources and 64 active/unexpired-approved device authorities per
  profile. Passkey scenarios additionally prove exact credential/profile binding, unknown/revoked
  lookup equivalence, one-time login, atomic audit rollback, monotonic usage state, inventory
  isolation, add/revoke replay denial, last-key protection, and the public ceilings of 32 lifetime
  passkeys and 32 active sessions. Recovery scenarios additionally prove bounded batch rotation,
  minimal profile-free lookup, immediate used-PHC scrub, one-code/one-authority use, exact
  challenge/context completion, terminal authority, deletion revoke, activated-device preservation,
  oversized/replay/role denial, atomic rollback, and fail-closed behavior at the lifetime-passkey
  provenance ceiling. The procedures do not perform OAuth, Argon2id, WebAuthn, or Ed25519
  cryptographic verification; those application boundaries remain absent.
- Ten deterministic cross-connection races hold the relevant pairing or profile row, tag every
  session, and observe every contender in the holder's transitive PostgreSQL blocker chain before
  releasing it. PostgreSQL proves exactly one winner for a shared pairing, concurrent creation at
  the 32-source ceiling, concurrent approval at the 64-live-authority ceiling, pause dominating
  concurrent pairing approval, unlink dominating concurrent device activation, one winner for a
  shared passkey-login challenge, passkey revoke dominating concurrent login, one recovery code
  creating one authority, recovery-code rotation dominating concurrent old-code start, and recovery
  completion dominating concurrent old-passkey login. No protective race leaves browser, recovery,
  or pending device authority attached to a revoked credential, old code, or protected source. The
  recovery races also prove terminal timestamps are captured after lock acquisition, and missing
  expected challenge, credential, authority, session, code, or pairing rows fail closed rather than
  passing through SQL `NULL` semantics.
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
- A root verification pipeline that now includes contract generation/drift, lint, strict type
  checking and coverage, plus web lint, strict type checking, coverage, and a production Next.js
  build on every deterministic CI run.
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
then removed its test container, network, and volume. The separate database integration project also
reached `healthy`, validated and applied revisions 0001 through 0006 from the checksum manifest,
passed 14-table state/ownership/RLS assertions, ten observed lock-wait races, four relation-denial
matrices, seven cross-capability denials, and the identity, passkey, recovery, pairing, and
source/device lifecycle scenarios, then removed its portless container, network, and ephemeral
storage.

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

Authentication application flows, OAuth/cookie/CSRF handling, recovery Argon2id/pepper and generic
HTTP response handling, WebAuthn and Ed25519 cryptographic verification, anonymous
login/pairing/recovery edge rate limits and cleanup, remaining identity/ingest concurrent-connection
evidence, purge workers, ingest API, scoring jobs, Codex connector, release signing, deployment, and
public beta operations remain proposed. The current scoring and ranking code operates only on
clearly synthetic in-process fixtures; the application does not connect to revisions 0001
through 0006.

## Evidence commands

Run from the repository root:

```text
pnpm run verify
pnpm run check:contracts
pnpm run check:database
pnpm run test:database:integration
pnpm run check:web-build
pnpm run check:public:staged
git diff --cached --check
```

`pnpm run check:publication` is intentionally failing in this pre-public tree. It becomes a required
passing gate only after the public maintainer identity, CODEOWNERS, GitHub remote, and private
reporting settings are real and verified.

The staged check reads blobs from the Git index, not potentially different working-tree copies.
Review `git diff --cached` manually before every commit.
