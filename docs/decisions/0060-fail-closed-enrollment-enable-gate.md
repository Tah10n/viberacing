# ADR 0060: Fail-closed enrollment enable gate

- Status: Accepted
- Date: 2026-07-18
- Decision owners: Web/Auth, Product, Operations, Security, Privacy, and Deployment
- Supersedes: None
- Superseded by: None

## Context

The project plan requires enrollment, pairing, source creation, ingestion, proposals, and public
ranking to have independent kill switches. The local enrollment flow begins with an invite-bearing
same-origin form, continues through GitHub OAuth state plus PKCE, atomically consumes the invite and
creates one `enrolling` profile/session, and finishes only after required initial WebAuthn
registration atomically activates the profile and rotates its session.

Those steps use six browser entrypoints with two persistent mutations. Hiding only the join form
would leave direct start requests callable. Closing only OAuth start would leave an already-issued
callback able to consume an invite and create a profile. Closing only the callback would leave an
already-created enrolling profile able to activate through initial passkey options and verification.
A narrow control must cover the complete invite/OAuth/initial-passkey state machine without
disabling returning passkey login, restricted recovery, logout, or authenticated account controls.

The database currently has bounded retention for expired authentication challenges and sessions, and
the exact abandoned-enrollment command is in a separate default-off local scheduler catalog. There
is fixed-clock composition, directly injected repeated-timer execution and lifecycle settlement, and
real-clock emitted-process terminal-marker evidence, but no host-timer delivery, OS-signal delivery,
emitted-child controller settlement before forced termination, wall-clock recurring process
callback, or deployed cadence. A disabled switch therefore must not claim to delete a pending OAuth
continuation, passkey challenge, redeemed invite, or `enrolling` profile.

A complete operational switch still needs protected deployment configuration, coordinated instance
restart and drain, operator authorization and audit, monitoring, user communication, and a runbook.
None is proved by local Next.js module-load decisions.

## Decision

Invite/OAuth/initial-passkey enrollment requires exact `VIBERACING_ENROLLMENT_ENABLED=true`. The
value is case-sensitive and canonical. Missing, empty, false, mixed-case, numeric, inherited,
accessor-backed, hidden, non-string, unreadable, or any other state resolves to disabled without
throwing or reflecting the submitted value.

One server-only `enrollment-enable-config` resolver inspects only that field as an own enumerable
string data property and returns a frozen `{ enabled: boolean }` decision. It is deliberately
separate from the existing `enrollment-config` parser that validates OAuth, WebAuthn, cookie,
recovery, timing, and origin material. The enable resolver reads no invite, request, cookie,
session, profile, OAuth credential, WebAuthn value, secret, protected key, or database field.

Six exact Next.js modules resolve the decision once when they are evaluated:

- the `/join` server page;
- the `/join/passkey` server page;
- `POST /auth/github/start`;
- `GET /auth/github/callback`;
- `POST /auth/passkey/options`; and
- `POST /auth/passkey/verify`.

The `/join` page still reads existing session state first. An active passkey session continues to
redirect to `/account`, and an existing enrolling session continues to `/join/passkey`. With no
session and enrollment disabled, the EN/RU experience omits the invite/OAuth form, displays exact
unavailability copy, and preserves links for returning login plus ordinary privacy/navigation copy.
The passkey page still redirects an active session to `/account`; an enrolling session sees EN/RU
unavailability copy with no initial-passkey form while disabled.

The four route modules pass their module-local decision through the shared enrollment HTTP factory
as unknown input. Only literal boolean `true` permits an enrollment request. Every alternate
decision cancels an available body and returns the existing generic no-store 503 before runtime
construction, URL/query/origin/header/content-type inspection, admission acquisition, form/JSON
parsing, cookie parsing, protected configuration, OAuth exchange, WebAuthn work, or database work.
The callback gate also blocks the cancellation branch while disabled; its purpose-separated cookie
retains only the existing maximum ten-minute lifetime and is not rewritten without the runtime's
reviewed cookie policy.

The production enrollment service repeats literal-true enforcement at all four state-machine
methods:

- `beginGithub` rejects before reading the validated join object, time, entropy, PKCE, state,
  cookie, or authorization URL configuration;
- `completeGithub` rejects before time, OAuth-cookie opening, state comparison, upstream exchange,
  invite/session digesting, entropy, identifier generation, cookie sealing, or `enroll_profile`;
- `beginPasskey` rejects before session-cookie opening, time, WebAuthn options, verifier hashing,
  entropy, cookie sealing, or challenge persistence; and
- `completePasskey` rejects before session/passkey-cookie opening, JSON-body inspection, time,
  WebAuthn verification, verifier hashing, entropy, cookie sealing, or initial-passkey completion.

Returning `POST /auth/login/options`, `POST /auth/login/verify`, restricted recovery options and
verification, logout, account reads, critical account actions, pairing, source creation, proposal
mutation, Ingest, Jobs, and public ranking do not read this decision. Their existing independent
authorization and operational controls remain unchanged.

The tracked `.env.example` fixes the switch to `false`, and the configuration checker rejects an
enabled tracked value. An ignored or protected environment must deliberately set exact `true` before
the relevant modules load.

This changes no public JSON Schema, OpenAPI operation, authentication policy, database function,
role, grant, row shape, cookie format, OAuth scope, WebAuthn ceremony, challenge/session lifetime,
connector command, or compatibility status. Disabled browser routes use the existing common generic
problem response.

This is a module-load gate, not a dynamic flag. The pages and four route modules can be evaluated by
different workers at different times. Changing the environment does not prove that an already-loaded
module was re-evaluated, that an old enabled instance stopped serving, or that an external route was
denied.

## Security and privacy consequences

Default-off enrollment reduces accidental or abusive invite consumption, upstream OAuth work,
profile creation, WebAuthn work, and profile activation. Repeating literal checks in the production
service protects direct internal callers that omit the decision or supply a truthy string or number.
Gating both initial-passkey steps closes activation after a restarted module resolves disabled
rather than treating profile creation as permanent activation authority.

The UI is honest communication and defense in depth, not the authorization boundary. A user can
alter markup or send a direct request, but all four HTTP operations and all four service methods
fail closed. Existing invite-verifier possession, GitHub state/PKCE/no-extra-scope behavior,
purpose-separated cookies, exact WebAuthn origin/RP/challenge proof, forced RLS, procedure-only Web
authority, atomic transitions, bounded admission, and generic failures remain unchanged.

The enable value and same-origin UI capability boolean are non-personal Operational data. The
resolver retains one boolean in each relevant module, and the pages pass only that boolean through
their server-rendered component trees. It is not logged, exported, persisted, sent to another
origin, attached to a metric or audit event, or used as a cache key. No new invite, GitHub, profile,
session, passkey, account, free-text, or retained field is collected.

Disabling does not revoke or clear an existing OAuth/passkey cookie, restore a redeemed invite,
delete an `enrolling` profile, revoke a pending session, remove a database challenge, terminate an
already running request, disable returning login/recovery/account security actions, authenticate an
operator, provide a distributed rate limit, prove external route denial, or schedule cleanup. A
pending browser continuation can resume only after the relevant module is evaluated with exact
enablement and its unchanged lifetime/state checks still pass. Deployment access control, drain,
audit, cleanup, and recovery procedures remain mandatory.

Affected invariants are VR-AUTH-001, VR-AUTH-002, VR-DATA-001, VR-PUBLIC-001, and VR-ABUSE-001.
Primary attacker stories are VR-ABUSE-IDENTITY-SYBIL, VR-ABUSE-AUTH-TAKEOVER,
VR-ABUSE-DATABASE-ROLE, and VR-ABUSE-RESOURCE-EXHAUSTION.

## Alternatives considered

- **Hide only the join form:** rejected because direct GitHub start, callback, and initial-passkey
  requests would remain callable.
- **Gate only GitHub start:** rejected because an already-issued OAuth continuation could still
  consume an invite and create a profile.
- **Gate start and callback but allow initial-passkey completion:** rejected because the canonical
  enrollment flow includes activation, and an already-created attacker-controlled profile could
  become active after a restarted module resolves disabled.
- **Gate returning login and recovery too:** rejected because they do not create a new profile and
  users need independent access and recovery during an enrollment incident.
- **Clear cookies or delete pending state when disabling:** rejected because this local module
  decision owns no dynamic operator transaction or cleanup schedule, and cookie serialization
  requires the reviewed runtime policy.
- **Reuse pairing, source-creation, proposal, Ingest, or public-ranking control:** rejected because
  enrollment is a separate identity-creation capability with different authority and recovery.
- **Treat OAuth, database, or WebAuthn failure as disabled:** rejected because dependency failure is
  ambiguous, occurs after expensive/private work, and is not independently reviewable.
- **Treat any non-empty or truthy value as enabled:** rejected because configuration typos and
  coercion would fail open.
- **Read the environment on every request:** rejected because mutable request-time configuration,
  worker consistency, operator authorization, audit, and rollback require a separate operational
  design.

## Migration and rollback

There is no database, public contract, dependency, package, role, grant, cookie-format,
retained-data, or network migration. Local environments that intentionally enroll synthetic users
must set the exact enable value before both pages and all four route modules are evaluated.
Returning login and recovery need no enable value.

Disabling can leave an OAuth continuation until its existing ten-minute expiry, an initial-passkey
continuation/challenge until its existing five-minute expiry/retention path, or an `enrolling`
profile and redeemed invite without automatic profile cleanup. Re-enablement does not bypass the
existing expiry, state, session, invite, or database predicates. Operational deletion or invite
repair is outside this local slice and must be separately designed and audited.

Rollback removes the enable resolver, UI state, HTTP decisions, and service decisions only after no
environment relies on them. A deployed rollback must preserve an equivalent independently reviewed
default-off enrollment control and must not make valid OAuth/WebAuthn/database configuration alone
sufficient to expose enrollment.

## Verification

Repository evidence covers:

- exact `true` acceptance and a frozen decision;
- missing, empty, false, mixed-case, numeric, inherited, accessor, hidden, non-string, non-object,
  and descriptor-trap fail-closure;
- proof that the resolver inspects only the exact environment descriptor and remains separate from
  the protected enrollment runtime parser;
- both page modules plus GitHub start/callback and initial-passkey options/verification module
  wiring;
- rejection of false, missing, truthy-string, and numeric decisions before HTTP request/runtime/
  admission work and before service input/cookie/OAuth/WebAuthn/database work;
- EN/RU disabled-state copy, join/initial-passkey form omission, existing-session redirects, and
  returning-login link preservation;
- successful returning login and restricted recovery HTTP behavior under a false enrollment
  decision;
- disabled-by-default tracked example plus configuration-checker mutation coverage; and
- Web lint, strict types, unit/coverage, production build, configuration, documentation,
  architecture, privacy, and public-data gates.

The tests do not prove deployed configuration delivery, coordinated worker restart/drain, dynamic
disablement, in-flight request termination, external route denial, operator
authentication/authorization/audit, distributed enrollment rate limits, monitoring, alerting,
capacity, live OAuth/database/WebAuthn behavior, abandoned-profile cleanup, invite repair, or
deployment.

## References

- [Identity step-up and device authority](0003-identity-step-up-and-device-authority.md)
- [Bounded authentication retention cleanup](0032-bounded-auth-retention-cleanup.md)
- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [Web workspace](../../apps/web/README.md)
- [System context](../architecture/SYSTEM_CONTEXT.md)
- [Data flow](../architecture/DATA_FLOW.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
