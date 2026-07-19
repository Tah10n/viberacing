# ADR 0058: Fail-closed source-creation enable gate

- Status: Accepted (local module-load and service gate implemented; deployed operation pending)
- Date: 2026-07-18
- Decision owners: Web/Auth, Product, Operations, Security, Privacy, and Deployment
- Supersedes: None
- Superseded by: None

## Context

The project plan requires pairing and source creation to have independent kill switches. ADR 0057
places connector start, connector poll, browser approval options, and browser approval verification
behind one default-off pairing decision. That control closes the whole device-pairing journey. Once
pairing is enabled, however, the signed-in browser can still choose either an active existing source
or creation of another opaque `CodexSource`.

Those choices have different operational consequences. Existing-source pairing adds another
source-bound device for an already-declared account. New-source pairing creates another aggregation
input and increases the surface for source storms, quota pressure, and user mistakes. Operations
therefore need to stop new source creation without preventing a user from replacing or adding a
device for an active source.

Checking only the visible `/connect` form would leave direct HTTP requests callable. Checking only
approval options would also leave a five-minute new-source challenge able to complete after the
control was disabled and the process restarted. A useful local control must cover both steps while
keeping the selected source choice bound to the exact passkey challenge.

A complete operational switch still needs protected deployment configuration, coordinated instance
restart and drain, operator authorization and audit, monitoring, user communication, and a runbook.
None is proved by a local Next.js module-load decision.

## Decision

Creating a new source requires exact `VIBERACING_SOURCE_CREATION_ENABLED=true`. The value is
case-sensitive and canonical. Missing, empty, false, mixed-case, numeric, inherited,
accessor-backed, hidden, non-string, unreadable, or any other state resolves to disabled without
throwing or reflecting the submitted value.

One server-only resolver inspects only that field as an own enumerable string data property and
returns a frozen `{ enabled: boolean }` decision. It reads no request, session, pairing, source,
device, protected key, or database field. Three exact Next.js modules resolve it once when they are
evaluated:

- the `/connect` server page;
- `POST /auth/pairing/options`; and
- `POST /auth/pairing/verify`.

The connector start and poll routes do not create a source and do not read this decision. They
remain separately controlled by ADR 0057's pairing gate. Both browser approval routes also require
the pairing gate before they can construct their HTTP boundary.

The `/connect` page passes only the frozen boolean to its client component. When disabled, the form
does not render the new-source radio control, displays an EN/RU availability message, and selects
the first active existing-source control by default. If no active existing source is available, the
submit button is disabled. Raw source IDs remain server-only; existing choices still use the
session-bound encrypted source control.

The two browser route modules pass their module-local decision through the enrollment HTTP boundary
as unknown input. The boundary does not coerce it and supplies it to both pairing service calls. The
service permits a body or challenge with `sourceChoice: "new"` only when that input is literal
boolean `true`:

- approval options reject a new-source choice after the existing bounded HTTP/session/body parsing
  but before pairing-code derivation, pending-code lookup, source-ID generation, WebAuthn option
  creation, challenge persistence, or any pairing database call;
- approval verification opens and validates the existing session and purpose-separated encrypted
  pairing challenge, then rejects a new-source choice before parsing WebAuthn response content,
  reading credential material, verifying a passkey, generating an audit ID, or calling atomic
  pairing completion; and
- both steps continue unchanged for `sourceChoice: "existing"` while source creation is disabled.

The encrypted five-minute pairing-approval challenge now carries exact `sourceChoice` in addition to
its existing pairing and source identifiers. Its parser requires the closed shape and accepts only
`new` or `existing`. The passkey context digest advances to the domain-separated
`viberacing-pairing-approval-v2` input and includes that choice. Creation and completion therefore
bind session, pairing, source choice, source ID, RP ID, and origin to the same database challenge. A
challenge issued for `new` while the flag was enabled cannot complete after a restarted verification
module resolves disabled. Older or malformed challenge cookies fail closed.

The tracked `.env.example` fixes the switch to `false`, and the configuration checker rejects an
enabled tracked value. An ignored or protected environment must deliberately set exact `true` before
the relevant modules load. Enabling source creation has no effect while the separate pairing gate
remains disabled.

This changes no public JSON Schema, OpenAPI operation, database function, role, grant, persistent
row, connector command, or compatibility status. The encrypted cookie is purpose-separated,
server-owned, and short-lived; it gains no new data class or user-supplied free text.

This is a module-load gate, not a dynamic flag. The page, options, and verification modules can be
evaluated by different workers at different times. Changing the environment does not prove that an
already-loaded module was re-evaluated, that an old instance stopped serving, or that an external
route was denied.

## Security and privacy consequences

The default-off gate reduces accidental or abusive multiplication of opaque Community sources while
preserving device replacement and additional-device pairing for active sources. Repeating
literal-true enforcement in the production service protects direct internal callers that omit the
decision or pass a truthy string or number. Verification enforcement closes an in-flight new-source
approval after a process reload rather than treating options-time admission as permanent authority.

The source choice was already present in the bounded request and database challenge. Adding it to
the encrypted challenge and context digest creates no new collection or publication. It is retained
for at most the existing five-minute cookie lifetime, is available only to the Web/Auth service and
the user's browser as ciphertext, and is cleared through the existing approval-cookie lifecycle. The
new configuration input and browser capability boolean are non-personal Operational data. They are
not logged, exported, persisted, transmitted to another origin, attached to a metric or audit event,
or used as a cache key.

The UI state is defense in depth and honest product communication, not the authorization boundary. A
user can alter client markup or send a direct request, but the service still fails closed. Existing
database caps, source/date deduplication, one profile score cap, passkey approval, source-bound
device authority, and generic failures remain unchanged.

This control does not rate-limit source creation, disable pairing, pause or unlink an existing
source, revoke a device, remove a pending transaction, delete a source already created, stop an
already-loaded enabled worker, authenticate an operator, prove external route denial, or provide
monitoring and capacity evidence. An actor who controls the server process or protected environment
has broader Web authority; deployment access control and audit remain mandatory.

Affected invariants are VR-SOURCE-001, VR-DEVICE-001, VR-AUTH-001, VR-ABUSE-001, VR-DATA-001, and
VR-PUBLIC-001. Primary attacker stories are VR-ABUSE-SOURCE-DUPLICATION, VR-ABUSE-PAIRING-GUESS,
VR-ABUSE-AUTH-TAKEOVER, VR-ABUSE-DATABASE-ROLE, and VR-ABUSE-RESOURCE-EXHAUSTION.

## Alternatives considered

- **Reuse the pairing gate:** rejected because incident response may need existing-source device
  replacement while preventing source growth.
- **Hide only the new-source UI:** rejected because direct requests would still create source-bound
  approval authority.
- **Check only approval options:** rejected because an already-issued new-source challenge could
  still complete after the switch was disabled.
- **Check only approval verification:** rejected because disabled requests would still perform code
  derivation, pending lookup, entropy generation, WebAuthn option creation, and challenge storage.
- **Treat any non-empty or truthy value as enabled:** rejected because configuration typos and
  coercion would fail open.
- **Store the switch in PostgreSQL:** rejected for this local slice because it would merge
  operational control with user-state availability, add request-time database work, and still need a
  separately reviewed cache, consistency, authorization, audit, and outage policy.
- **Read the environment on every request:** rejected because mutable request-time configuration,
  worker consistency, audit, and rollback require a separate operational design.
- **Delete or cancel pending new-source challenges when disabling:** rejected because this local
  module decision owns no scheduled state transition; verification already fails closed and normal
  retention remains independent.

## Migration and rollback

There is no database, public contract, dependency, package, role, grant, or network migration. Local
environments that intentionally create a source must set the exact value before the page and both
approval modules are evaluated. Pairing must also be explicitly enabled.

The internal encrypted pairing-approval challenge adds one closed enum field and changes its context
digest domain. Pending challenges issued by code without that field, or issued under the previous
digest, fail closed and must be restarted. The maximum interruption is the existing five-minute
approval lifetime; no persistent pairing or source record is rewritten.

Rollback removes the new resolver, UI state, and service decisions only after no environment relies
on them. A deployed rollback must preserve an equivalent independently reviewed default-off source
creation control. Rolling between challenge formats may invalidate pending approvals; it must never
accept a challenge whose source choice is absent or unbound.

## Verification

Repository evidence covers:

- exact `true` acceptance and a frozen decision;
- missing, empty, false, mixed-case, numeric, inherited, accessor, hidden, non-string, non-object,
  and descriptor-trap fail-closure;
- proof that the resolver inspects only the exact environment descriptor;
- page, options, and verification module wiring for the literal boolean decision;
- EN/RU disabled-state copy, omission of the new-source control, first existing-source default, and
  disabled submission when no choice exists;
- rejection of false, missing, truthy-string, and numeric decisions before new-source code
  derivation/database work and before new-source WebAuthn verification/completion;
- unchanged existing-source options and completion under a disabled source-creation decision;
- exact encrypted challenge shape, source-choice validation, v2 digest choice binding, and malformed
  or legacy challenge fail-closure;
- disabled-by-default tracked example plus configuration-checker mutation coverage; and
- Web lint, strict types, unit/coverage, production build, configuration, documentation,
  architecture, privacy, and public-data gates.

The tests do not prove deployed configuration delivery, coordinated worker restart/drain, dynamic
disablement, external route denial, operator authentication/authorization/audit, distributed source
rate limits, monitoring, alerting, capacity, live database/TLS/WebAuthn behavior, or source cleanup.

## References

- [Opaque multi-source aggregation](0002-opaque-multi-source-aggregation.md)
- [Identity step-up and device authority](0003-identity-step-up-and-device-authority.md)
- [Bounded connector pairing transport](0030-bounded-connector-pairing-transport.md)
- [Fail-closed pairing route gate](0057-fail-closed-pairing-route-enable-gate.md)
- [Web workspace](../../apps/web/README.md)
- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [System context](../architecture/SYSTEM_CONTEXT.md)
- [Data flow](../architecture/DATA_FLOW.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
