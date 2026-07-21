# Vibe Racing Admin invitation kernel

This private workspace is the transport-free application and PostgreSQL boundary for one future
Admin action: issue one seven-day beta invitation. It is not an operational invite issuer. The
repository still supplies no Admin page or API, separate deployed hostname, Cloudflare Access
verifier, individual-admin membership source, WebAuthn step-up verifier, external append-only audit
backend, production database login, monitoring, or deployment composition.

The workspace deliberately has no listener, route, page, CLI, process entry point, default
authorization implementation, or default audit implementation. A future separately reviewed Admin
host must inject all three request-scoped capabilities before this kernel can produce a credential:

1. `authorize` must consume separate Access policy, individual Admin membership, and a fresh
   invite-purpose passkey proof, then return the exact frozen decision described below.
2. `appendAudit` must append and acknowledge the exact external `authorized` event before any
   database connection.
3. `issueInvite` must use the bounded Admin store, which probes the exact database boundary and
   invokes only `viberacing_api.issue_invite`.
4. The same external sink must append and acknowledge the exact `committed` event before the
   application returns the one-time Web-compatible invite code.

Normal Web sessions, GitHub membership, caller-built allow objects, shared Admin identities, an
alternate reason, caller-selected expiry, invitation identifiers, secrets, SQL, or retry commands
are not accepted.

## Closed authorization and output

The request-scoped authorization gateway returns one frozen, exact-key decision with:

- version `1`, decision `allow`, and purpose `invite_issue`;
- an opaque individual actor reference matching `adm_` plus 128 bits of canonical base64url text;
- separate Access and passkey verification times no more than five minutes old, ordered before the
  application clock; and
- an expiry exactly five minutes after passkey verification.

This object is a closed adapter contract, not an implemented verifier. The future gateway must
consume a one-time passkey challenge and establish individual policy independently of a normal user
session. The kernel rejects an open, stale, future-dated, wrong-purpose, unsealed, accessor-bearing,
or reflective result before entropy, audit, or database work.

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
uses a distinct login that may set only the NOLOGIN, NOINHERIT `viberacing_admin` role. Before every
fixed issuance call, one closed probe requires:

- effective role `viberacing_admin` and the exact configured distinct NOINHERIT login;
- one non-admin, non-inherited, SET-only Admin membership and no other group membership;
- no superuser, database/role creation, replication, or RLS-bypass authority;
- CONNECT without CREATE or TEMPORARY;
- an unchanged non-login, non-privileged Admin role with no outbound membership;
- API schema usage without creation, no private-schema usage or private-table privilege, and exactly
  the one `viberacing_owner`-owned, security-definer, closed-search-path
  `issue_invite(uuid,bytea,timestamptz,uuid,text,text)` API capability;
- `pg_catalog,pg_temp`, read-write state, and observed TLS state matching configuration.

The adapter then submits one fixed parameterized materialized query and validates one exact
`issued: true` row. Failed, malformed, or widened sessions are destroyed. It exposes no generic
query, table, migration, Web, Ingest, Jobs, owner, or second Admin capability.

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
pnpm run verify
```

Current deterministic evidence is 125 tests with 100% statements, lines, and functions plus 98.16%
branches. They cover closed authorization/audit/result shapes, ordering, freshness, purpose, exact
credential grammar, entropy and mutable-buffer clearing, ambiguous failure behavior, configuration,
TLS policy, narrow pool/query structure, client destruction, and PostgreSQL-import confinement. The
existing database integration independently proves the Admin role can invoke only the bounded
procedure; these new application tests use injected authorization, audit, pool, and controlled
clock/entropy fixtures plus one OS-backed credential-shape check. There is no composed PostgreSQL,
real Access/passkey, external audit, browser, host, capacity, monitoring, or deployment evidence for
this workspace.
