# ADR 0066: Bounded Admin invitation issuance kernel

- Status: Accepted (Access local; passkey/audit/host pending)
- Date: 2026-07-21
- Decision owners: Product, Admin/Auth, Security, Privacy, Database, and Operations
- Supersedes: None
- Superseded by: None

## Context

The Web enrollment flow already accepts a one-time credential containing one UUIDv4 plus a canonical
256-bit secret, immediately reduces the secret to its SHA-256 digest, and atomically redeems that
digest through the Web role. PostgreSQL separately grants `viberacing_admin` exactly one bounded
`issue_invite` function, with a 90-day absolute lifetime limit, fixed audit reference, and bounded
reason. At selection time no application composed that capability, every enrollment test used
synthetic or externally seeded data, and the repository had no working invite issuer.

A direct database script or one-shot operator CLI would close that usability gap while bypassing the
selected Admin trust boundary. VR-ADMIN-001 and VR-ABUSE-ADMIN-MISUSE require a separate policy,
individual Admin authority, fresh passkey, reason, and external append-only audit. A normal Web
session, repository access, database password, or shared shell identity cannot substitute for those
controls. The final separate-origin Admin host, concrete Access/member/passkey verifiers, and audit
backend do not yet exist, so this decision must advance the reusable application/database portion
without inventing a shortcut or claiming an operational surface.

The action also has an unavoidable distributed-effect boundary. PostgreSQL can atomically store the
invite and its database audit row, but it cannot atomically commit with a future external audit
service. Returning plaintext before audit completion could create an issued credential with missing
external evidence. Retrying after an ambiguous database response could mint multiple live invites.

## Decision

Add private workspace `@viberacing/admin` as a transport-free invitation application kernel. It has
no listener, route, page, CLI, process entry point, default authorization implementation, default
audit implementation, or deployable composition. A future request-scoped host must inject three
capabilities: authorization, external audit append, and the bounded invitation store.

The authorization gateway is invoked first and must return one frozen exact-key version 1 decision
for purpose `invite_issue`. It carries only an opaque individual `adm_` actor reference and separate
Access/passkey verification times. Both proofs must be no more than five minutes old, ordered and
not future-dated, and the decision must expire exactly five minutes after the passkey proof. The
gateway contract requires separate Access policy, individual Admin membership, and atomic
consumption of fresh passkey authority. The kernel provides no default gateway and accepts no normal
session, raw caller-built allow decision, shared identity, or generic purpose.

After authorization, the application uses Node's OS CSPRNG to create one invite UUIDv4, one distinct
database audit UUIDv4, and 128 request bits. It fixes reason `BETA_ADMISSION` and expiry to seven
days. Only after the external authorized acknowledgement and the second freshness/clock check does
it create the 256-bit invite secret. It accepts no input, alternate reason, selected expiry,
identifier, secret, or retry key. The resulting credential exactly matches the existing Web grammar
`vri_<uuid-v4>_<canonical-base64url-secret>`.

Before database work, the required external sink must append and exactly acknowledge a version 1
`invite.issue` event in phase `authorized`. The event contains only opaque actor, database-audit,
and request references, fixed reason, operation/expiry time, and phase. It cannot contain the invite
ID, plaintext secret, verifier digest, raw proof/token, configuration, database row, or error. After
acknowledgement, the application rereads its clock and rejects expired authority or backward time
before invoking the store.

The bounded store probes one client before submitting a fixed parameterized call. Its distinct
NOINHERIT login must have exactly one SET-only membership in the unchanged NOLOGIN, NOINHERIT
`viberacing_admin` role. While current and session identity are still that otherwise capability-free
login, the first probe requires non-privileged login and group attributes, CONNECT without
CREATE/TEMPORARY, no direct application-schema/function/private-table authority, safe search path,
read-write state, and matching TLS state. The adapter then performs one fixed
`SET ROLE viberacing_admin` and proves API usage without creation, no private schema/table
privilege, and exactly the single current `viberacing_owner`-owned, security-definer,
closed-search-path `issue_invite(uuid,bytea,timestamptz,uuid,text,text)` API capability. After the
exact issued result, one fixed `RESET ROLE` plus the repeated login probe is mandatory before reuse.
The pool has one client; failed, malformed, widened, or incompletely reset sessions are destroyed;
no generic query is exported.

Only after the database returns one exact success row must the same external sink append and
acknowledge phase `committed`. The one-time credential is constructed and returned only after that
acknowledgement. The application overwrites mutable request entropy, secret, digest, and adapter
copies on every path. It logs and persists none of them outside the existing database digest.

If authorization, initial audit, post-audit freshness/entropy, database execution/result, or
committed audit fails, no credential is returned and no automatic retry occurs. Initial-audit
failure creates no invite secret. An acknowledged first event followed by local or database failure
leaves an external authorization-attempt event. A database commit followed by result or final-audit
failure may leave one inaccessible orphan invite plus its database event and the external
authorization event; the secret is cleared and the invite can only expire. This slice adds no
lookup, revoke, list, reconciliation, repair, or retry capability. Protected correlation and
operator handling remain a host/deployment gate.

## Security and privacy consequences

The sequence makes separate authorization and external audit mandatory dependencies rather than
optional decorators, prevents database access before an acknowledged authorization event, and
withholds bearer material until committed audit acknowledgement. Exact shapes, times, purpose,
reason, entropy sizes, identifier grammar, query, role probe, and result checks fail closed. A
normal user session cannot reach a default composition because none exists.

This kernel does not itself verify Cloudflare Access, establish individual membership, perform
WebAuthn, provide a separate origin, or make the future audit backend append-only. ADR 0067 now adds
the first two as a separate local prerequisite, but the remaining adapters and deployment
responsibilities must still be proven together. A malicious host can inject permissive capabilities;
a compromised process can inspect memory; JavaScript/driver/runtime copies are not a secure-erasure
guarantee. Database-commit/audit-completion ambiguity deliberately sacrifices a credential rather
than weakening audit or retry behavior.

The existing invite ID, secret/digest, expiry, state, database audit reference, request reference,
fixed reason, and timestamps remain Security/Operational data under the current map. This kernel
adds transient opaque individual Admin actor reference plus two external phase records to the
planned external audit contract. They contain no user profile, invite ID/secret/digest, GitHub data,
raw access/passkey proof, IP address, user agent, configuration, or error. Before a real sink is
used, its jurisdiction, access, append-only enforcement, minimum/maximum retention, export,
incident-hold, actor offboarding, and deletion policy remain required.

## Alternatives considered

- **Add a direct local CLI or SQL command:** rejected because possession of a shell/database login
  is not separate policy, individual Admin identity, fresh passkey, or external audit.
- **Issue development invites from Web/Auth:** rejected because it merges normal session and Admin
  authority, widens the Web database role, and violates origin and role separation.
- **Return the credential after the database call and append audit later:** rejected because a
  usable credential could escape without the required committed external evidence.
- **Append only a post-commit event:** rejected because sink unavailability after database commit
  would leave no external evidence at all. The pre-event records authorized intent without claiming
  database success.
- **Automatically retry ambiguous database or audit failures:** rejected because the process cannot
  know whether the first invite committed and has no reviewed lookup/reconciliation authority.
- **Implement the final Admin UI and Access/WebAuthn stack in one slice:** deferred because their
  identity, separate-origin, cookie/challenge, external-sink, edge, and deployment contracts require
  independent review and evidence. This kernel introduces no substitute for them.

## Migration and rollback

There is no database schema or public protocol migration. The workspace reuses the exact reviewed
`pg` dependency and existing `viberacing_api.issue_invite` grant. No runtime service imports it and
no tracked environment enables it.

Rollback is to remove the workspace, root verifier wiring, lockfile importer, this ADR, and related
documentation. Existing database and Web invite contracts remain unchanged. If a future host has
already issued an invite, removing code does not revoke it; the existing expiry/redemption and Jobs
retention rules remain authoritative. Never add a generic rollback query or expose the plaintext
secret to recover an ambiguous operation.

## Verification

Current local evidence includes:

- 236 deterministic workspace unit and policy tests with 98.9% statements, 98.89% lines, 97.8%
  branches, and 100% functions, including the separate ADR 0067 Access/member boundary;
- positive exact ordering and Web-compatible credential checks;
- stale/future/wrong-purpose/open/accessor/proxy authorization denial before entropy or state work;
- initial/final audit acknowledgement and redaction checks, including database suppression before
  initial acknowledgement and credential suppression after final-audit failure;
- OS-CSPRNG size, UUID collision/grammar, fixed expiry/reason, immutable output, and mutable-copy
  clearing checks;
- protected configuration, loopback/verified-TLS policy, exact pre-role login/TLS/direct-denial
  probe, fixed role assumption, capability/table probe, fixed parameterized query, role reset,
  post-reset login proof, result-shape, client-destruction, and idle-signal checks;
- lint confinement proving no PostgreSQL import outside the pool adapter; and
- strict types, production compilation, root verifier wiring, frozen lockfile, and dependency
  inventory review.

The existing disposable database suite independently proves the Admin role's single capability and
cross-role denials. A separate opt-in synthetic integration now composes the built production
JavaScript and injected authorization/audit ports with one disposable hostname-verified TLS
PostgreSQL database. It applies the exact reviewed 40-migration ledger, proves an extra-membership
login fails before private-state mutation, then proves the narrow login stores one active invite and
one exact database audit row, leaves every non-target private table unchanged, resets its role, and
closes all connections. A separate local prerequisite now proves bounded Access signature/policy and
individual membership under synthetic keys. This is not a working issuer: a complete next gate still
needs a separate-origin Admin host with real Access policy/token plus protected key refresh,
consumed fresh-passkey proof and full authorization composition, a protected append-only audit
backend and retention policy, a narrow production-owned Admin login/TLS path, ambiguous-state
operator handling, monitoring, capacity/abuse controls, and deployed browser evidence.

## References

- [Bounded Admin Access and membership verifier](0067-bounded-admin-access-membership-verifier.md)
- [Project plan](../PROJECT_PLAN.md#administration-and-operations)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md#vr-abuse-admin-misuse-privileged-action-without-independent-authority)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Cloudflare and database capability isolation](0004-edge-service-and-database-isolation.md)
- [Identity, step-up, and device authority](0003-identity-step-up-and-device-authority.md)
- [Bounded invitation cleanup](0043-bounded-invite-retention-cleanup.md)
