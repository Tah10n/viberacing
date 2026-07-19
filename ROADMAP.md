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

## Phase 5 — Staging and public beta

- Deploy isolated services and databases to Railway behind Cloudflare controls.
- Exercise migrations, backups, restores, deletion, incident response, rollback, alerts, and SLOs.
- Run an invite-only beta, abuse review, accessibility audit, and privacy review.

Exit criterion: operational evidence supports a small public beta with documented residual risks.

## Explicitly deferred

- A Verified league until a server-verifiable OpenAI source exists and is reviewed.
- Prizes, money, access, or privileges based on Community rankings.
- Arbitrary uploads or executable customization.
- Claims of ranking all Codex users rather than participating Vibe Racing profiles.
