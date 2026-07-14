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
- [Web prototype](../apps/web/README.md) — frontend commands, module map, privacy boundary, CSP,
  synthetic data contract, and test strategy.
- [Phase 1 browser matrix](testing/PHASE1_BROWSER_MATRIX.md) — responsive, contrast, interaction,
  runtime-header, artifact-budget evidence, and explicitly open manual gates.
- [Dependency policy](security/DEPENDENCY_POLICY.md) — package, action, container, update, and
  supply-chain requirements.
- [Dependency inventory](reference/dependency-inventory.json) — deterministic locked npm/Cargo and
  external artifact/license evidence.
- [Asset provenance](reference/ASSET_PROVENANCE.md) — generation/source records, integrity digests,
  metadata sanitation, accessibility text, and release-review status for non-code visuals.
- [Pull-request CI trust model](architecture/CI_TRUST_MODEL.md) — untrusted-code execution boundary
  and enforced workflow rules.
- [Threat model](security/THREAT_MODEL.md), [abuse cases](security/ABUSE_CASES.md), and
  [privacy data map](security/PRIVACY_DATA_MAP.md) — repository-wide attackers, assets, severity,
  misuse/recovery scenarios, field classification, retention, and deletion gates.
- [System context](architecture/SYSTEM_CONTEXT.md) and [data flows](architecture/DATA_FLOW.md) —
  planned containers, trust boundaries, capabilities, enrollment, pairing, sync, read, deletion, and
  release sequences.
- [Compatibility policy](architecture/COMPATIBILITY_POLICY.md) and
  [empty Codex support matrix](reference/codex-compatibility.md) — independently versioned contracts
  and fail-closed upstream admission.
- [Architecture decision records](decisions/README.md) — accepted decisions, alternatives,
  consequences, verification, and supersession.
- [Governance](../GOVERNANCE.md), [maintainers](../MAINTAINERS.md), and
  [code of conduct](../CODE_OF_CONDUCT.md) — authority, decision, enforcement, and publication
  boundaries.
- [Support](../SUPPORT.md), [roadmap](../ROADMAP.md), and [release policy](../RELEASE.md) — current
  service limits, delivery order, artifact evidence, and rollback expectations.
- [Third-party notices](../THIRD_PARTY_NOTICES.md) and [trademark policy](../TRADEMARKS.md) —
  current dependency and branding obligations.

## Required before implementation reaches public beta

- `getting-started/` — first product run once an application exists.
- `architecture/` — implementation-level database model and protocol boundaries as code lands.
- `security/` — incident-response and launch privacy/legal artifacts as operations become real.
- `reference/` — public API, connector CLI, configuration, scoring, and CarRecipe reference.
- `operations/` — Railway/Cloudflare deployment, migrations, backups, restore, alerts, SLOs,
  incident and deletion runbooks.
- `decisions/` — new records whenever durable decisions change; initial ADRs exist now.
- `releasing/` — versioning, changelog, signing, provenance, rollback, and supported-version policy.

Root community-health files establish policy now; the directories above will contain component
runbooks and reference once the corresponding implementation exists.

## Documentation principles

- English engineering documents are canonical.
- Russian documentation covers the product and user workflows without duplicating low-level
  implementation reference unnecessarily.
- Commands shown in documentation must be executed by CI or explicitly marked as illustrative.
- Diagrams use Mermaid and stay at the same abstraction level as the surrounding text.
- Generated API reference is committed only when CI verifies it matches the canonical contracts.
- Documentation lint, link checking, spelling, translation drift, and example verification are
  release gates.
