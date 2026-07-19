# ADR 0057: Fail-closed pairing route enable gate

- Status: Accepted (local module-load gate implemented; deployed operation pending)
- Date: 2026-07-18
- Decision owners: Web/Auth, Connector, Product, Operations, Security, Privacy, and Deployment
- Supersedes: None
- Superseded by: None

## Context

The project plan requires pairing to have an independent kill switch. The local pairing journey now
has four state-bearing HTTP operations: anonymous connector start and poll plus signed-in browser
approval options and verification. They already use closed contracts, bounded parsing and admission,
generic failures, fixed database capabilities, and protected proof material, but valid runtime and
database configuration alone still made the routes callable.

ADRs 0055 and 0056 added separate local default-off decisions for Ingest and public ranking. Pairing
is a different capability and spans both the connector transport HTTP factory and two methods of the
Web/Auth enrollment HTTP factory. A useful switch must therefore close all four route compositions,
including already-created transaction polling and approval, without treating database failure as an
operator decision or conflating pairing with the separate source-creation capability.

A complete operational switch also needs deployed configuration ownership, simultaneous instance
rollout and drain, external route denial, authorization, audit, monitoring, user communication, and
a runbook. None is proved by a local Next.js module-load decision.

## Decision

The four pairing routes require exact `VIBERACING_PAIRING_ENABLED=true`. The value is case-sensitive
and canonical. Missing, empty, false, mixed-case, numeric, inherited, accessor-backed, hidden,
non-string, unreadable, or any other state resolves to disabled without throwing or reflecting the
submitted value.

One server-only resolver inspects only that field as an own enumerable string data property. It
returns a frozen `{ enabled: boolean }` decision and reads no database, pairing key, request,
session, source, device, or user field. Each exact route module resolves the decision once when that
module is evaluated:

- `POST /v1/connector/pairing/start`;
- `POST /v1/connector/pairing/poll`;
- `POST /auth/pairing/options`; and
- `POST /auth/pairing/verify`.

Both production HTTP compositions accept the enable decision as unknown runtime input and proceed
only when it is literal boolean `true`. For connector start and poll, disabled POST cancels any
available request body and returns the existing generic `temporarily_unavailable` response before
reading `Accept`, URL, headers, or body content; validating a contract; constructing the transport
service; or reading protected/database configuration. Their explicit non-POST handlers retain the
existing 405 plus `Allow: POST`.

For signed-in approval options and verification, disabled POST likewise cancels any available body
and returns the existing generic 503 before constructing the enrollment runtime, checking
origin/content type, acquiring admission, parsing a body or cookie, beginning WebAuthn, reading a
pending transaction, or mutating pairing/source/device state. The response retains the existing
per-boundary `no-store`, opaque request ID, no-referrer, content type, and no-CORS policy; connector
responses also retain `Vary: Accept`.

All four operations already document or use generic unavailability without adding a response field,
so this decision changes no JSON Schema, OpenAPI operation, database function, grant, cookie, or
connector compatibility status. The `/connect` page shell and its separate session-derived active
source/device inventory remain available; an attempted review or approval receives the existing
generic localized failure path. No new browser string or persistence is introduced.

Tracked `.env.example` fixes the switch to `false`, and the configuration checker rejects an enabled
tracked value. An ignored or protected environment must deliberately set exact `true` before a
pairing route module is loaded.

This is a module-load gate, not a dynamic flag. Separate route modules, workers, or service
instances can evaluate at different times. Changing the environment does not prove that loaded
modules were re-evaluated, old instances stopped serving, or an external route was denied. Disabling
pairing closes both new-source and existing-source pairing journeys; when pairing is enabled, the
independent source-creation switch required by the plan remains unimplemented.

## Security and privacy consequences

The exact default-off decision reduces accidental creation, lookup, approval, and activation of
device credentials. Repeating literal-true enforcement inside both production factories means a
direct internal caller cannot enable either boundary with a truthy string, number, missing field, or
malformed value. Disabled requests perform only request-body cancellation and generic response
construction; they reach no untrusted parser, admission lease, runtime/service factory, protected
pairing key, entropy generation, WebAuthn ceremony, or database capability.

The switch is non-personal Operational configuration. The resolver retains only one boolean in a
frozen module-local decision. It does not serialize, log, export, persist, transmit, or attach the
input to a request, metric, trace, audit event, cache key, database row, cookie, browser payload, or
error. Request-body cancellation and the generic problem response use existing HTTP fields and add
no retained data.

This does not stop an already-loaded instance, authenticate an operator, prove external route
denial, clear a connector's native state, delete pending transactions, replace bounded retention,
prevent abuse after enablement, or supply monitoring/capacity evidence. Jobs cleanup remains
independent and can remove eligible expired pairing state. An actor who controls the full server
environment or process has broader Web authority; deployment access control and audit remain
separate mandatory controls.

Affected invariants are VR-DEVICE-001, VR-DATA-001, VR-PUBLIC-001, VR-ABUSE-001, and VR-RELEASE-001.
Primary attacker stories are VR-ABUSE-PAIRING-GUESS, VR-ABUSE-DEVICE-KEY-THEFT,
VR-ABUSE-DEVICE-ESCALATION, VR-ABUSE-DATABASE-ROLE, VR-ABUSE-RESOURCE-EXHAUSTION,
VR-ABUSE-CONNECTOR-LOCAL, and VR-ABUSE-SECRET-LEAK.

## Alternatives considered

- **Treat any non-empty or truthy value as enabled:** rejected because typos, strings, and config
  coercion would fail open.
- **Gate only anonymous start:** rejected because poll and browser approval could continue reading
  or activating already-created transactions during an incident.
- **Gate connector start/poll but not browser approval:** rejected because approval is part of the
  same device-authority capability and can still authorize pending state.
- **Gate the `/connect` page render instead of its state-bearing routes:** rejected because direct
  requests and the connector transport would remain callable, while the separate private inventory
  read does not itself create pairing authority.
- **Use protected-key or database configuration failure as the switch:** rejected because dependency
  failure is ambiguous, is not independently reviewable, and occurs after request/runtime work.
- **Reuse the public-ranking or Ingest flag:** rejected because pairing needs independent incident
  control and runs in a different route/process boundary.
- **Read the environment on every request:** rejected because mutable request-time configuration,
  concurrency, cross-worker consistency, audit, and rollback require a separate operational design.
- **Combine pairing and source creation into one flag:** rejected because the plan requires
  existing-source pairing to remain independently controllable from creation of another source.

## Migration and rollback

There is no database, contract, dependency, package, retained-data, cookie, grant, or network
migration. Existing local environments that intentionally exercise pairing must add the exact enable
value before route-module evaluation. The tracked example remains disabled.

Rollback removes the environment resolver and route decisions only after no local or deployed
environment relies on them. A deployed rollback must preserve an equivalent reviewed default-off
pairing control; it must not make valid database/key configuration alone sufficient to expose the
routes. It must not alter the separate pending-state cleanup, native credential lifecycle, generic
problem contracts, proof verification, or source/device authority rules.

## Verification

Repository evidence covers:

- exact `true` acceptance and frozen decision output;
- missing, empty, false, mixed-case, numeric, inherited, accessor, hidden, non-string, non-object,
  and descriptor-trap fail-closure;
- proof that the resolver inspects only the exact enable descriptor;
- literal-true enforcement inside both production HTTP factories;
- false, missing, truthy-string, and numeric rejection before request parsing, runtime/service
  construction, admission acquisition, or storage work;
- all four Next.js route modules remaining disabled under false and entering their existing boundary
  only under exact true;
- unchanged connector non-POST 405 behavior and closed 503/no-store/no-CORS serialization;
- disabled-by-default tracked example plus configuration-checker mutation coverage; and
- Web lint, type, unit/coverage, production build, configuration, documentation, architecture, and
  public-data gates.

The tests do not prove deployed config delivery, simultaneous worker/instance disablement, external
route denial, old-instance drain, operator authentication, authorization, audit, monitoring, alert,
capacity, live database/TLS/WebAuthn behavior, connector native-state cleanup, source-creation
control, or any other capability switch.

## References

- [Bounded pairing activation composition](0027-bounded-pairing-activation-composition.md)
- [Bounded pairing start composition](0028-bounded-pairing-start-composition.md)
- [Bounded connector pairing transport](0030-bounded-connector-pairing-transport.md)
- [Fail-closed Ingest startup latch](0055-fail-closed-ingest-startup-enable-latch.md)
- [Fail-closed public-ranking gate](0056-fail-closed-public-ranking-route-enable-gate.md)
- [Web workspace](../../apps/web/README.md)
- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [System context](../architecture/SYSTEM_CONTEXT.md)
- [Data flow](../architecture/DATA_FLOW.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
