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
  disposable PostgreSQL startup.
- [Dependency policy](security/DEPENDENCY_POLICY.md) — package, action, container, update, and
  supply-chain requirements.
- [Pull-request CI trust model](architecture/CI_TRUST_MODEL.md) — untrusted-code execution boundary
  and enforced workflow rules.
- [Governance](../GOVERNANCE.md), [maintainers](../MAINTAINERS.md), and
  [code of conduct](../CODE_OF_CONDUCT.md) — authority, decision, enforcement, and publication
  boundaries.
- [Support](../SUPPORT.md), [roadmap](../ROADMAP.md), and [release policy](../RELEASE.md) — current
  service limits, delivery order, artifact evidence, and rollback expectations.
- [Third-party notices](../THIRD_PARTY_NOTICES.md) and [trademark policy](../TRADEMARKS.md) —
  current dependency and branding obligations.

## Required before implementation reaches public beta

- `getting-started/` — first product run once an application exists.
- `architecture/` — system context, containers, product data flow, database model, protocol
  boundaries, and compatibility policy.
- `security/` — threat model, abuse cases, privacy data map, and incident response.
- `reference/` — public API, connector CLI, configuration, scoring, and CarRecipe reference.
- `operations/` — Railway/Cloudflare deployment, migrations, backups, restore, alerts, SLOs,
  incident and deletion runbooks.
- `decisions/` — numbered architecture decision records.
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
