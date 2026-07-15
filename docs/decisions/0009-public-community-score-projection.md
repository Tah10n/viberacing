# ADR 0009: Public Community score projection boundary

- Status: Accepted (database projection implemented; response contract and mapper in ADR 0010)
- Date: 2026-07-15
- Decision owners: Product, Web, Database, Security, and Privacy
- Supersedes: None
- Superseded by: None

## Context

Community scoring and immutable finalization exist only in private PostgreSQL tables. A future
visitor-facing race needs a narrow read boundary, but granting the Web service table access would
also expose profile IDs, exact timestamps, score internals, and the ability to compose unreviewed
queries. Publishing the complete planned race payload is premature because CarRecipe persistence,
streak derivation, rounded freshness, HTTP serialization, caching, and capacity evidence do not yet
exist.

Profile hiding and deletion add another constraint. Stored ranks describe the participant set at
materialization time, so filtering a hidden profile while returning the stored rank could leave a
gap that preserves evidence of a removed participant. Public privacy removal takes precedence over
historical rank continuity.

## Decision

Revision 0011 adds one `SECURITY DEFINER` function executable only by `viberacing_web`. It accepts
an ISO Monday in the bounded `20xx` contract calendar and a public result limit from 1 through 100.
It returns at most that many rows in one fixed order and has a five-second database statement
deadline. There is no caller-controlled sort, filter expression, cursor, SQL fragment, or table
access.

The exact output allowlist is:

- season start and end dates;
- score version and a finalized boolean;
- user-selected public handle;
- weekly score, active-day count, and contributing source count; and
- shared rank plus deterministic public display position.

The function returns neither profile/GitHub/source/device identifiers nor raw tokens, daily usage,
daily score detail, exact sync/refresh/finalization timestamps, locale, theme, motion preference,
recovery/authentication state, or audit data. It is a score-only database projection, not the
planned public race DTO.

Only profiles whose current state is `active` participate. The function computes rank and contiguous
display position after that visibility filter, using the stored noncompetitive display order only
inside a complete score-and-active-day tie. A committed hide therefore removes the handle and closes
the visible rank/display gap on the next read. Profile purge remains allowed to remove the personal
stored entry. These read-time changes do not rewrite the immutable finalized score rows.

Open and finalized seasons use the same projection. This lets a later Web service show a live
Community race and terminal history without obtaining different database authority. A valid season
with no visible score state returns an empty result; it does not reveal whether a private or removed
participant existed.

`viberacing_ingest`, `viberacing_jobs`, `viberacing_admin`, and `PUBLIC` cannot execute the
function. The Web role still has no direct private-schema access. ADR 0010 later defines a bounded
response-only schema; anonymous HTTP policy, request shaping, route mapping, caching, cache purge,
conditional requests, and deployment credentials remain future application work. In particular, this
decision does not authorize a long-lived database snapshot or a cache that can outlive a committed
hide/delete action.

## Security and privacy consequences

The fixed allowlist prevents the public service from selecting raw or identifying columns, while the
result ceiling and statement deadline bound one database call. Ranking still scans the visible
participant set before applying the result limit, so a real service requires cache design, query
plans, monitoring, load evidence, rate limits, and backpressure before beta.

An active handle, score, active-day count, source count, and season participation are intentionally
Public under the product plan. Exact usage and work schedule remain private. Re-ranking after hide
can change surviving public ranks even for a finalized season; that privacy effect is deliberate and
does not constitute a scoring correction.

Affected invariants are VR-TRUST-001, VR-ABUSE-001, VR-DATA-001, VR-DELETE-001, and VR-PUBLIC-001.
The primary attacker stories are VR-ABUSE-DATABASE-ROLE, VR-ABUSE-RESOURCE-EXHAUSTION,
VR-ABUSE-PUBLIC-SCRAPE, and VR-ABUSE-DELETE-RESURRECTION.

## Alternatives considered

- **Grant Web `SELECT` on score/profile tables:** rejected because it defeats the procedure-only
  role boundary and lets application code assemble unreviewed private joins.
- **Return stored ranks after filtering:** rejected because hidden or purged participants leave a
  public rank gap that preserves avoidable participation evidence.
- **Expose the complete planned race payload now:** rejected because car, streak, freshness, public
  profile detail, and their retention/compatibility contracts are not implemented.
- **Return raw daily scores or exact timestamps:** rejected because the leaderboard does not need
  them and exact timing can reveal a working schedule.
- **Allow arbitrary pagination and sorting:** rejected for the initial fixed top-32 response; any
  later pagination requires stable hide/delete, cache, and load semantics.
- **Publish only finalized seasons:** rejected because the selected product is a live weekly race;
  the same privacy-filtered fields are safe for an open materialization.

## Migration and rollback

Revision 0011 adds no table, column, index, network route, credential, or retained field. It creates
one owner-defined function, revokes every default/runtime grant, grants only Web execution, and adds
the contiguous migration-ledger record.

The migration is forward-only. Before a shared environment exists, rebuild a disposable database
from the checksum manifest. After deployment, revoke Web execution to disable the read capability
and repair defects in a reviewed forward migration. Removing an HTTP caller later does not require
rewriting season state.

## Verification

Current PostgreSQL evidence proves:

- the exact ten-field output allowlist and absence of private identifiers, raw values, and
  timestamps;
- active-only visibility across active, enrolling, hidden, and deletion-pending fixtures;
- shared rank, deterministic contiguous display position, result limits, open/finalized metadata,
  and empty valid seasons;
- immediate post-hide exclusion and public re-ranking without mutating stored entries;
- null season/limit, non-Monday, both out-of-calendar directions, zero, and over-ceiling input
  rejection through the generic database failure, while both inclusive calendar bounds are valid;
- Web-only execution, no runtime direct-table access, a five-second statement deadline, and explicit
  Ingest/Jobs/Admin denial.

ADR 0010 adds a response-only schema, validators, and a server-only projection mapper; ADR 0011 adds
a bounded least-privileged PostgreSQL adapter around them. The repository still lacks an HTTP route,
CarRecipe storage, streak/freshness derivation, authenticated profile detail, public cache and
invalidation, rate limits, query-plan/load evidence, monitoring backend, deployment login/TLS
integration, and real-user data. These database and server-only components are not a public API or
launch evidence.

## References

- [Community trust tier](0001-community-trust-tier.md)
- [Opaque multi-source aggregation](0002-opaque-multi-source-aggregation.md)
- [Service and database isolation](0004-edge-service-and-database-isolation.md)
- [Community grace and finalization](0008-community-season-grace-and-finalization.md)
- [Community score response contract](0010-community-score-response-contract.md)
- [Bounded Web PostgreSQL score adapter](0011-bounded-web-postgresql-score-adapter.md)
- [Project plan](../PROJECT_PLAN.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Data flow](../architecture/DATA_FLOW.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Database capability boundary](../../database/README.md)
