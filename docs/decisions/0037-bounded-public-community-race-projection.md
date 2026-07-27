# ADR 0037: Bounded public Community race projection

- Status: Accepted (database, contract, local HTTP route, and visible consumer implemented)
- Date: 2026-07-17
- Decision owners: Product, Web, Contracts, Database, Security, and Privacy
- Supersedes: None
- Superseded by: None

## Context

The signed-in CarRecipe flow can hold one approved enum-only recipe for a profile, but the visible
Community race previously used only repository-owned placeholder cars. The approved recipe is
classified as public-intended when the profile is visible; proposal identity, proposal state, and
timestamps remain private.

`CommunityScorePageV1` is deliberately closed. ADR 0010 requires a separately reviewed component or
version before car data can be added, because strict consumers reject unknown fields. Silently
adding `carRecipe` to that response would break the published runtime contract even if the field
were optional.

## Decision

Add a separate `CommunityRacePageV1` response component and local
`GET /v1/community/race?seasonStart=YYYY-MM-DD` operation. The existing `GET /v1/community/scores`
operation and `CommunityScorePageV1` remain unchanged.

The new response keeps the same constant `community` and `selfReported: true` trust metadata, the
same zero-to-32 page bound, and the same ten score fields and ordering invariants. A participant may
add exactly one optional `carRecipe` object whose shape is identical to canonical `CarRecipeV1`.
Absence means that the profile has no approved active recipe. The response never contains a profile
ID, proposal ID or state, activation/proposal timestamp, arbitrary content, daily score, raw usage,
source/device detail, or account authority.

The contract checker recognizes optional properties only through the bounded ordered
`x-viberacing-optionalProperties` marker. Every schema without that marker retains the prior rule
that every declared property is required in the same reviewed order. Generated TypeScript marks only
`carRecipe` optional, while the runtime validator still rejects every undeclared field and every
malformed recipe.

Database revision 0027 adds `list_public_community_race(date, integer)`. The security-definer
function calls the unchanged public score projection, resolves only the currently `active` profile,
left-joins its one active recipe, and constructs one exact JSON object from constrained columns. It
has a five-second statement deadline and is executable only by Web. `PUBLIC`, Ingest, Jobs, and
Admin remain denied.

The Web adapter repeats its least-privileged login, role, read-only, and search-path probe on every
checkout. Its race query reads exactly the ten score columns plus `car_recipe`; the mapper requires
an exact ordinary row, validates the new wire contract, preserves score/rank invariants, and freezes
the response and nested recipe. The local route revalidates before serialization and shares the
existing four-call no-queue admission and generic problem boundary.

After hydration, the browser lazily loads its compact mapper and requests only the new same-origin
route without credentials or caching. It independently validates the complete response and the exact
recipe enums. A valid participant without an active recipe receives the existing deterministic
repository-owned presentation fallback. Any malformed page or recipe retains the explicitly
synthetic whole-page fallback; it is never partially repaired or rendered as arbitrary content.

The projected recipe is current presentation state, not a historical season snapshot. Finalized
score fields remain immutable, while a later approved recipe can change the car shown beside an old
season. The response exposes no activation time and grants no score, rank, authorization, prize, or
other privilege.

## Security and privacy consequences

Only the approved enum object crosses the public boundary. Proposal controls and database identity
remain private. Profile hide or deletion removes the complete participant row at read time, so its
recipe cannot survive through this local projection. A visitor can still archive a public handle,
score, and car after viewing it; no server can revoke such a copy.

The separate operation preserves strict compatibility for score-only clients. Exact database and
wire allowlists, nested runtime validation, plain code-native rendering, generic errors, no-store
delivery, and the existing response-size bound reduce injection and reflection risk. They do not
prove scraping resistance, edge enforcement, capacity, monitoring, cache invalidation, TLS,
deployment credentials, or deployment.

Affected invariants are VR-PUBLIC-001, VR-TRUST-001, VR-CAR-001, VR-DATA-001, and VR-DELETE-001.
Primary attacker stories are VR-ABUSE-CAR-INJECTION, VR-ABUSE-PUBLIC-SCRAPE, VR-ABUSE-DATABASE-ROLE,
VR-ABUSE-DELETE-RESURRECTION, and VR-ABUSE-RESOURCE-EXHAUSTION.

## Alternatives considered

- **Add `carRecipe` to `CommunityScorePageV1`:** rejected because its closed strict clients would
  treat the response as invalid; a nominally optional field is still a breaking response change.
- **Always invent a recipe when none is active:** rejected because a public client could not tell
  approved profile state from repository-owned presentation fallback.
- **Expose proposal state or an activation timestamp:** rejected because neither is needed to draw
  the car and both widen privacy, retention, and scraping consequences.
- **Snapshot recipes into each season:** rejected for this slice because the plan calls for the
  current active recipe, and historical recipe retention/correction semantics are not designed.
- **Return a second handle-to-recipe request:** rejected because two independent reads can produce a
  transiently inconsistent score/car page and require another browser request/admission surface.

## Migration and rollback

Revision 0027 is forward-only and creates no table or retained field. It adds one function, grant,
and schema-ledger row. The new operation can be disabled locally without changing or widening the
stable score operation. After shared deployment, defects require a reviewed forward migration; do
not edit revision 0027 or the checksum ledger.

Removing the feature before publication requires removing the race operation, component, generated
artifacts, mapper/store/route, browser call, database function through a new migration, tests, and
documentation together. Rollback must not serialize a recipe through `CommunityScorePageV1`.

## Verification

Current repository evidence covers:

- twelve schemas, four policies, six local operations, generated TypeScript/OpenAPI drift, and 49
  contract-checker regression cases;
- canonical recipe acceptance, optional absence, arbitrary URL/color/proposal/private-field
  rejection, and proof that the stable score component still rejects `carRecipe`;
- exact eleven-column database-row mapping, nested freezing, score/rank invariants, generic errors,
  and the separate parameterized query;
- exact score/race path parsing, response revalidation, no-store delivery, no-queue admission, and
  closed method handling;
- 858 Web tests including the visible browser request and synthetic fallback behavior, plus a
  production build whose initial application chunk remains within budget at 10,246 gzip bytes; and
- isolated PostgreSQL application of revisions 0001 through 0028, active/absent/hidden recipe
  projection, unchanged score allowlist, five-second deadline, Web-only execution, and 40
  cross-capability denials; and
- one opt-in emitted standalone integration that validates the race contract through a disposable
  narrow login over TLS 1.2/1.3, rejects a widened login, and preserves every private table.

There is still no deployment Web database certificate/login, external TLS/edge policy, cache,
rate/load result, monitoring, real-user result, or deployment. ADR 0038 now supplies a separate
local proposal-only device ingress and ADR 0039 adds bounded local agent orchestration; cleanup
scheduling, released packaging, and deployment remain Phase 4 gates.

## References

- [Enum-only CarRecipe](0005-enum-only-car-recipe.md)
- [Public score response contract](0010-community-score-response-contract.md)
- [Public score HTTP contract](0013-public-community-score-http-contract.md)
- [Session CarRecipe proposal](0035-bounded-session-car-recipe-proposal.md)
- [Device CarRecipe proposal ingress](0038-bounded-device-car-recipe-proposal-ingress.md)
- [Canonical CarRecipe reference](../reference/car-recipe.md)
- [Project plan](../PROJECT_PLAN.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
