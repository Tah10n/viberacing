# ADR 0067: Bounded Admin Access and membership verifier

- Status: Accepted (local Access/member verifier; passkey, host, and deployment pending)
- Date: 2026-07-21
- Decision owners: Admin/Auth, Security, Privacy, Operations, and Supply Chain
- Supersedes: Access/member-verifier deferral in ADR 0066
- Superseded by: None

## Context

ADR 0066 made a separate Access policy, individual Admin membership, and fresh passkey mandatory
inputs to invitation issuance, but deliberately injected the complete authorization decision. That
prevented a normal Web session or direct database script from becoming an issuer, while leaving the
first identity boundary entirely hypothetical.

Cloudflare sends a signed application token to the origin in `Cf-Access-Jwt-Assertion`. Its current
guidance requires origins to validate the signature, issuer, and application audience, recommends
the assertion header over the browser cookie, and publishes a current plus previous RSA signing key
for rotation. Accepting an unsigned identity header, email allowlist, service token, generic OIDC
claim, or caller-built actor reference would not establish the selected individual policy.

The Admin workspace still has no listener or deployed hostname. Fetching keys dynamically from a
request path would add outbound transport, caching, redirect, availability, and startup semantics to
the transport-free kernel. A local verifier can instead consume one protected, bounded snapshot of
the exact public keys and make key refresh an explicit host/deployment gate.

## Decision

Extend private workspace `@viberacing/admin` with a transport-free protected configuration reader
and one closed Access verifier. This is a prerequisite to, not a replacement for, the still-missing
fresh-passkey authorization gateway.

The protected reader accepts only four exact names:

```text
VIBERACING_ADMIN_ACCESS_TEAM_DOMAIN
VIBERACING_ADMIN_ACCESS_AUDIENCE
VIBERACING_ADMIN_ACCESS_JWKS
VIBERACING_ADMIN_ACCESS_MEMBERS
```

The team domain must be one lowercase `https://<team>.cloudflareaccess.com` origin with no port,
path, query, fragment, or credentials. The audience is one exact lowercase 256-bit hexadecimal
application tag. The JWKS snapshot contains one or two distinct public RSA keys with only `kid`,
`kty`, `alg`, `use`, `e`, and `n`; the algorithm is fixed to RS256, use to signing, exponent to
65537, key IDs to Cloudflare's 256-bit hexadecimal form, and modulus to canonical 2048–4096-bit
base64url. Private or alternate key fields fail closed.

The member list contains one to sixteen unique pairs of an opaque Cloudflare `sub` and a separately
generated canonical 128-bit `adm_` actor reference. A subject is restricted to a bounded opaque
ASCII identifier that cannot contain `@`, whitespace, path separators, or Unicode. The reader
immediately reduces it to an issuer-domain-separated SHA-256 digest in the resolved object. Raw
subjects remain only in the protected source environment and never enter verifier output. Duplicate
subject or actor mappings fail closed. The resolved configuration is frozen, non-enumerable,
JSON-redacted, and recognized by the verifier through an inaccessible instance registry; a
caller-built lookalike is rejected.

The verifier accepts exactly one bounded compact assertion string. It uses a local immutable JWKS
resolver and `jwtVerify` with only RS256, the exact issuer and audience, `typ=JWT`, required
`iss`/`aud`/`sub`/`iat`/`exp`/`type` claims, and 30 seconds of clock-skew tolerance. It then
independently requires:

- an exact three-field protected header with the configured 256-bit key ID;
- exactly one audience value rather than a broader multi-application assertion;
- token type `app`, a listed opaque human subject, and no service-token ID, common name, or positive
  service-token status;
- integral issued/expiry times, positive ordering, and an at-most-one-hour token lifetime; and
- a non-regressing second clock read with the assertion still strictly unexpired.

Membership comparison uses fixed-length issuer-bound digests and constant-time comparison. The only
successful result is a frozen, non-enumerable, JSON-redacted version 1 identity containing purpose
`invite_issue`, opaque actor reference, current verification time, and Access expiry. It contains no
JWT, subject, email, key ID, audience, issuer, raw claim, or reusable authorization. Every
malformed, wrong-key, wrong-policy, expired, service, unlisted, or reflective assertion becomes the
same `access_rejected` class.

The verifier does not read `CF_Authorization`, fetch identity, trust an email claim, contact
Cloudflare, start a browser ceremony, create a session, or return ADR 0066's final authorization
decision. A future separate-origin host must pass only the assertion header, independently consume
one fresh invite-purpose passkey proof for the same actor, ensure Access remains valid for the full
five-minute decision window, and then construct the exact request-scoped `authorize` closure.

Use exact-pinned `jose@6.2.3` for JWS/JWK parsing, WebCrypto-backed RS256 verification, and
registered JWT claim validation. Cloudflare's own Node/TypeScript guidance uses `jose`;
reimplementing compact JWT, RSA/JWK selection, and claim validation would create avoidable
cryptographic parser risk. The package is MIT, ESM, side-effect-free, has no dependencies or
lifecycle scripts, and is confined by lint to `access-verifier.ts`. Only the local-JWKS and
JWT-verification functions are used.

## Security and privacy consequences

Signature, issuer, audience, token type, human identity, and individual membership now fail closed
inside repository-owned application code. Email and service identities cannot become Admin actors.
Exact header and key shapes reject embedded or attacker-selected key locations, and a local snapshot
removes per-request network and redirect authority from this workspace.

The snapshot can become stale when Cloudflare rotates keys. Cloudflare currently publishes current
and previous keys and retains a previous key briefly after rotation; a future deployment must fetch,
validate, protect, refresh, atomically replace, and monitor the snapshot before enabling the Admin
host. This repository supplies none of that orchestration, no account-specific key, and no fallback
to an unknown key. Staleness is an availability failure, not a signature bypass.

The protected environment transiently contains the team domain, audience, public keys, raw opaque
subjects, and actor mappings. The assertion transiently contains signed identity claims and may
contain an email claim, but the verifier neither reads nor returns that field. Only an issuer-bound
subject digest replaces each raw subject in the resolved in-memory configuration; that configuration
also retains the required issuer, audience, public keys, and opaque actor mappings. Nothing is
logged, persisted, cached, exported, placed in an audit event, or sent to PostgreSQL by this slice.
JavaScript strings, environment storage, library internals, and process memory are not an erasure
guarantee.

This does not establish passkey presence or user verification, consume a one-time challenge, bind a
passkey to an actor, create a complete authorization decision, provide external append-only audit,
protect an origin from bypass, refresh keys, provision real policy, or deploy anything. A malicious
host can still omit this verifier or inject a different authorization port; the final composition
and deployment must prove the whole sequence.

## Alternatives considered

- **Trust the Access header or an upstream email header:** rejected because an origin bypass or
  forged header would become Admin authority, and account email is prohibited data.
- **Use a service token or shared operator identity:** rejected because VR-ADMIN-001 requires an
  attributable individual and no shared account.
- **Implement JWT/RS256 directly with Node primitives:** rejected because compact JWS, JWK
  selection, algorithm constraints, and claim validation are mature security-sensitive parsing
  surfaces covered by the reviewed dependency.
- **Fetch remote JWKS inside this slice:** deferred because it adds outbound network, DNS/TLS,
  redirects, cache/single-flight, deadlines, failure recovery, and monitoring to a workspace that
  intentionally has no transport or host.
- **Treat Access alone as authorization:** rejected because the selected invariant separately
  requires fresh application passkey step-up and one-time consumption.

## Migration and rollback

There is no database migration, role change, public protocol, route, cookie, listener, tracked
credential, or enabled runtime. Starting the website still does not apply or create a migration. The
only application dependency change is the exact zero-transitive `jose` package in the private Admin
workspace. The same reviewed slice patch-updates the root-only Markdown tool to
`markdownlint-cli2@0.23.1`; a later exact advisory override selects `js-yaml@5.2.2`. Neither tool is
part of a product runtime.

Rollback is to remove the config/verifier modules, dependency declaration and lock record, ADR/index
entry, notice/inventory records, tests, and current-state documentation. The ADR 0066 invitation
kernel and existing forty-migration database remain unchanged and unreachable without an injected
authorization port.

## Verification

Current local evidence includes:

- 236 deterministic Admin unit and policy tests with 98.9% statements, 98.89% lines, 97.8% branches,
  and 100% functions across the workspace;
- generated RS256 current/previous-key tokens and exact positive identity/redaction assertions;
- wrong key/algorithm/header/issuer/audience/type/subject/time, multi-audience, service-token,
  unknown-member, expiry-during-settlement, and backward-clock denials;
- configuration bounds, exact-key shape, private/alternate key rejection, duplicate key/member
  rejection, raw-subject reduction, reflective environment/runtime failure, and caller-built config
  denial; and
- ESLint confinement, strict type checking, production compilation, lock/inventory/license gates,
  and root verification.

The tests use generated synthetic keys and assertions. They do not validate a real Cloudflare token,
real team domain/application policy, hosted key rotation, direct-origin denial, browser passkey,
external audit, host, protected production configuration, monitoring, capacity, or deployment.

## References

- Cloudflare Access documentation: _Validating the Access token_
- Cloudflare Access documentation: _Application token_
- [Bounded Admin invitation kernel](0066-bounded-admin-invite-issuance-kernel.md)
- [Administration and operations](../PROJECT_PLAN.md#administration-and-operations)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Dependency policy](../security/DEPENDENCY_POLICY.md)
