# Vibe Racing Admin invitation kernel

This private workspace is the transport-free Access/member, application, and PostgreSQL boundary for
one future Admin action: issue one seven-day beta invitation. It is not an operational invite
issuer. A local verifier can now validate a synthetically or externally supplied Cloudflare Access
assertion against a protected bounded JWKS snapshot and individual-member map. The repository still
supplies no Admin page or API, separate deployed hostname, real Access policy/token or key-refresh
composition, WebAuthn step-up verifier, complete authorization gateway, external append-only audit
backend, production database login, monitoring, or deployment composition.

The workspace deliberately has no listener, route, page, CLI, process entry point, complete
authorization implementation, or default audit implementation. A future separately reviewed Admin
host must inject all three request-scoped capabilities before this kernel can produce a credential:

1. `authorize` must pass only `Cf-Access-Jwt-Assertion` through the local verifier, consume a fresh
   invite-purpose passkey proof for that exact individual, keep Access valid through the full
   decision window, then return the exact frozen decision described below.
2. `appendAudit` must append and acknowledge the exact external `authorized` event before any
   database connection.
3. `issueInvite` must use the bounded Admin store, which probes the exact database boundary and
   invokes only `viberacing_api.issue_invite`.
4. The same external sink must append and acknowledge the exact `committed` event before the
   application returns the one-time Web-compatible invite code.

Normal Web sessions, GitHub membership, caller-built allow objects, shared Admin identities, an
alternate reason, caller-selected expiry, invitation identifiers, secrets, SQL, or retry commands
are not accepted.

## Access and individual membership prerequisite

`resolveAdminAccessConfig` accepts only these protected names:

```text
VIBERACING_ADMIN_ACCESS_TEAM_DOMAIN
VIBERACING_ADMIN_ACCESS_AUDIENCE
VIBERACING_ADMIN_ACCESS_JWKS
VIBERACING_ADMIN_ACCESS_MEMBERS
```

The team domain is one exact lowercase Cloudflare Access HTTPS origin. The audience is one exact
256-bit lowercase application tag. The bounded JWKS snapshot contains only one current key or one
current plus one previous RS256 public key; private material, extra fields, alternate algorithms,
duplicate IDs, and moduli outside 2048–4096 bits fail closed. The one-to-sixteen member list maps a
bounded opaque, non-email Access `sub` to a unique canonical 128-bit `adm_` reference. Raw subjects
are reduced to an issuer-bound SHA-256 digest in the frozen, non-enumerable, JSON-redacted
configuration object.

`createAdminAccessVerifier` accepts exactly one compact assertion. It verifies RS256 locally through
the reviewed `jose` boundary, requires an exact three-field protected header, issuer, one audience,
`app` token type, integral times, no more than a one-hour token lifetime, no service-token identity,
and a still-unexpired second clock read. Individual membership is compared through constant-time
fixed-length digests. Success returns only a frozen redacted version 1 `invite_issue` identity with
the opaque actor, verification time, and Access expiry. It never returns or logs the JWT, `sub`,
email, key ID, issuer, audience, or raw claim.

The snapshot is intentionally local so this workspace retains no outbound key-fetch transport. A
future protected host/deployment must retrieve Cloudflare's current and previous keys, validate and
atomically refresh the configuration around rotation, monitor staleness, pass only the assertion
header, and fail closed. No real account key, subject, audience, token, or host configuration is
tracked. Access verification still does not establish fresh passkey proof or produce the invitation
kernel's complete authorization decision.

## Closed authorization and output

The request-scoped authorization gateway returns one frozen, exact-key decision with:

- version `1`, decision `allow`, and purpose `invite_issue`;
- an opaque individual actor reference matching `adm_` plus 128 bits of canonical base64url text;
- separate Access and passkey verification times no more than five minutes old, ordered before the
  application clock; and
- an expiry exactly five minutes after passkey verification.

This object remains a closed complete-gateway contract. ADR 0067 implements only its Access and
individual-membership prerequisite. The future gateway must consume a one-time passkey challenge for
the same actor independently of a normal user session. The kernel rejects an open, stale,
future-dated, wrong-purpose, unsealed, accessor-bearing, or reflective result before entropy, audit,
or database work.

After authorization, Node's OS-backed CSPRNG creates two distinct UUIDv4 identifiers, 128 request
bits, and a 256-bit invitation secret. The reason is fixed to `BETA_ADMISSION`; expiry is fixed to
seven days, below the database's absolute 90-day ceiling. Only after both external audit phases and
the database call succeed does the kernel return:

```text
vri_<uuid-v4>_<canonical-32-byte-base64url-secret>
```

That is the exact grammar already accepted by the Web enrollment parser. The plaintext secret is
never included in either audit event or the database call. Mutable request entropy, plaintext
secret, verifier digest, and database-adapter copies are overwritten on every success and failure
path; JavaScript, driver, runtime, operating-system, and allocator copies are not an erasure
guarantee. The returned string is necessarily immutable and becomes the future caller's one-time
delivery responsibility.

## External audit ordering

Both external events are versioned, closed, frozen records containing only:

- action `invite.issue`;
- phase `authorized` or `committed`;
- opaque actor, database audit-event, and request references;
- fixed reason;
- operation and invite-expiry timestamps; and
- version `1`.

They contain no invite ID, secret, verifier digest, raw Access/passkey proof, token, database row,
configuration value, or error. The sink acknowledgement must exactly repeat version, phase, and
request ID with `accepted: true`.

If the first event fails, database work never begins and no invite secret is generated. After its
acknowledgement, the kernel rereads the clock, rejects expired authority or backward time, and only
then creates the invite secret. A post-audit clock/entropy failure leaves only the external
authorization-attempt event. If database execution or result validation is ambiguous, the kernel
returns no credential and performs no automatic retry; the external `authorized` event plus any
database-owned audit row are the only possible evidence. If the database commits but the second
external event fails, the credential is cleared and not returned. That orphan invite can only expire
under the existing retention policy; this slice adds no lookup, recovery, revoke, list, repair, or
retry authority. A future host needs protected correlation and operator handling before real
issuance is enabled.

## Database boundary

The only PostgreSQL driver import is `src/database-pool.ts`. The pool is bounded to one client and
uses a distinct NOINHERIT login that may set only the NOLOGIN, NOINHERIT `viberacing_admin` role.
The connection begins under that otherwise capability-free login so its own TLS session remains
visible without granting a statistics role. Before every fixed issuance call, the adapter requires:

- current and session identity both equal the exact configured NOINHERIT login;
- one non-admin, non-inherited, SET-only Admin membership and no other group membership;
- no superuser, database/role creation, replication, or RLS-bypass authority;
- CONNECT without CREATE or TEMPORARY;
- an unchanged non-login, non-privileged Admin role with no outbound membership;
- no direct login usage or creation on either application schema, no executable application
  function, and no private-table privilege;
- `pg_catalog,pg_temp`, read-write state, and observed TLS state matching configuration;
- one fixed `SET ROLE viberacing_admin`, followed by an exact effective-role check;
- API schema usage without creation, no private-schema usage or private-table privilege, and exactly
  the one `viberacing_owner`-owned, security-definer, closed-search-path
  `issue_invite(uuid,bytea,timestamptz,uuid,text,text)` API capability.

The adapter submits one fixed parameterized materialized query and validates one exact
`issued: true` row. It then performs one fixed `RESET ROLE` and repeats the login boundary before
the session can return to the pool. Failed, malformed, widened, or incompletely reset sessions are
destroyed; post-write reset/probe failure is treated as ambiguous committed state. The adapter
exposes no generic query, table, migration, Web, Ingest, Jobs, owner, or second Admin capability.

The procedure writes the invite and one minimal `admin_audit_events` row at the same
PostgreSQL-owned timestamp in one statement. A duplicate request or audit identifier rolls back both
writes, audit updates are rejected, and the fixed Jobs audit cleanup deletes at most 1,000 globally
ordered ranking/Admin events older than 180 days per call.

Only these configuration names are recognized by the exported protected reader:

```text
NODE_ENV
VIBERACING_ADMIN_DATABASE_HOST
VIBERACING_ADMIN_DATABASE_PORT
VIBERACING_ADMIN_DATABASE_NAME
VIBERACING_ADMIN_DATABASE_USER
VIBERACING_ADMIN_DATABASE_PASSWORD
VIBERACING_ADMIN_DATABASE_TLS_MODE
```

Cleartext is permitted only for an explicit development/test loopback. Every other environment
requires `verify-full`, a certificate-valid DNS hostname, and TLS 1.2 or later. The password is
bounded, non-enumerable, and JSON-redacted. No tracked value is a working credential, and no current
host reads this configuration in production.

## Verification

Run from the repository root:

```text
pnpm run lint:admin
pnpm run typecheck:admin
pnpm run test:admin:coverage
pnpm run build:admin
pnpm run test:admin:postgres-integration
pnpm run verify
```

Current deterministic evidence is 236 tests with 98.9% statements, 98.89% lines, 97.8% branches, and
100% functions. They cover exact Access configuration/JWKS/member shapes, generated
current/previous-key RS256 assertions, algorithm/key/issuer/audience/service/member/time denial,
redacted identity and dependency confinement, plus closed authorization/audit/result shapes,
ordering, freshness, purpose, exact credential grammar, entropy and mutable-buffer clearing,
ambiguous failure behavior, configuration, TLS policy, two-phase login/role boundary,
reset-before-reuse, client destruction, and PostgreSQL-import confinement. A separate opt-in
synthetic integration builds the production Admin JavaScript, applies the reviewed seven-migration
ledger to one disposable TLS PostgreSQL container, rejects an extra-membership login before
private-table mutation, and runs the exact injected authorization/audit application through the
narrow login. It proves hostname-verified TLS, one stored active invite, one exact database audit
row, no non-target private-table mutation, role reset, and closed connections. Complete
authorization and external audit remain injected; there is no real Access policy/token/key refresh,
passkey, append-only sink, browser, host, protected production login/certificate, capacity,
monitoring, operational issuer, or deployment evidence.
