# ADR 0027: Bounded pairing activation composition

- Status: Accepted (local transport-free composition; HTTP and deployment pending)
- Date: 2026-07-16
- Decision owners: Web/Auth, Database, Connector, Security, Privacy, and Operations
- Supersedes: None
- Superseded by: None

## Context

ADR 0026 defines one strict Ed25519 possession proof, and revision 0003 exposes the minimum approved
pairing material plus an atomic activation procedure. They intentionally remain separate: the pure
verifier cannot resolve a poll token, while the database cannot prove that its Web-role caller
verified the pending private key. Calling `activate_pairing` from a route or a generic repository
would therefore leave the central device-authority invariant dependent on convention.

The plan also requires a high-entropy poll token whose plaintext is returned once and whose database
representation is keyed. No application scheme, protected key reader, rotation behavior,
least-privileged read-write pool, generic timing policy, or bounded activation composition existed.
This slice must close those local server boundaries without claiming that pairing start, browser
approval, WebAuthn verification, anonymous HTTP admission, a real login, or a connector client is
operational.

## Decision

### Poll-token verifier

A version 1 poll token is exactly 32 random bytes encoded as 43 characters of canonical unpadded
base64url. Web/Auth derives the database verifier with HMAC-SHA-256 over these exact bytes:

```text
UTF8("viberacing-pairing-poll-verifier-v1") || LF || raw_poll_token
```

The HMAC key is exactly 32 bytes. Configuration requires
`VIBERACING_WEB_PAIRING_POLL_PRIMARY_KEY_BASE64URL` and optionally accepts
`VIBERACING_WEB_PAIRING_POLL_SECONDARY_KEY_BASE64URL`. Both values must be canonical unpadded
base64url, and duplicate material is rejected in constant time. ADR 0028's pairing-start boundary
persists only the primary-key digest. Activation computes both candidates so an operator may
introduce a new primary while accepting transactions created under the previous secondary for the
existing ten-minute database lifetime. Removing the secondary ends that overlap; no key identifier
or plaintext token is added to PostgreSQL.

The protected reader retains decoded key bytes only inside one closeable derivation capability. It
returns two fresh digest buffers per admitted attempt, using a domain-separated inactive dummy as
the second fixed-shape candidate when no secondary is configured. Malformed tokens still take the
same HMAC and database lookup shape but are never activation-eligible. Token and digest copies are
overwritten after settlement, and closing the configured application overwrites the retained key
buffers. This is defense in depth rather than a guarantee about runtime or driver copies.

### Database boundary

Pairing reuses the existing environment-owned Web/Auth login and its six `VIBERACING_WEB_DATABASE_*`
settings because revision 0003 deliberately grants the identity and pairing procedures to the same
`viberacing_web` service role. It does not reuse the public-score pool: a separate server-only pool
has application name `viberacing-web-pairing`, a maximum of four connections, the existing strict
TLS and bounded deadline policy, and an explicit read-write startup setting.

Every checkout probes that the effective role is exactly `viberacing_web`, the distinct login is
narrow and belongs to no other group, the search path is `pg_catalog,pg_temp`, and
`default_transaction_read_only` is off. One fixed query presents exactly two verifier digests to
`read_pairing_verification_material`; its result may select at most one active candidate and must
contain only one canonical pairing ID plus exact 32-byte challenge and public key. A second fixed
query calls `activate_pairing` with only the selected digest and server-generated device, audit, and
request identifiers. No caller controls SQL, procedure name, source, profile, key identifier, or
pairing identifier.

The high-level adapter owns the complete read-proof-activate sequence. For every structurally valid
lookup outcome, it runs the strict ADR 0026 verifier once, using fixed invalid material when lookup
or input is ineligible, and calls activation only for one unique approved material row with a valid
proof. Revision 0003 rechecks poll possession, approval, expiry, pending-key state, source binding,
and profile state atomically, closing races after the read. Failed boundary probes, malformed
results, query failures, and release failures destroy the checked-out client and expose only stable
non-reflective errors.

### Transport-free application policy

The application accepts only a plain object with exactly `pollToken` and `possessionSignature`.
Every admitted attempt generates its own 128-bit `req_` request ID through the common opaque
factory, 128-bit `dev_` device ID, and version-4 audit UUID. Caller identifiers and correlation
headers are not accepted.

One process admits at most four activation attempts concurrently and holds each lease through a
minimum 250-millisecond settlement floor. Together those fixed bounds limit admitted database/proof
work to a long-run steady-state maximum of 16 completions per second per process under the minimum
path. It is not a strict sliding-window cap, and short windows may still observe a boundary burst.
Overload performs no database work. Every malformed, missing, unapproved, expired,
invalid-signature, raced, or internal case returns the same frozen `not_activated` decision with
only its server request ID; success adds only `activated` and the issued device ID. Timing failure
after a database success also returns the generic decision, and later polling is the recovery
mechanism.

This local floor and concurrency gate protect the dormant process boundary; they are not a client
identity, distributed rate limit, capacity result, or anti-automation control. No HTTP route may
construct this application until bounded body/header parsing, edge and service attempt limits,
deadline/cancellation semantics, response contracts, and generic external timing have their own
review and negative tests.

## Security and privacy consequences

Possession of a poll token still cannot approve a transaction, choose a source, substitute a key, or
activate without the exact pending private key. The application never accepts a caller-selected
profile, source, pairing ID, public key, device ID, audit ID, or request ID. Primary/secondary
overlap is bounded by the existing pairing expiry and does not create a reusable bearer credential.

The poll token, HMAC keys, verifier candidates, possession signature, approved challenge, and public
key are existing Security data. This slice adds no database column, cookie, browser state, log,
metric, analytics event, cache, export, or network destination. The deployment password and
poll-verifier keys remain environment/secret-manager values that are never tracked or reflected.
Request, device, and audit identifiers use already mapped Operational or Security classes; only the
database procedure retains the activated device and audit reference.

Affected invariants are VR-DEVICE-001, VR-DATA-001, VR-PUBLIC-001, and VR-RELEASE-001. Primary
attacker stories are VR-ABUSE-PAIRING-GUESS, VR-ABUSE-DEVICE-KEY-THEFT, VR-ABUSE-DEVICE-ESCALATION,
VR-ABUSE-DATABASE-ROLE, VR-ABUSE-RESOURCE-EXHAUSTION, and VR-ABUSE-SECRET-LEAK.

## Alternatives considered

- **Store a raw SHA-256 poll-token digest:** rejected because a database disclosure would permit
  direct offline verification of the bearer token.
- **Use only one configured HMAC key:** rejected because every rotation would unnecessarily cancel
  all still-valid approved transactions.
- **Persist a poll-key identifier:** rejected because the existing short-lived row can be resolved
  safely by two bounded candidates and needs no new retained metadata or migration.
- **Reuse the read-only public-score pool:** rejected because activation mutates device, pairing,
  source, and audit state and must prove an explicit read-write runtime boundary.
- **Expose the low-level activation procedure to application callers:** rejected because proof
  verification would again be optional convention rather than the adapter's only control flow.
- **Return distinct invalid, expired, rate, database, and signature outcomes:** rejected because
  they create a poll-token/state oracle before an external response and timing policy exists.
- **Add the HTTP route now:** rejected because anonymous transport parsing, distributed attempt
  controls, connector response contracts, and load evidence are separate unfinished boundaries.

## Migration and rollback

This decision adds no SQL migration, public contract, route, login, persistent field, supported
connector version, or deployment. It adds a protected Web configuration reader, dedicated pool,
closed activation adapter, transport-free application, tests, tracked non-working key placeholder,
and documentation. Rollback removes those dormant modules and configuration schema together; the
revision 0003 procedures and ADR 0026 pure proof remain unavailable to HTTP callers.

If a future route consumes this boundary, rollback must disable that route and preserve generic poll
behavior. It must not bypass possession proof, reuse the compose owner, fall back to an unkeyed
digest, or keep an old secondary key beyond the reviewed overlap window.

## Verification

Deterministic tests cover canonical and malformed tokens, the exact HMAC message, primary/secondary
rotation, duplicate/invalid/unreadable configuration, key and digest clearing, fixed two-candidate
queries, copied driver parameters, exact read-write role/login/search-path probe, strict material
mapping, the shared Ed25519 vector, invalid and ambiguous proof paths, generated identifier bounds,
admission saturation, minimum-settlement ordering, generic failures, destructive release, close, and
driver-import confinement.

Focused Web lint, type, coverage, production build, generated/configuration/security checks, and the
full repository verification gate pass before commit. These tests use injected pools and synthetic
keys. They do not open a network connection, prove a deployment login/TLS certificate, start or
approve a pairing, verify WebAuthn, activate a real key, impose edge/client rate limits, or expose
an HTTP endpoint.

## References

- [ADR 0003](0003-identity-step-up-and-device-authority.md)
- [ADR 0004](0004-edge-service-and-database-isolation.md)
- [ADR 0011](0011-bounded-web-postgresql-score-adapter.md)
- [ADR 0026](0026-bounded-pairing-possession-proof.md)
- [AgentAccount pairing database capability](../../database/migrations/0003_agent_accounts_installations_and_pairing.sql)
- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Dependency policy](../security/DEPENDENCY_POLICY.md)
