# ADR 0056: Fail-closed public-ranking route enable gate

- Status: Accepted (local module-load gate implemented; deployed operation pending)
- Date: 2026-07-18
- Decision owners: Web, Product, Operations, Security, Privacy, and Deployment
- Supersedes: None
- Superseded by: None

## Context

The project plan requires independently controlled kill switches for public ranking. Three local
Community read operations already expose the stable score, compatible race, and compatible race
status projections through one closed HTTP boundary. Their stores are lazy and fail generically
without database configuration, but absence or corruption of an unrelated database field is not a
stable operator decision to disable public ranking.

ADR 0055 added a first local startup latch for Ingest. Web is a different trust and process
boundary: Next.js may load route modules independently, and the visible page must retain its
explicitly synthetic fallback when the live projection is unavailable. The next bounded control is
therefore one shared fail-closed configuration decision enforced by all three ranking route
compositions without changing their versioned schemas or success contracts.

A complete operational switch also needs deployed configuration ownership, instance rollout and
drain behavior, route/cache denial, authorization, audit, monitoring, and a runbook. None is proved
by a local Next.js module-load decision.

## Decision

The three public Community ranking routes require exact `VIBERACING_PUBLIC_RANKING_ENABLED=true`.
The value is case-sensitive and canonical. Missing, empty, false, mixed-case, numeric, inherited,
accessor-backed, hidden, non-string, unreadable, or any other state resolves to disabled without
throwing or reflecting the submitted value.

One server-only resolver inspects only that field as an own enumerable string data property. It
returns a frozen `{ enabled: boolean }` decision and reads no database, listener, authentication,
pairing, request, or user field. Each of these exact route modules resolves the decision once when
that module is evaluated:

- `GET /v1/community/scores`;
- `GET /v1/community/race`; and
- `GET /v1/community/race/status`.

The shared HTTP composition accepts the enable decision as unknown runtime input and proceeds only
when it is literal boolean `true`. For GET, the check occurs after generating the existing opaque
request ID and confirming the method, but before URL/query parsing, `Accept` access, admission
acquisition, configured-store construction, database configuration, checkout, or projection work.
Disabled GET returns the existing closed `temporarily_unavailable` problem with status 503,
`Cache-Control: no-store`, `Vary: Accept`, one generated request ID, and no CORS or reflected
detail. Non-GET methods retain the existing 405 plus `Allow: GET`; disabling the capability does not
widen the method surface.

All three versioned operations already document 503 and require no-store generic problem responses,
so this decision changes no JSON Schema, OpenAPI operation, response field, database function,
grant, or compatibility status. The browser already treats every failed or unavailable status
request as one complete labeled synthetic fallback and therefore receives no new persistence or
partial live state.

Tracked `.env.example` fixes the switch to `false`, and the configuration checker rejects an enabled
tracked value. An ignored or protected environment must deliberately set exact `true` before a route
module is loaded.

This is a module-load gate, not a dynamic flag. Separate route modules, workers, or service
instances can evaluate at different times. Changing the environment does not prove that a loaded
module was re-evaluated, that old instances stopped serving, or that an external route or cache was
denied. Those deployment controls and the independent enrollment, pairing, source-creation,
CarRecipe-proposal, and remaining operational switches stay pending.

## Security and privacy consequences

The exact default-off decision reduces accidental public ranking and database exposure. The shared
composition repeats literal-true enforcement so direct internal callers cannot enable a route with a
truthy string, number, missing field, or malformed value. Disabled requests reach neither untrusted
query/header parsing, admission acquisition, nor storage work, while preserving the already reviewed
generic response contract.

The switch is non-personal Operational configuration. The resolver retains only one boolean in a
frozen module-local decision. It does not serialize, log, export, persist, transmit, or attach the
input to a request, metric, trace, audit event, cache key, database row, browser payload, or error.
The generated request ID and 503 response already exist in the public HTTP privacy model.

This does not stop an already-loaded or already-running instance, authenticate an operator, prove
cache purge or edge denial, protect deployment configuration, prevent scraping after enablement, or
supply monitoring/capacity evidence. An actor who controls the full server environment or process
has broader Web authority; deployment access control and audit remain separate mandatory controls.

Affected invariants are VR-PUBLIC-001, VR-TRUST-001, VR-DATA-001, VR-DELETE-001, and VR-ABUSE-001.
Primary attacker stories are VR-ABUSE-PUBLIC-SCRAPE, VR-ABUSE-RESOURCE-EXHAUSTION,
VR-ABUSE-DATABASE-ROLE, VR-ABUSE-DELETE-RESURRECTION, and VR-ABUSE-DEPENDENCY-PR.

## Alternatives considered

- **Treat any non-empty or truthy value as enabled:** rejected because typos, strings, and config
  coercion would fail open.
- **Default to enabled for the synthetic prototype:** rejected because the visible prototype already
  has an explicit synthetic fallback and does not require a live ranking route.
- **Use database configuration failure as the switch:** rejected because credential/TLS failure is
  ambiguous, is not independently reviewable, and would be detected only after parsing and admission
  work.
- **Gate only the newest status operation:** rejected because the stable score and compatible race
  operations expose the same public ranking capability and database trust boundary.
- **Remove or return 404 from disabled routes:** rejected because the existing 503 contract already
  represents dependency/capability unavailability without changing route compatibility.
- **Read the environment on every request:** rejected because mutable request-time configuration,
  concurrency, cross-worker consistency, audit, and rollback need a separate operational design.
- **Disable the synthetic browser fallback too:** rejected because it is committed public demo data,
  not a live ranking or database capability, and remains necessary for Phase 1 evaluation.

## Migration and rollback

There is no database, contract, dependency, package, retained-data, cache, grant, or network
migration. Existing local environments that intentionally exercise a live score route must add the
exact enable value before module evaluation. The tracked example remains disabled.

Rollback removes the environment resolver and route decision only after no local or deployed
environment relies on it. A deployed rollback must preserve an equivalent reviewed default-off
public-ranking control; it must not make valid database configuration alone sufficient to expose the
routes. Released operation paths and their generic 503 contract remain unchanged.

## Verification

Repository evidence covers:

- exact `true` acceptance and frozen decision output;
- missing, empty, false, mixed-case, numeric, inherited, accessor, hidden, non-string, non-object,
  and descriptor-trap fail-closure;
- proof that the resolver inspects only the exact enable descriptor;
- literal-true route composition and rejection of false, missing, truthy-string, and numeric input;
- proof that disabled GET reaches no URL/header parsing, admission acquisition, store, or database
  configuration path;
- all three Next.js route modules remaining disabled under false and entering the existing parser
  only under exact true;
- unchanged 405 method handling and closed 503/no-store/no-CORS problem serialization;
- disabled-by-default tracked example plus configuration-checker mutation coverage; and
- the existing browser whole-page synthetic fallback, Web lint/type/coverage/build, configuration,
  documentation, architecture, and public-data gates.

The tests do not prove deployed config delivery, simultaneous worker/instance disablement, route or
cache purge, old-instance drain, operator authentication, authorization, audit, monitoring, alert,
capacity, live database/TLS behavior, edge policy, or any other capability switch.

## References

- [Public Community score HTTP contract](0013-public-community-score-http-contract.md)
- [Bounded public Community race projection](0037-bounded-public-community-race-projection.md)
- [Bounded public Community race status](0040-bounded-public-community-race-status.md)
- [Fail-closed Ingest startup latch](0055-fail-closed-ingest-startup-enable-latch.md)
- [Web workspace](../../apps/web/README.md)
- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [System context](../architecture/SYSTEM_CONTEXT.md)
- [Data flow](../architecture/DATA_FLOW.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
