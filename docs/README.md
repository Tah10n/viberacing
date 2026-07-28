# Documentation

This directory contains the public, canonical engineering documentation for Vibe Racing. It must
remain safe to publish verbatim.

## Available now

- [Project plan](PROJECT_PLAN.md) — selected product, architecture, security, repository, testing,
  and rollout decisions.
- [Implementation status](IMPLEMENTATION_STATUS.md) — claims backed by files and executable checks
  in the current tree.
- [Security invariants](architecture/SECURITY_INVARIANTS.md) — stable, testable boundaries that
  implementation changes must preserve.
- [Public repository data policy](security/PUBLIC_REPOSITORY_POLICY.md) — publishable/private
  boundaries and the commit/publication checklist.
- [Local development](getting-started/LOCAL_DEVELOPMENT.md) — pinned tools, repository gates, and
  synthetic web prototype and disposable PostgreSQL startup.
- [First GitHub publication](getting-started/GITHUB_FIRST_PUBLICATION.md) — empty-public-repository
  setup, source-only interaction restrictions, confirmed ownership, CODEOWNERS, reporting, first
  push, hosted CI, and branch controls.
- [Railway Web staging](getting-started/RAILWAY_WEB_STAGING.md) — minimal production image,
  standalone runtime smoke, exact default-off variables, and the explicit preview-only boundary.
- [Railway data-plane staging](getting-started/RAILWAY_DATA_PLANE_STAGING.md) — separate Web,
  Ingest, Jobs, and migration images, dependency-free Cloudflare signer, deployment order, and
  external PostgreSQL/identity prerequisites.
- [GitHub Release deployment](getting-started/GITHUB_RELEASE_DEPLOYMENT.md) — protected stable-tag
  workflow, one-time Railway/Cloudflare/GitHub setup, service order, and manual redeploy boundary.
- [Web prototype](../apps/web/README.md) — frontend commands, module map, privacy boundary, CSP,
  synthetic data contract, and test strategy.
- [Design system](design/README.md) — reusable brand/interface rules, canonical race-broadcast
  direction, public-safe synthetic prototype, and the boundary between durable design decisions and
  local OpenDesign state.
- [Ingest boundaries](../apps/ingest/README.md) — protected origin-key reader, exact raw-request
  policy, origin/device proof, parser limits, bounded PostgreSQL adapter, focused checks, and
  explicit integration gaps.
- [Cloudflare sync origin signer](../apps/edge/README.md) — dependency-free exact-route Worker,
  origin-proof compatibility evidence, protected deployment inputs, and live-evidence boundary.
- [Public protocol contracts](../contracts/README.md) — canonical JSON Schemas, generated
  TypeScript/OpenAPI artifacts, writable-field boundary, validation limits, and versioning rules.
- [Database foundation](../database/README.md) — SQL migration ledger, privacy/table map,
  least-privilege role matrix, state constraints, test workflow, and remaining capability work.
- [Phase 1 browser matrix](testing/PHASE1_BROWSER_MATRIX.md) — exact synthetic viewport baselines,
  responsive, contrast, interaction, runtime-header, artifact-budget evidence, and open manual
  gates.
- [Dependency policy](security/DEPENDENCY_POLICY.md) — package, action, container, update, and
  supply-chain requirements.
- [Dependency inventory](reference/dependency-inventory.json) — deterministic locked npm/Cargo and
  external artifact/license evidence.
- [Connector protocol, candidate diagnostic, adapter, supervisor, pairing, and sync signers](../crates/connector/README.md)
  — bounded local App Server handshake, exact `0.144.5` account/usage parser, synthetic one-shot
  process evidence, exact sync material/signing, a native-store `connect` command, a process-free
  exact-candidate diagnostic, and one Windows exact-artifact `sync` command with synthetic loopback
  upload evidence, plus the fixed proposal-only command; no supported release, cross-platform
  result, or operational connector.
- [Bounded local car-proposal Agent Skill](../.agents/skills/viberacing-propose-car/SKILL.md) —
  exact enum reduction, shell-safe invocation policy, browser-only decision boundary, and
  production-derived drift checks without connector installation or release authority.
- [Bounded local repository-verification Agent Skill](../.agents/skills/viberacing-verify/SKILL.md)
  — real-scope read-only gate selection, staged/history evidence boundaries, and fail-closed
  authority and production-claim checks.
- [Asset provenance](reference/ASSET_PROVENANCE.md) — generation/source records, integrity digests,
  metadata sanitation, accessibility text, design-reference origin, and release-review status for
  non-code visuals.
- [CarRecipe version 1](reference/car-recipe.md) — exact closed fields, local session-owned
  proposal/approval lifecycle, deterministic rendering, trust limits, and remaining gates.
- [Pull-request CI trust model](architecture/CI_TRUST_MODEL.md) — untrusted-code execution boundary
  and enforced workflow rules.
- [Threat model](security/THREAT_MODEL.md), [abuse cases](security/ABUSE_CASES.md), and
  [privacy data map](security/PRIVACY_DATA_MAP.md) — repository-wide attackers, assets, severity,
  misuse/recovery scenarios, field classification, retention, and deletion gates.
- [System context](architecture/SYSTEM_CONTEXT.md) and [data flows](architecture/DATA_FLOW.md) —
  planned containers, trust boundaries, capabilities, enrollment, login/recovery, pairing, sync,
  read, deletion, and release sequences.
- [Compatibility policy](architecture/COMPATIBILITY_POLICY.md) and
  [empty Codex support matrix](reference/codex-compatibility.md) — independently versioned contracts
  and fail-closed upstream admission; candidate manifests stay outside supported rows.
- [Architecture decision records](decisions/README.md) — accepted decisions, alternatives,
  consequences, verification, and supersession.
- [Governance](../GOVERNANCE.md), [maintainers](../MAINTAINERS.md), and
  [code of conduct](../CODE_OF_CONDUCT.md) — authority, decision, enforcement, and publication
  boundaries.
- [Support](../SUPPORT.md), [roadmap](../ROADMAP.md), and [release policy](../RELEASE.md) — current
  service limits, delivery order, artifact evidence, and rollback expectations.
- [Staging migration and forward-recovery runbook](operations/MIGRATION_RUNBOOK.md) — checked
  default-off migration prerequisites, apply/verification controls, containment, and protected
  handoff boundaries; it is not staging or production evidence.
- [Isolated current-snapshot restore rehearsal runbook](operations/CURRENT_SNAPSHOT_RESTORE_RUNBOOK.md)
  — checked synthetic archive/target isolation, local evidence, restore verification, stale-backup
  stop, and incident-handoff controls; it is not real-user, staging, production, recovery, or
  deployment evidence.
- [Capability containment and recovery rehearsal runbook](operations/CAPABILITY_CONTAINMENT_RUNBOOK.md)
  — checked exact-default-off inventory, process-replacement, independent containment, preserved
  security/deletion paths, redacted evidence, and one-capability recovery; it is not a deployed
  control plane, private reporting channel, monitoring backend, or incident result.
- [Profile deletion failure rehearsal runbook](operations/PROFILE_DELETION_FAILURE_RUNBOOK.md) —
  checked request/purge/terminal-retention classification, preserved authority lock-down, protected
  aggregate diagnosis, one bounded deployment-owned retry, and explicit no-automatic-retry and
  stale-backup boundaries; it is not a deployed deletion or recovery result.
- [Third-party notices](../THIRD_PARTY_NOTICES.md) and [trademark policy](../TRADEMARKS.md) —
  current dependency and branding obligations.

## Required before implementation reaches public beta

- `getting-started/` — first product run once an application exists.
- `architecture/` — implementation-level database model and protocol boundaries as code lands.
- `security/` — incident-response and launch privacy/legal artifacts as operations become real.
- `reference/` — public API, connector CLI, configuration, scoring, and CarRecipe reference.
- `operations/` — checked migration, isolated current-snapshot restore, local capability-
  containment, profile-deletion failure, and local Railway/Cloudflare data-plane composition
  documents exist; live deployment, external backup storage, stale-backup deletion replay, alerts,
  SLOs, reporter coordination, compromised release, mass revoke, and broader incident communication
  runbooks remain pending.
- `decisions/` — new records whenever durable decisions change; initial ADRs exist now.
- `releasing/` — versioning, changelog, signing, provenance, rollback, and supported-version policy.

Root community-health files establish policy now. Existing documents remain explicit about local
evidence, and the remaining directories will gain component runbooks and reference only after the
corresponding implementation exists.

## Documentation principles

- English engineering documents are canonical.
- Russian documentation covers the product and user workflows without duplicating low-level
  implementation reference unnecessarily.
- Commands shown in documentation must be executed by CI or explicitly marked as illustrative.
- Diagrams use Mermaid and stay at the same abstraction level as the surrounding text.
- Generated API reference is committed only when CI verifies it matches the canonical contracts.
- Documentation lint, link checking, spelling, translation drift, and example verification are
  release gates.
