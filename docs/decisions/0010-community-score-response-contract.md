# ADR 0010: Bounded Community score response contract

- Status: Accepted (schema, validators, mapper, and DB adapter implemented; route/cache pending)
- Date: 2026-07-15
- Decision owners: Product, Web, Contracts, Security, and Privacy
- Supersedes: None
- Superseded by: None

## Context

Revision 0011 provides a Web-only PostgreSQL score projection, but a database row shape is not a
public wire contract. A future service needs one language-neutral response allowlist before it can
serialize scores, generate client types, or advertise an HTTP path. Reusing the synthetic frontend
payload would prematurely publish CarRecipe, streak, freshness, profile detail, and opaque demo IDs
that have no real persistence or privacy lifecycle.

The trust label is also part of the security boundary. A consumer must not be able to reinterpret a
Community result as Verified merely because a UI forgot localized disclaimer copy. Empty seasons
must remain representable without revealing whether hidden or deleted participants existed.

## Decision

Add canonical `CommunityScorePageV1` under `contracts/v1`. It is a response-only component; it is
not accepted from the connector or browser. The root object is closed and contains exactly:

- `schemaVersion: 1`;
- `trustTier: "community"`;
- `selfReported: true`; and
- `participants`, an ordered array of zero through 32 score rows.

Each participant row is closed and mirrors the ten-field revision 0011 allowlist using lower-camel
wire names: season start/end, score version, terminal boolean, public handle, weekly score, active
days, contributing source count, shared rank, and display position. Display position is unique
within a page. Dates must be canonical calendar labels inside the only boundary years reachable from
the database contract; score, count, handle, rank, and collection bounds match or narrow the
database constraints.

The initial response is one fixed top-32 page. It has no caller-selected limit, cursor, offset,
sort, filter, or continuation token. The implemented server-only mapper derives the page-size
constant from the canonical schema, accepts unknown adapter output, and rejects row 33 before
traversing rows. It requires an ordinary dense array and exactly the ten enumerable snake-case SQL
columns on each plain row without invoking accessors. It maps rather than sorts or repairs the
projection, validates the complete response, verifies one Monday-through-Sunday season plus
contiguous display positions and SQL shared-rank/order semantics, rejects duplicate handles, and
returns a frozen response. A valid empty projection maps to an empty `participants` array.

ADR 0011 implements the database adapter by casting PostgreSQL `date` columns to canonical text and
calling the projection with the exported constant limit 32. A future route must translate any stable
store or mapper failure to bounded problem details rather than serialize a partial or invalid
result; neither error contains a projected value, unexpected field name, or internal exception text.

The response contains no profile/GitHub/source/device identifier, raw token value, daily score,
exact timestamp, preference, authentication/recovery state, audit field, CarRecipe, streak,
freshness, profile detail, or localized prose. Product UI derives localized Community and
self-reported wording from the two constant trust fields.

This strict component rejects unknown response fields. Adding car, streak, freshness, profile links,
pagination, or other fields therefore requires a separately reviewed schema/version rather than
silently expanding this shape. The generated OpenAPI document continues to contain no paths; an
implemented route, cache/CORS policy, request parser, edge controls, and deployment remain separate
work.

## Security and privacy consequences

The response makes trust semantics machine-readable and keeps server-owned score fields out of the
connector-writable contract. The fixed allowlist and 32-row ceiling bound one serialized result and
exclude fields that could reveal exact work time, account binding, device authority, or private
profile state. Empty output does not distinguish no score state from no currently visible rows.

The schema does not itself prevent scraping, stale cache resurrection, database load, or a route
from omitting the visible disclaimer. A future endpoint still needs response validation, short read
transactions, cache invalidation on hide/delete, request shaping, rate limits, deadlines,
backpressure, monitoring, and capacity evidence. Public handles and scores can still be archived by
visitors after publication.

No field adds storage or retention. `trustTier` and `selfReported` are public constants; every
participant field was already classified Public for the revision 0011 projection. Affected
invariants are VR-TRUST-001, VR-ABUSE-001, VR-DATA-001, VR-DELETE-001, and VR-PUBLIC-001. Primary
attacker stories are VR-ABUSE-PUBLIC-SCRAPE, VR-ABUSE-RESOURCE-EXHAUSTION, VR-ABUSE-DATABASE-ROLE,
and VR-ABUSE-DELETE-RESURRECTION.

## Alternatives considered

- **Expose the synthetic race payload:** rejected because it contains demo-only IDs, car, streak,
  freshness, and profile fields without production storage or lifecycle evidence.
- **Return bare database rows:** rejected because the wire needs explicit version and trust
  metadata, lower-camel names, generation, and runtime validation.
- **Return up to the database maximum of 100 rows:** rejected for the initial response because 32
  bounds serialization and validator traversal while still supporting the visible race. Capacity
  evidence can justify a later pagination contract.
- **Add cursor pagination now:** rejected because stable cursor, hide/delete, finalized-history,
  cache, and load semantics are not yet implemented.
- **Embed localized disclaimer text:** rejected because it would couple protocol compatibility to
  translation copy and could drift between languages.
- **Make trust fields ordinary strings/booleans:** rejected because `verified` or `false` would then
  be structurally valid despite contradicting the only enabled trust tier.

## Migration and rollback

This decision adds one canonical JSON Schema component and regenerated TypeScript/OpenAPI
derivatives. It changes no table, database grant, dependency, credential, endpoint, retained field,
or deployment state.

Before any route is published, the component can be removed only together with its manifest entry,
generated derivatives, tests, and documentation. After a consumer ships, incompatible changes use a
new reviewed contract version or component and a documented migration; generated drift must never be
accepted as rollback. Disabling a future route must not broaden the response or fall back to the
synthetic payload.

## Verification

Current repository evidence covers:

- canonical/manifest identity, bounded closed-object structure, generated digest, and OpenAPI/
  TypeScript drift;
- constant Community/self-reported metadata and the exact participant field allowlist;
- valid populated and empty responses plus frozen generated schema objects;
- malformed dates/handles, score/rank bounds, 33-row overflow, duplicate display positions, trust
  drift, and unknown/private-field rejection;
- privacy-safe validation issues that contain only schema paths and stable codes; and
- black-box checker mutations for connector score-field aliases and extra daily fields, trust drift,
  a private participant identifier, and score-bound widening;
- exact snake-case projection allowlisting, accessor-free reads, row-limit enforcement before
  traversal, and non-reflective unexpected-runtime failure handling; and
- empty/full pages, both database calendar bounds, common season metadata, Monday-through-Sunday
  windows, contiguous display order, unique handles, score ordering, shared ranks, and post-tie rank
  gaps.

There is still no HTTP route, request/path schema, response header policy, cache,
CarRecipe/streak/freshness contract, load evidence, deployment login/TLS integration, or real-user
data. A generated response component, mapper, and server-only database adapter are not endpoint or
launch evidence.

## References

- [Public Community score projection](0009-public-community-score-projection.md)
- [Bounded Web PostgreSQL score adapter](0011-bounded-web-postgresql-score-adapter.md)
- [Community trust tier](0001-community-trust-tier.md)
- [Canonical public contracts](../../contracts/README.md)
- [Project plan](../PROJECT_PLAN.md)
- [Compatibility policy](../architecture/COMPATIBILITY_POLICY.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
