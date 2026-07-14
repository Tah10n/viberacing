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

## Phase 1 — Contracts and identity

- Introduce versioned language-neutral contracts and generated validators.
- Implement GitHub identity, passkeys, sessions, invite-only enrollment, and deletion foundations.
- Create least-privileged database roles and auditable migrations.

Exit criterion: authorization and lifecycle invariants pass positive and negative integration tests.

## Phase 2 — Community race

- Build the EN/RU pixel-art weekly race and accessible leaderboard experience.
- Implement opaque multi-source profiles, bounded daily aggregation, scoring, finalization, and
  ranking.
- Keep every Community result clearly labeled self-reported and unverified.

Exit criterion: the web flow works end to end with synthetic data and no valuable benefit depends on
Community scores.

## Phase 3 — Native connector

- Implement the least-privileged Rust connector over allowlisted stable Codex App Server methods.
- Add pairing, local key protection, signed requests, replay resistance, resumable delivery, and
  compatibility diagnostics.
- Produce signed, checksummed, provenance-backed release artifacts.

Exit criterion: supported platforms pass clean-machine install, upgrade, revoke, and uninstall
tests.

## Phase 4 — Operations and public beta

- Deploy isolated services and databases to Railway behind Cloudflare controls.
- Exercise migrations, backups, restores, deletion, incident response, rollback, alerts, and SLOs.
- Run an invite-only beta, abuse review, accessibility audit, and privacy review.

Exit criterion: operational evidence supports a small public beta with documented residual risks.

## Explicitly deferred

- A Verified league until a server-verifiable OpenAI source exists and is reviewed.
- Prizes, money, access, or privileges based on Community rankings.
- Arbitrary uploads or executable customization.
- Claims of ranking all Codex users rather than participating Vibe Racing profiles.
