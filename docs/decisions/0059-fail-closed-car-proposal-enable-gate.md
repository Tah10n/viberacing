# ADR 0059: Fail-closed CarRecipe proposal enable gate

- Status: Accepted
- Date: 2026-07-18
- Decision owners: Web/Auth, Product, Connector, Operations, Security, Privacy, and Deployment
- Supersedes: None
- Superseded by: None

## Context

The project plan requires enrollment, pairing, source creation, ingestion, proposals, and public
ranking to have independent kill switches. ADRs 0035 and 0038 implement two origins for one private
`CarRecipeV1` proposal: a signed-in browser session and an active source-bound device. A separate
browser action can approve the pending proposal and make it the profile's active recipe.

Those three mutations form one operational capability. Closing only device ingress would leave the
browser editor callable. Closing only creation would leave an already-pending proposal able to
activate after the control was disabled. Conversely, blocking reads or rejection would prevent a
user from inspecting and safely discarding private pending state during an incident.

The public race projection reads only an already-active recipe and remains a separate delivery
boundary. Proposal expiry cleanup is also separate Jobs authority. Neither dependency failure nor
the public-ranking gate is an unambiguous proposal control.

A complete operational switch still needs protected deployment configuration, coordinated instance
restart and drain, operator authorization and audit, monitoring, user communication, and a runbook.
None is proved by local Next.js module-load decisions.

## Decision

Creating or approving a CarRecipe proposal requires exact `VIBERACING_CAR_PROPOSALS_ENABLED=true`.
The value is case-sensitive and canonical. Missing, empty, false, mixed-case, numeric, inherited,
accessor-backed, hidden, non-string, unreadable, or any other state resolves to disabled without
throwing or reflecting the submitted value.

One server-only resolver inspects only that field as an own enumerable string data property and
returns a frozen `{ enabled: boolean }` decision. It reads no session, profile, source, device,
recipe, proposal, protected key, request, or database field. Four exact Next.js modules resolve the
decision once when they are evaluated:

- the signed-in `/account` server page;
- `POST /auth/cars/proposals` for browser proposal creation or replacement;
- `POST /auth/cars/proposals/approve` for browser activation; and
- `POST /v1/connector/cars/proposals` for source-bound device proposal creation or replacement.

The account page passes only the frozen boolean to its server-rendered experience. While disabled,
the page continues to display an active recipe and any private pending proposal, adds exact EN/RU
unavailability copy, omits the browser editor and approve form, and retains only the pending
proposal's session-bound reject form. The raw proposal identifier remains hidden inside the existing
encrypted control.

The browser create and approve route modules pass their decisions through the shared enrollment HTTP
factory as unknown input. Only literal boolean `true` permits either operation. Every alternate
decision cancels an available request body and returns the existing generic no-store 503 before
runtime construction, origin or content-type inspection, admission acquisition, form parsing, cookie
parsing, or database work. The browser proposal service repeats literal-true enforcement:

- create rejects before CarRecipe validation, session lookup, UUID/time generation, verifier
  hashing, or proposal persistence; and
- approve rejects before control inspection, session lookup, cookie opening, verifier hashing, or
  proposal activation.

The dedicated connector proposal HTTP factory applies the same unknown-input literal-true check
before `Accept`, URL, headers, body framing, admission, service construction, signature or contract
verification, entropy, or database work. Its explicit non-POST handlers remain closed 405 responses
with `Allow: POST` even while proposal POST is disabled.

`POST /auth/cars/proposals/reject` deliberately does not read this decision. The private account
state reader also remains available. Rejection still requires the exact current passkey session and
encrypted session-bound proposal control, and it cannot create or activate a recipe. Expiry and
Jobs-only physical cleanup retain their existing independent behavior.

The tracked `.env.example` fixes the switch to `false`, and the configuration checker rejects an
enabled tracked value. An ignored or protected environment must deliberately set exact `true` before
the relevant modules load.

This changes no public JSON Schema, OpenAPI operation, authentication policy, connector command,
database function, role, grant, row, cookie, proposal lifetime, cleanup rule, or compatibility
status. Disabled public device POST uses its already-declared generic unavailability response. The
browser form routes use the existing common generic problem response.

This is a module-load gate, not a dynamic flag. The account page and three mutation modules can be
evaluated by different workers at different times. Changing the environment does not prove that an
already-loaded module was re-evaluated, that an old enabled instance stopped serving, or that an
external route was denied.

## Security and privacy consequences

Default-off proposal mutation reduces accidental or abusive pending-state replacement and blocks
activation of an in-flight proposal after a restarted approval module resolves disabled. It also
prevents an active but stolen device credential from spending proposal verification/database
capacity while the capability is off. Preserving read and reject gives the possessed browser session
a removal path without granting new authority.

The UI is honest communication and defense in depth, not the authorization boundary. A user can
alter markup or send a direct request, but both browser mutations still fail in the HTTP boundary
and the shared proposal service. The dedicated device boundary fails before it constructs its
verifier or database service. Existing enum-only validation, browser-only activation, source-bound
device authority, nonce replay protection, one-pending-proposal limit, 24-hour expiry, and generic
failures remain unchanged.

The configuration input and serialized browser capability boolean are non-personal Operational data.
The resolver retains one boolean in each relevant module. The page serializes only that boolean to
its same-origin server-rendered tree. It is not logged, exported, persisted, sent to another origin,
attached to a metric or audit event, or used as a cache key. No new recipe, account, device,
session, proposal, or free-text field is collected or retained.

This control does not dynamically drain workers, authenticate an operator, prove external route
denial, remove a pending proposal, reject on the user's behalf, delete or hide an active recipe,
disable public ranking, alter connector native authority, revoke a device, replace rate limits,
schedule cleanup, or supply monitoring and capacity evidence. An actor who controls the server
process or protected environment has broader Web authority; deployment access control and audit
remain mandatory.

Affected invariants are VR-CAR-001, VR-DEVICE-001, VR-DEVICE-002, VR-AUTH-002, VR-DATA-001,
VR-PUBLIC-001, and VR-ABUSE-001. Primary attacker stories are VR-ABUSE-CAR-INJECTION,
VR-ABUSE-DEVICE-KEY-THEFT, VR-ABUSE-DEVICE-ESCALATION, VR-ABUSE-DATABASE-ROLE, and
VR-ABUSE-RESOURCE-EXHAUSTION.

## Alternatives considered

- **Gate only device ingress:** rejected because the signed-in browser could still create or replace
  private pending state.
- **Gate creation but not approval:** rejected because an already-pending recipe could activate
  after the control was disabled and an approval worker restarted.
- **Gate rejection and private reads too:** rejected because those actions create no proposal and a
  user needs a safe way to inspect and discard pending state.
- **Reuse the public-ranking gate:** rejected because private proposal mutation and public active
  recipe delivery are separate capabilities with different incident and recovery needs.
- **Reuse the pairing, source-creation, or Ingest gate:** rejected because a signed-in browser can
  create a proposal without those capabilities, while an already-active device can propose without
  creating a source or submitting usage.
- **Treat database or verifier failure as disabled:** rejected because dependency failure is
  ambiguous, occurs after request work, and is not independently reviewable.
- **Treat any non-empty or truthy value as enabled:** rejected because configuration typos and
  coercion would fail open.
- **Read the environment on every request:** rejected because mutable request-time configuration,
  worker consistency, authorization, audit, and rollback require a separate operational design.

## Migration and rollback

There is no database, public contract, dependency, package, role, grant, cookie, retained-data, or
network migration. Local environments that intentionally create or approve proposals must set the
exact enable value before the account page and corresponding route modules are evaluated. Existing
pending proposals remain private, rejectable by the exact session, and subject to the unchanged
24-hour expiry and Jobs cleanup.

Rollback removes the resolver, UI state, and mutation decisions only after no environment relies on
them. A deployed rollback must preserve an equivalent independently reviewed default-off proposal
control. It must not make valid database or device-key configuration alone sufficient to expose
proposal creation or activation, and it must not weaken enum validation, browser-only approval,
source-bound device authority, replay protection, retention, or generic failure behavior.

## Verification

Repository evidence covers:

- exact `true` acceptance and a frozen decision;
- missing, empty, false, mixed-case, numeric, inherited, accessor, hidden, non-string, non-object,
  and descriptor-trap fail-closure;
- proof that the resolver inspects only the exact environment descriptor;
- account page plus browser create, browser approve, and device POST module wiring;
- rejection of false, missing, truthy-string, and numeric decisions before browser request/runtime/
  admission work and before browser proposal parser/session/database work;
- the same hostile-input fail-closure before device request parsing and service construction;
- EN/RU disabled-state copy, active and pending preview preservation, editor/approve omission, and
  exact reject preservation;
- unchanged device non-POST handling and browser session-bound rejection;
- disabled-by-default tracked example plus configuration-checker mutation coverage; and
- Web lint, strict types, unit/coverage, production build, configuration, documentation,
  architecture, privacy, and public-data gates.

The tests do not prove deployed configuration delivery, coordinated worker restart/drain, dynamic
disablement, external route denial, operator authentication/authorization/audit, distributed rate
limits, monitoring, alerting, capacity, live database/TLS/WebAuthn/device-signature behavior,
scheduled proposal cleanup, connector packaging, or deployment.

## References

- [Enum-only CarRecipe](0005-enum-only-car-recipe.md)
- [Session-owned CarRecipe proposal](0035-bounded-session-car-recipe-proposal.md)
- [Bounded CarRecipe proposal cleanup](0036-bounded-car-recipe-proposal-cleanup.md)
- [Device CarRecipe proposal ingress](0038-bounded-device-car-recipe-proposal-ingress.md)
- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [Web workspace](../../apps/web/README.md)
- [System context](../architecture/SYSTEM_CONTEXT.md)
- [Data flow](../architecture/DATA_FLOW.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
