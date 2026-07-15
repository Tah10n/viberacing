# Changelog

All notable project changes will be documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and released versions will follow Semantic
Versioning where its guarantees are applicable.

## [Unreleased]

### Added

- Public-safe repository baseline, implementation plan, security invariants, and contribution
  guidance.
- Pinned Node, pnpm, Rust, PostgreSQL, dependency, formatting, documentation, and CI foundations.
- Governance, conduct, DCO, support, roadmap, release, trademark, and third-party notice policies.
- Structured issue and pull-request templates with public-data safeguards.
- Community-health and publication-readiness policy checks with regression coverage.
- Repository-scoped threat model, structured abuse cases, privacy data map, system/data-flow views,
  fail-closed compatibility policy and matrix, and seven accepted ADRs.
- Architecture-contract checks for policy sections, privacy classes, abuse-case completeness, ADR
  lifecycle/index integrity, empty Codex support state, and Mermaid fence structure.
- Complete reachable-history and printable binary-metadata leak scans with shallow-clone rejection.
- Offline spelling, reviewed external-link policy, and deterministic dependency/license inventory
  covering the exact npm lock graph, pinned Actions, and local PostgreSQL image.
- Synthetic EN/RU Next.js race, leaderboard, demo profile, three code-native themes, reduced-motion
  controls, and deterministic pixel-car renderer.
- Strict frontend lint/type/build gates plus unit, interaction, accessibility, CSP/header, scoring,
  localization, and data-boundary tests with enforced coverage thresholds.
- Integrity-bound cross-platform npm license metadata and an expiring reviewed override for the
  unused Next.js image-optimization graph.
- Manifest-driven production asset budgets with path, source-map, font, standalone-output, and
  black-box regression checks.
- A documented AI-generated social preview, accessible alternative text, reproducible metadata
  sanitation, and a fail-closed PNG structure/chunk policy with regression coverage.
- Strict server-only public-origin validation for absolute social metadata, with HTTPS-only hosted
  origins, loopback-only development HTTP, safe reserved defaults, and negative tests.
- Canonical closed JSON Schema contracts for connector sync, bounded acknowledgement, and public
  problem details, with generated readonly TypeScript validators and pre-implementation OpenAPI
  components.
- Dependency-free, traversal-budgeted runtime contract validation plus manifest/schema/generated
  drift gates and black-box regression coverage.
- SQL-first identity/source/device/pairing/deletion persistence with a checksum-ledgered migration,
  deterministic synthetic invariant fixtures, and an isolated PostgreSQL CI integration gate.
- Procedure-only identity lifecycle capabilities for bounded invite issuance, atomic enrollment,
  exact-session initial-passkey challenges, session rotation/revocation, synchronous deletion
  lock-down, opaque purge queueing, and bounded audit references.
- Procedure-only pairing capabilities for new or existing opaque sources, session/passkey-bound
  approval, minimal external Ed25519 verification material, exact single-device activation, and
  public 32-source/64-authority safety ceilings.
- Procedure-only private source/device inventory, immediate source pause and device revoke, plus
  fresh-step-up source reactivation/unlink with terminal unlink and recursive authority revoke.
- Procedure-only passkey login and multi-passkey management with minimal verification lookup,
  credential-derived sessions, private inventory, bounded add/revoke, and exact step-up provenance.
- Procedure-only restricted recovery with passkey-protected 8-to-16-code batch rotation, used-PHC
  scrubbing, minimal selector lookup, a one-time ten-minute replacement authority, and atomic
  replacement-passkey/session completion.

### Security

- Patched the transitive Next.js PostCSS resolution from 8.4.31 to 8.5.19 for GHSA-qx2v-qp2m-jg93,
  with an exact expiring override and removal condition.
- Pinned pnpm to a repository-local virtual store for deterministic CI/developer dependency layout.
- Kept the unused native Sharp graph absent while satisfying Next.js's type-only declaration with a
  `never` sentinel and a regression-tested production import ban.
- Made official-registry audits fail on moderate-or-higher advisories, rejected future-dated
  override reviews, and restored extraneous-install detection alongside cross-platform metadata.
- Exact staged-blob scanning for common secret, personal-data, local-path, symlink, and submodule
  hazards.
- Read-only, secretless pull-request CI with pinned actions and policy-tested workflow constraints.
- Explicit publication blockers for real maintainers, CODEOWNERS, private reporting, and hosted
  controls rather than unsafe inferred identities.
- Per-response nonce CSP, browser isolation/capability headers, local-only preference storage,
  closed-enum car recipes, and score-only client fixtures with no raw token buckets.
- Refined pairing so a one-time poll token is stored only as a keyed verifier and cannot activate a
  device without fresh browser passkey approval and Ed25519 possession proof over an immutable
  pending key.
- Added separate `NOLOGIN` owner/Web/Ingest/Jobs/Admin groups, forced owner-only RLS, revoked
  `PUBLIC` database/schema access, safe database/role search paths, zero direct runtime table
  grants, and exact pending-key/source/device binding enforced by state triggers and composite
  foreign keys.
- Bound every implemented profile action to possession of an active session ID and keyed verifier,
  bound challenges to the exact session/profile pair, removed caller-selected profile IDs from the
  procedure surface, and added replay, expiry, IDOR, rollback, role-separation, and deletion-revoke
  PostgreSQL scenarios using synthetic data only.
- Prevented short-code-only activation, post-approval competing-profile takeover, poll replay,
  source-choice swaps, key rebinding, and authority fan-out beyond the public database ceilings;
  external WebAuthn and Ed25519 verification remain mandatory before the matching procedures are
  called.
- Added deterministic cross-connection lock races proving first-winner pairing approval and atomic
  enforcement of the 32-source and 64-live-authority ceilings, including exclusion of expired
  approvals from live authority.
- Added lifecycle IDOR, replay, quarantine, stale-challenge, audit-rollback, and role-denial
  scenarios plus cross-connection races proving pause dominates concurrent approval and unlink
  dominates concurrent activation without leaving protected authority live.
- Added observed identity races proving one-winner invite enrollment, initial-passkey challenge
  consumption, and session rotation plus deletion dominance over concurrent rotation without stale
  authority or losing transaction artifacts.
- Made all fourteen race gates observe every tagged contender in the holder's PostgreSQL blocker
  chain before releasing the holder, removing timer-only concurrency evidence.
- Made passkey race preservation assertions fail when an expected row is missing and added a static
  regression check that rejects missing-row-unsafe scalar-subquery `IF NOT` assertions.
- Made passkey revoke terminal, protected the last active key, preserved monotonic sign state, and
  atomically removed the credential's browser, unused ceremony, and pending pairing authority;
  observed races prove one login-challenge winner and revoke-dominant final state under contention.
- Documented revision 0005 as a security upgrade: it invalidates pre-revision authentication
  challenges, cancels approved-but-not-activated pairings, and revokes legacy active sessions for
  profiles that already have passkeys so they must sign in again under attributable provenance.
- Added recovery replay, scope, PHC scrub, deletion, role-denial, lifetime-cap, and atomic rollback
  scenarios plus observed races proving one-code/one-authority use, fresh rotation dominates
  old-code start, and recovery completion dominates old-passkey login. Protective timestamps are
  captured after row-lock acquisition so concurrent authority created after statement start cannot
  survive or make revocation predate creation.

No version has been released.
