# ADR 0012: Bounded public HTTP problem boundary

- Status: Accepted (server-only factory implemented; route integration pending)
- Date: 2026-07-15
- Decision owners: Web, API, Security, Privacy, and Operations
- Supersedes: None
- Superseded by: None

## Context

`ProblemDetailsV1` defines a closed public error body, but a schema alone does not generate a safe
request identifier, choose one status/retry policy per code, prevent reuse of an attacker-supplied
identifier, or set response headers. Every future `/v1` route needs the same non-reflective baseline
before route-specific authentication, admission, cache, or retry policy is added.

A caller-controlled `x-request-id`, driver exception, validation issue, URL, hostname, stack, or
record value must not enter a public error. A malformed fallback is also unsafe: if entropy or
contract validation fails, the application cannot claim it returned `ProblemDetailsV1`.

## Decision

Use a server-only Web module to generate each request ID from exactly 16 bytes returned by Node's
cryptographic random source. Unpadded base64url encoding produces the schema's exact 22-character
payload and `req_` prefix. The generator returns a frozen opaque token with a module-private runtime
brand, not a branded string. The response factory verifies the token through own data descriptors,
does not invoke accessors, and therefore cannot accept a client header or an arbitrary matching
string by accident.

The factory owns this complete mapping:

| Error code                | HTTP status | Title                   | Retryable |
| ------------------------- | ----------- | ----------------------- | --------- |
| `invalid_request`         | 400         | Invalid request         | false     |
| `unauthorized`            | 401         | Unauthorized            | false     |
| `forbidden`               | 403         | Forbidden               | false     |
| `not_found`               | 404         | Not found               | false     |
| `conflict`                | 409         | Conflict                | false     |
| `validation_failed`       | 422         | Validation failed       | false     |
| `rate_limited`            | 429         | Rate limited            | true      |
| `internal_error`          | 500         | Internal server error   | false     |
| `temporarily_unavailable` | 503         | Temporarily unavailable | true      |

Before serialization, the complete null-prototype object passes the generated runtime validator and
is frozen, so an inherited `toJSON` cannot replace its body. The HTTP response uses
`application/problem+json; charset=utf-8`, repeats the generated identifier only in `x-request-id`,
and sets `Cache-Control: no-store`. It adds no CORS header, cookie, reflected cause, extension
field, or route-selected detail. Entropy, token, kind, or contract failure throws one generic
internal exception with a bounded code and no source value.

This module is a common baseline, not an endpoint. A future route must still implement its exact
path/request contract, content negotiation, method handling, `Allow`, `WWW-Authenticate`, and
`Retry-After` semantics where applicable, CORS decision, admission/backpressure, route-wide
deadline, store-error translation, safe operational event, and success/cache policy. It must
generate one token at request entry and must not replace it with an inbound header.

## Security and privacy consequences

The 128-bit random identifier is correlation data, not authentication, authorization, CSRF, replay,
or idempotency authority. It is safe to return to the requester and may later join a bounded
operational event, but the current helper creates no log or retained copy. The opaque token prevents
ordinary server code from treating untrusted text as a generated identifier, while descriptor checks
contain accessor-backed, proxied, or malformed test inputs.

`no-store` prevents error bodies from becoming a shared cache surface. Omitting CORS is the explicit
pre-route default, not permission for a future endpoint to inherit an ambient wildcard. The stable
mapping avoids leaking whether a private record exists; membership-sensitive routes still require
constant response and timing design beyond this helper.

Affected invariants are VR-PUBLIC-001, VR-DATA-001, and VR-ABUSE-001. Primary attacker stories are
VR-ABUSE-PUBLIC-SCRAPE, VR-ABUSE-RESOURCE-EXHAUSTION, VR-ABUSE-DATABASE-ROLE,
VR-ABUSE-AUTH-TAKEOVER, and VR-ABUSE-RECOVERY-ORACLE.

## Alternatives considered

- **Reuse an inbound request ID:** rejected because a caller could inject log correlation, choose a
  victim's identifier, or place reflected content in headers and bodies.
- **Use a TypeScript-branded string only:** rejected because casts and plain JavaScript erase the
  brand at runtime. The opaque frozen token adds an executable boundary.
- **Return a framework-default error:** rejected because its body, cache behavior, request ID, and
  production/development detail are not the canonical contract.
- **Accept status, title, or a retry flag from each route:** rejected because it permits semantic
  drift for the same public code.
- **Return a deterministic fallback ID after entropy failure:** rejected because collisions hide
  distinct failures and falsely claim secure correlation.
- **Add route-specific auth/retry/CORS headers here:** rejected because those values depend on the
  selected endpoint and authentication or deployment contract.

## Migration and rollback

There is no route, persistent state, cache, or database migration. Rollback removes the helper,
tests, and this ADR together. Once a route consumes the helper, rollback must either preserve the
same public contract through an equivalent implementation or disable the route; it must not fall
back to a framework error or accept inbound request IDs.

## Verification

Current repository evidence covers:

- exact 16-byte entropy requests, production cryptographic generation, unpadded base64url shape,
  frozen opaque tokens, and distinct generated values;
- all nine status/title/retry mappings and exact `ProblemDetailsV1` bodies;
- `application/problem+json`, `no-store`, matching `x-request-id`, and absent CORS;
- unavailable, short, accessor-backed, and revoked entropy/token inputs; unknown kinds; and no
  reflected private failure value; and
- generated contract validation plus null-prototype serialization under an inherited hostile
  `toJSON`.

No `/v1` route, request parser, method/content negotiation, store-error translation, logging sink,
rate limit, cache, deployment, or end-to-end HTTP evidence exists yet.

## References

- [Public protocol contracts](../../contracts/README.md)
- [Compatibility policy](../architecture/COMPATIBILITY_POLICY.md)
- [Project plan](../PROJECT_PLAN.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Web workspace](../../apps/web/README.md)
