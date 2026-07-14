# Documentation

This directory contains the public, canonical engineering documentation for
Vibe Racing. It must remain safe to publish verbatim.

## Available now

- [Project plan](PROJECT_PLAN.md) — selected product, architecture, security,
  repository, testing, and rollout decisions.
- [Implementation status](IMPLEMENTATION_STATUS.md) — claims backed by files
  and executable checks in the current tree.
- [Security invariants](architecture/SECURITY_INVARIANTS.md) — stable,
  testable boundaries that implementation changes must preserve.
- [Public repository data policy](security/PUBLIC_REPOSITORY_POLICY.md) —
  publishable/private boundaries and the commit/publication checklist.

## Required before implementation reaches public beta

- `getting-started/` — local setup and first successful development run.
- `architecture/` — system context, containers, data flow, database model,
  protocol boundaries, and compatibility policy.
- `security/` — threat model, abuse cases, privacy data map, incident
  response, and dependency policy.
- `reference/` — public API, connector CLI, configuration, scoring, and
  CarRecipe reference.
- `operations/` — Railway/Cloudflare deployment, migrations, backups,
  restore, alerts, SLOs, incident and deletion runbooks.
- `decisions/` — numbered architecture decision records.
- `releasing/` — versioning, changelog, signing, provenance, rollback, and
  supported-version policy.

## Documentation principles

- English engineering documents are canonical.
- Russian documentation covers the product and user workflows without
  duplicating low-level implementation reference unnecessarily.
- Commands shown in documentation must be executed by CI or explicitly marked
  as illustrative.
- Diagrams use Mermaid and stay at the same abstraction level as the
  surrounding text.
- Generated API reference is committed only when CI verifies it matches the
  canonical contracts.
- Documentation lint, link checking, spelling, translation drift, and example
  verification are release gates.
