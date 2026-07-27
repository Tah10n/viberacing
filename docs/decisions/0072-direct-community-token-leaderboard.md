# ADR 0072: Direct Community token leaderboard

- Status: Accepted (local Codex beta implementation; deployment pending)
- Date: 2026-07-26
- Decision owners: Product, Contracts, Web, Jobs, Database, Security, Privacy, and Operations
- Supersedes: None
- Superseded by: None

## Context

ADR 0071 accepts provider-attributed `UsageSyncV1` daily totals but deliberately leaves the public
ranking on the legacy logarithmic `community_v1` score. A working first beta needs one user-visible
metric that ranks the already accepted Codex totals directly. It does not need anonymous enrollment,
optional MCP, provider OAuth, or several speculative readers before the existing
GitHub/passkey/pairing path can produce a useful race.

The legacy score contracts and finalized projections are already published compatibility boundaries.
Reinterpreting their `weeklyScore` field, rewriting old rows, or ranking score and token seasons
together would break those boundaries.

## Decision

Add `community_tokens_v1` as a second immutable Community metric. A season first created on or after
Monday 2026-07-27 selects it; an existing season keeps its stored version. Earlier and already
finalized `community_v1` seasons remain byte-for-byte compatible.

The token projection reuses the existing private season entry and daily projection tables after
widening their numeric value columns to a non-negative JavaScript-safe `bigint` range. Column names
remain an internal compatibility detail; `seasons.score_version` is authoritative for semantics.
Legacy readers explicitly select `community_v1` and cast its already bounded values back to their
unchanged small-integer contracts.

For `community_tokens_v1`:

- one source/date row contributes once;
- profile/day is the exact sum across eligible distinct sources;
- `weeklyTokenTotal` is the exact sum of the seven profile/day totals;
- rank uses only descending `weeklyTokenTotal`, so equal totals share rank;
- active days, provider, source count, car, and display order are not competitive tie breakers; and
- a profile whose daily or weekly aggregate exceeds `Number.MAX_SAFE_INTEGER` is omitted from that
  materialization instead of wrapping, saturating, rounding, or blocking valid participants.

The public Web boundary is a new additive `GET /v1/community/tokens` response with
`metricVersion: "community_tokens_v1"` and `weeklyTokenTotal`. It includes the same bounded public
handle, source count, cosmetic CarRecipe, day-rounded freshness, and preference-gated streak used by
the existing race-status surface. It adds no provider label, daily value, raw component, identifier,
or exact timestamp. Existing score/race/status schemas and paths do not change.

The new route is unavailable unless `VIBERACING_TOKEN_RANKING_ENABLED` is the exact own enumerable
string `true` at module evaluation. The existing public-ranking decision remains independent. The
home page tries the token route first and falls back to the legacy race route only when the token
surface is unavailable, preserving a deployable rollback.

This is the shortest Codex beta cut. It does not claim multi-agent reader support, anonymous
enrollment, MCP, Verified data, production credentials, staging evidence, or deployment.

## Security and privacy consequences

Direct ranking removes formula and provider-weight manipulation from the competitive value. A larger
admitted safe total cannot rank behind a smaller one, and a tie cannot be broken by work pattern or
source count. Re-ranking after profile hide/delete remains privacy-preserving and contiguous without
mutating finalized private rows.

The only newly public value is the deliberately public weekly aggregate. Daily/source/provider
breakdowns remain private. Widening private projection columns adds no new collection or retention;
the rows keep existing season/profile deletion and finalization behavior. Overflow omission avoids a
cross-profile projection denial but can hide only the invalid profile until its accepted source
state is corrected during the open season.

Affected invariants are VR-TOKEN-001, VR-TRUST-001, VR-INGEST-002, VR-ABUSE-001, VR-DATA-001,
VR-DELETE-001, and VR-PUBLIC-001. Primary attacker stories are VR-ABUSE-TOKEN-ACCOUNTING,
VR-ABUSE-USAGE-FORGERY, VR-ABUSE-SEASON-RACE, VR-ABUSE-RESOURCE-EXHAUSTION, VR-ABUSE-DATABASE-ROLE,
and VR-ABUSE-PUBLIC-SCRAPE.

## Alternatives considered

- **Replace `weeklyScore` in place:** rejected because finalized `community_v1` data and three
  public contracts must remain compatible.
- **Create a parallel set of season tables:** rejected because finalization, visibility, deletion,
  scheduling, and locking semantics are already versioned by the season row.
- **Apply provider or model weights:** rejected because tokenizers differ and no stable conversion
  makes such weights fair or auditable.
- **Break ties with active days or source count:** rejected because a secondary competitive rule can
  place equal token totals differently.
- **Fail the complete refresh on one unsafe aggregate:** rejected because one invalid participant
  could deny a valid public race.
- **Finish anonymous enrollment and every proposed provider first:** rejected because the existing
  Codex connector and enrollment path can support a bounded beta without those independent slices.

## Migration and rollback

Revision 0042 adds the metric row, widens two private projection columns, replaces only the
version-aware materializer and season-creation procedures, narrows legacy readers to `community_v1`,
and adds one Web-only token projection. It does not rewrite a season definition or stored value.

Rollback first leaves `VIBERACING_TOKEN_RANKING_ENABLED` absent or false so the new route and UI
path are unavailable. Existing score endpoints continue. After a shared migration, repair through a
reviewed forward migration; do not edit revision 0042, move a season across metric versions, or
reinterpret finalized values.

## Verification

Required local evidence includes:

- migration backfill preserving legacy rows and contracts;
- a new season selecting `community_tokens_v1` while a pre-cutover or existing season stays
  `community_v1`;
- exact source/date deduplication, seven-day direct sum, monotonic ordering, shared ranks, cosmetic
  CarRecipe, and noncompetitive deterministic display order;
- daily and weekly unsafe aggregate omission without affecting valid profiles;
- finalization immutability, profile hide/delete re-ranking, Web-only grant, fixed deadline, and
  runtime-role denials;
- generated contract/OpenAPI drift, strict projection mapping, default-off route admission, and
  EN/RU copy that says tokenizers differ and values are not normalized compute or cost; and
- focused PostgreSQL/Web tests plus root and release gates.

All of this remains local or synthetic. Production database/TLS credentials, Cloudflare/Railway
routing, monitoring, representative capacity, real-user behavior, deployment, and public-beta
authorization remain separate evidence.

## References

- [Provider-attributed UsageSyncV1 foundation](0071-provider-attributed-usage-sync-foundation.md)
- [Multi-agent token leaderboard proposal](0068-multi-agent-token-leaderboard-and-mcp.md)
- [Community season grace and finalization](0008-community-season-grace-and-finalization.md)
- [Public Community score projection](0009-public-community-score-projection.md)
- [Public Community race status](0040-bounded-public-community-race-status.md)
- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
