# Roadmap

This roadmap communicates order and exit criteria, not dates or delivery promises. The detailed
[project plan](docs/PROJECT_PLAN.md) is canonical. Security and privacy gates can delay, split, or
stop any phase.

## Phase 0 — Public foundation

- Establish the public-data boundary, repository checks, pinned toolchains, and read-only CI.
- Document governance, contribution, support, release, dependency, and reporting policies.
- Complete the threat model, privacy data map, architecture views, compatibility policy, and initial
  ADRs.
- Configure real hosted maintainers, CODEOWNERS, private reporting, branch protection, and secret
  scanning before announcement.

Exit criterion: the repository is safe to publish and its claims match executable evidence.

## Phase 1 — Visual prototype with synthetic data

- Build the responsive EN/RU race, accessible leaderboard and profile shell, three themes,
  reduced-motion behavior, and deterministic pixel renderer.
- Use synthetic fixtures only, without authentication or real ingestion.
- Complete browser visual, accessibility, localization, and performance evidence.

Exit criterion: contributors can evaluate the intended product without opening a trust or privacy
surface.

## Phase 2 — Identity and single-source vertical slice

- Introduce versioned language-neutral contracts and generated validators.
- Implement invite redemption, GitHub identity, passkeys, sessions, recovery, profile controls, and
  deletion foundations.
- Implement one source-bound connector flow, isolated ingest, scoring/finalization, and the
  Community disclaimer.

Exit criterion: one real user can pair and sync without prompts, email, credentials, repository
content, or raw account identifiers leaving the machine.

## Phase 3 — Multi-source and lifecycle hardening

- Add explicit new-source versus existing-source pairing, opaque multi-account aggregation, and
  same-source device deduplication.
- Add source pause/unlink, quarantine, retention, finalized-season immutability, abuse controls,
  backpressure, alerts, audit events, and kill switches. Default-off local gates now cover Ingest
  startup, all three public-ranking routes, all four pairing routes, new-source creation while
  preserving active existing-source pairing, and CarRecipe proposal creation/approval while
  preserving private read/reject, plus invite/OAuth/initial-passkey enrollment while preserving
  returning login/recovery. Deployed operation for every local gate remains open.
- Keep the profile cap and source count visible so adding devices cannot multiply one source.

Exit criterion: source multiplication cannot exceed the profile score cap or gain privilege, and
bounded infrastructure survives load tests.

## Phase 4 — Agent car proposal and connector packaging

- Add the versioned bounded CarRecipe proposal/approval flow without arbitrary content.
- Continue connector compatibility diagnostics from the locally implemented point-in-time Windows
  candidate admission check and its closed redacted local preview. A secretless Windows workflow now
  defines a locked release-profile portable copy/removal smoke without publishing its binary; obtain
  its hosted result, then complete real package install, upgrade, revoke, and uninstall tests plus a
  separately reviewed support-export path if one is needed.
- Produce signed, checksummed, SBOM- and provenance-backed connector artifacts.

Exit criterion: no arbitrary content or conversation text enters the service, and supported
connector artifacts pass release verification.

## Phase 5 — Staging-readiness foundation

- Prepare isolated staging services, databases, and protected deployment controllers without opening
  participant routes or a production cohort.
- Rehearse migrations, backups, restores, deletion, incident response, rollback, alerts, and SLOs.
- Prepare the abuse, accessibility, privacy, legal, licensing, and external-security review inputs
  that will be completed against the Phase 6–7 thin-MVP artifact.

Exit criterion: the staging topology and review inputs are ready, but no public-beta or
invite-cohort claim is made.

## Phase 6 — Proposed multi-agent thin client, hybrid onboarding, and canonical accounting

The Codex-only provider attribution, `UsageSyncV1` Edge/Ingest/database path, and unreleased
candidate connector cutover are implemented locally through ADRs 0071 and 0073. Additional readers,
the thin client, and hybrid onboarding below remain proposed.

- Generalize opaque sources and `UsageSyncV1` for supported coding agents. Provider is immutable on
  AgentSource, derived through the verified device/source binding, and rejected when supplied in a
  sync body.
- Ship one thin, auditable client with a bounded, fixture-backed reader per supported agent.
- Add admission-gated anonymous or GitHub device-flow enrollment. Anonymous profiles can register a
  first passkey and later perform passkey-bound source/device actions without linking GitHub.
  GitHub-linked profiles that have never activated a passkey use one fresh, single-purpose
  device-flow/WebAuthn authority; it cannot reset passkey history or replace recovery.
- Bound no-passkey anonymous ownership to a server-clock 90-day lease renewable only by a valid
  bootstrap-session proof, never sync. Expiry hides the profile and pauses sources, permits only
  first-passkey or GitHub promotion for 30 days without automatic reactivation, then uses a separate
  bounded Jobs-only system-expiry cleanup.
- Generate one credential-store-protected sync key per device authority with no plaintext-file or
  product export/copy workflow, bind it to exactly one source, and allow multiple independently
  revocable device keys on that source. Do not claim hardware-backed non-exportability; a
  compromised user process remains able to extract or use local key material.
- Derive one canonical provider-reported daily total: prefer the documented aggregate, otherwise sum
  only documented disjoint components; never double count cached, reasoning, thought, cumulative, or
  replayed details.
- Partition first-run backfill by derived ISO season so a previous-week grace-deadline race cannot
  quarantine the independently submitted current week.
- Keep model names, session counts, prompts, paths, and provider-shaped raw components outside the
  payload.

Exit criterion: each reader fails closed on ambiguous semantics and emits the same minimal
daily-total contract; identity/device authority has no GitHub-only, shared-key, or indefinite-orphan
gap; ownership-expiry, promotion-grace, Jobs-cleanup, provider-relabel, and cross-season quarantine
regressions fail closed.

## Phase 7 — Direct token-total leaderboard (local Codex slice implemented)

ADR 0072 implements the direct metric, projection, default-off route, and EN/RU token-first browser
consumer for the current Codex-only Community path. Deployment and the complete multi-agent Phase 6
artifact remain pending.

- Cut over newly created seasons to `community_tokens_v1` and public `weeklyTokenTotal`.
- Rank the direct exact weekly sum with shared ranks for equal totals; do not apply a logarithm,
  active-day/streak bonus, provider/model/cost multiplier, or secondary competitive tie breaker.
- Preserve finalized `community_v1` score seasons unchanged and never compare different metric
  versions in one rank.
- Keep cars and themes cosmetic presentation of the same ranking.

Exit criterion: a larger admitted token total never places behind a smaller total, migration and
overflow tests fail closed, and EN/RU copy explains that provider tokenizers differ.

## Phase 8 — Thin MVP staging and invite beta

- Build and stage the complete Phase 6–7 artifact; the legacy Codex-only foundation is not a
  substitute.
- Complete migration, backup/restore, deletion replay, containment, monitoring, rollback, signing,
  provenance, accessibility, abuse, privacy, legal, licensing, documentation, and external-security
  evidence against that artifact.
- Deploy production only after the canonical public-beta gates pass, then start with a bounded
  invite cohort and expand only from reviewed reliability, cost, abuse, support, and deletion
  evidence.

Exit criterion: operational evidence supports a small thin-MVP public beta with documented residual
risks; optional MCP and Verified remain disabled and non-blocking.

## Phase 9 — Proposed optional MCP submission

- Add MCP only as an optional pairing-bound transport for the same reviewed `UsageSyncV1` total.
- Do not treat MCP compatibility as token telemetry or as evidence that an agent/provider is
  supported.
- Keep the thin client and leaderboard independently shippable with MCP disabled.

Exit criterion: negative authorization, replay, schema, privacy, and disable-gate tests pass without
widening Ingest or profile authority.

## Phase 10 — Proposed per-provider Verified tier

- Add a provider only where a server-verifiable usage API and minimal-scope authorization contract
  exist.
- Map Verified usage through the same canonical-total rule; provenance changes trust labeling, not
  arithmetic.
- Keep every provider integration independently disabled until implemented and reviewed.

Exit criterion: Community cannot claim Verified state, provider credentials never reach logs or the
repository, and accounting parity tests pass.

## Explicitly deferred

- Each Verified provider integration until a server-verifiable source exists and is reviewed.
- Prizes, money, access, or privileges based on Community rankings.
- Arbitrary uploads or executable customization.
- Claims of ranking all users of any coding agent rather than participating Vibe Racing profiles.
