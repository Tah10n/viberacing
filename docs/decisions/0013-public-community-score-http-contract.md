# ADR 0013: Public Community score HTTP contract

- Status: Accepted (schema and contract-only OpenAPI operation implemented; route pending)
- Date: 2026-07-15
- Decision owners: Web, API, Security, Privacy, and Operations
- Supersedes: None
- Superseded by: None

## Context

The public score projection, response schema, mapper, least-privileged PostgreSQL adapter, and
common problem-response factory now exist, but none defines the exact public URL or turns an
untrusted URL into a storage call. Implementing a route before fixing that boundary would leave the
query grammar, supported season range, method and `Accept` behavior, overload errors, cache policy,
and CORS posture to framework defaults.

The database accepts only inclusive Monday season labels from `1999-12-27` through `2099-12-28`. The
previous JSON Schema subset checked calendar syntax but could still accept a valid Tuesday. The
generated OpenAPI document exposed components only, so it could not drift-check a route's query,
response, or header contract.

## Decision

Reserve one unauthenticated public read operation:

```text
GET /v1/community/scores?seasonStart=YYYY-MM-DD
```

`seasonStart` is the only query field. The manifest's `closed-single-value` policy means every
declared field appears exactly once and every undeclared field is rejected. `seasonStart` is
required, uses a canonical calendar date, falls inside the inclusive database range, and has ISO
weekday 1. The future URL parser must also reject an unknown parameter, a missing value, more than
one `seasonStart`, empty encoding, or malformed URL before storage access. An unknown but valid
season returns HTTP 200 with an empty `participants` array; it does not reveal whether a private or
hidden profile exists.

`CommunityScoreQueryV1` is a closed one-field schema. Three reviewed schema extensions express the
semantic date boundary:

- `x-viberacing-dateMinimum` and `x-viberacing-dateMaximum` define canonical inclusive dates; and
- `x-viberacing-isoWeekday` accepts an integer from 1 through 7.

The checker requires a complete ordered extension set on a `format: date` string. The runtime
validator emits stable non-reflective `date_minimum`, `date_maximum`, or `iso_weekday` issues. The
same constraints now protect the response season start and end, with ISO weekday 7 for the latter;
the mapper retains its cross-field six-day-window check.

The version manifest contains one closed operation record. The generator accepts only a sorted,
unique, safe `/v1` GET record whose referenced schemas exist, whose problem statuses are bounded and
ordered, and whose current policies are exactly `no-store` and same-origin. It emits this response
matrix:

| Status | Media type                 | Meaning                                     |
| ------ | -------------------------- | ------------------------------------------- |
| 200    | `application/json`         | Closed `CommunityScorePageV1`               |
| 400    | `application/problem+json` | Invalid query or URL request                |
| 406    | `application/problem+json` | No supported representation is acceptable   |
| 429    | `application/problem+json` | A future client-rate policy rejects a read  |
| 500    | `application/problem+json` | Unexpected internal failure                 |
| 503    | `application/problem+json` | Admission, store, or dependency unavailable |

Every documented response carries `Cache-Control: no-store`, `Vary: Accept`, and the same generated
`x-request-id` shape. The operation has a same-origin CORS policy and grants no cross-origin read
header. The initial success response is deliberately not cacheable: profile hide and deletion must
be immediately observable, and no reviewed cache invalidation mechanism exists yet.

`ProblemDetailsV1` and the common factory add `method_not_allowed`/405 and `not_acceptable`/406
before the first endpoint exists. The 405 code is reserved for explicit route method handling and
therefore is not listed as a response to the GET operation itself. Adding the two closed enum
members is safe without a new wire version only because no deployed endpoint or released consumer
exists; after deployment, the normal compatibility/versioning rules apply.

The generated document and operation are marked `contract-only`. Their presence does not claim a
Next.js route, parser, rate limiter, admission controller, deadline, log sink, database connection,
deployment, DNS name, or live API.

## Security and privacy consequences

The one query value is a public season label. It is not identity, authentication, authorization,
idempotency, or an anti-abuse signal, and the contract creates no retention or log sink. Future
operational events may contain only the server-generated request ID, stable coarse outcome, and
bounded timing/counter fields already listed in the privacy data map; they must not contain the raw
URL, headers, database configuration, driver error, SQL, handle, or row value.

Rejecting non-Monday and out-of-range values before storage removes an avoidable database work and
error surface. `no-store` avoids stale visibility after hide/delete. Same-origin-without-CORS is a
deliberate baseline, not CSRF protection and not proof that edge origin controls exist. A documented
429 response does not prove a client-rate policy. The route must separately acquire bounded
admission before starting database work, translate an exhausted admission budget to 503, and not
release it while work continues in the background.

Affected invariants are VR-PUBLIC-001, VR-TRUST-001, VR-INGEST-001, and VR-DELETE-001. Primary
attacker stories are VR-ABUSE-PUBLIC-SCRAPE, VR-ABUSE-RESOURCE-EXHAUSTION, VR-ABUSE-DATABASE-ROLE,
and VR-ABUSE-DIRECT-ORIGIN.

## Alternatives considered

- **Choose the current season implicitly:** rejected because server timezone and rollover behavior
  would become hidden contract state and make replay, cache, and historical reads ambiguous.
- **Use an unconstrained string query:** rejected because the database range and Monday invariant
  would remain undocumented and route implementations could disagree.
- **Use only standard `format: date`:** rejected because it validates the calendar but not the
  supported range or ISO weekday.
- **Enable shared public caching immediately:** rejected because hide/delete invalidation and cache
  keys are not implemented or verified.
- **Allow wildcard CORS:** rejected because no reviewed cross-origin browser consumer exists.
- **Rely on framework-default 405/406 responses:** rejected because their body, request ID, cache,
  and disclosure behavior are not the canonical public problem contract.
- **Hand-edit an OpenAPI path:** rejected because canonical schema/manifest generation and drift
  checks must remain the source of truth.

## Migration and rollback

There is no route, database migration, cache, retained request, or deployment change. Rollback
removes the query component and manifest operation, restores the pre-operation generated artifacts,
and removes the two unused problem codes together with their factory mappings. Once a route or
released client consumes this contract, rollback must disable the route or preserve a compatible
version rather than silently changing path, query, response, or error semantics.

## Verification

Current repository evidence covers:

- canonical query acceptance at both inclusive boundaries and rejection of invalid calendars,
  out-of-range dates, Tuesdays, missing fields, accessors, and unknown fields without reflection;
- runtime date-extension bounds, weekday behavior, malformed-extension fail-closure, and frozen
  generated schemas;
- exact manifest operation semantics, safe path/schema references, ordered problem statuses, closed
  query multiplicity, duplicate path/ID rejection, generated drift, and the complete OpenAPI
  path/header/media matrix;
- exact 405 and 406 problem mappings in the common server-only response factory; and
- separation of scalar weekday contract failures from valid-date cross-field season-window drift in
  the mapper.

No HTTP route, duplicate-URL-parameter parser, `Accept` parser, method dispatcher, `Allow` header,
admission controller, route deadline, store translation, safe log event, live database login, edge
policy, or end-to-end response evidence exists yet.

## References

- [Public protocol contracts](../../contracts/README.md)
- [Common HTTP problem boundary](0012-bounded-public-http-problem-boundary.md)
- [Public score adapter](0011-bounded-web-postgresql-score-adapter.md)
- [Compatibility policy](../architecture/COMPATIBILITY_POLICY.md)
- [Project plan](../PROJECT_PLAN.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
