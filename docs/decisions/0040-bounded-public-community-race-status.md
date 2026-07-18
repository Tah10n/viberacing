# ADR 0040: Bounded public Community race status projection

- Status: Accepted (database, contract, local HTTP route, and visible consumer implemented)
- Date: 2026-07-18
- Decision owners: Product, Web, Contracts, Database, Security, Privacy, and Compatibility
- Supersedes: None
- Superseded by: None

## Context

The planned public leaderboard includes privacy-rounded freshness and an optional activity streak.
The current `CommunityScorePageV1` and `CommunityRacePageV1` are deliberately closed, and their
strict consumers reject unknown response fields. Adding either status field to those components
would therefore be a breaking response change even though streak visibility is optional.

The database already retains the minimum server-owned inputs needed to derive both values:
`source_day_values.last_accepted_at` records accepted server receipt time, and `season_daily_scores`
records bounded derived daily scores. Exact receipt timestamps and daily scores must remain private.
The existing profile `streak_visible` preference must control whether a streak crosses the public
boundary.

## Decision

Add a separate `CommunityRaceStatusPageV1` response component and local
`GET /v1/community/race/status?seasonStart=YYYY-MM-DD` operation. Keep `CommunityScorePageV1`,
`CommunityRacePageV1`, `/v1/community/scores`, and `/v1/community/race` unchanged.

The new response preserves the current race page's constant Community/self-reported trust metadata,
zero-to-32 bound, ordering invariants, ten score fields, and optional exact active `CarRecipeV1`.
Each participant additionally has one required `freshnessDays` integer from 0 through 65,535 and may
have one `streakDays` integer from 0 through 36,533. `streakDays` is omitted when the current active
profile has disabled public streak visibility.

Freshness is the number of complete UTC calendar days between the database statement date and the
latest accepted server receipt time for a source/day value in the requested season. It is saturated
at 65,535. The calculation does not use connector `observedAt`, the timezone-neutral
`codexReportedDate` label as a clock, or a raw snapshot that may already have expired. It exposes no
timestamp, source, device, or daily value.

Streak is the count of consecutive positive materialized daily scores ending at the evaluation day.
For a past season, the evaluation day is that season's Sunday. For the current UTC season, a
positive score today anchors the streak; otherwise yesterday remains the anchor until the UTC day
ends. This prevents an in-progress day from breaking an otherwise current streak. The count may
continue across prior materialized seasons, never changes score or rank, and is zero when the anchor
has no positive score. A future season has no projected participants even if future score state is
materialized outside the reviewed scoring lifecycle. Finalized score rows remain immutable; status
is a read-time presentation projection over already retained derived state.

Database revision 0029 adds one positive-score profile/date index and the Web-only
`list_public_community_race_status(date, integer)` function. The security-definer function calls the
unchanged race projection, resolves the same current active profile, derives only the two status
integers, and returns no additional private state. It pins its search path and five-second statement
deadline. `PUBLIC`, Ingest, Jobs, and Admin remain denied.

The Web adapter repeats the existing least-privileged checkout probe, executes one fixed
parameterized query, requires the exact thirteen-column row allowlist, validates the complete new
contract, and freezes the result. The route shares the current closed query/Accept grammar,
four-call no-queue admission, generic problem responses, final validation, `no-store`, and
same-origin/no-CORS policy. The browser performs one credential-free request to the new route and
retains the complete labeled synthetic fallback after any invalid or unavailable result.

## Security and privacy consequences

Exact server receipt time and daily score history remain owner-only. UTC-day subtraction prevents
sub-day work-schedule disclosure, while the public maximum bounds serialization. Streak publication
reuses the user's enrollment preference and does not reveal the underlying daily sequence. Profile
hide or deletion removes the complete row through the unchanged active-profile projection before
either status value is returned.

Freshness and streak can still help a visitor infer coarse activity patterns, and a visitor can
archive any public response. Rounding, optional streak omission, immediate hide, the minimal
allowlist, generic failures, and reward-free Community ranking reduce but cannot eliminate that
residual risk. This local slice does not prove cache purge, scrape resistance, edge rate policy,
capacity, monitoring, a live database login, or deployment.

Affected invariants are VR-PUBLIC-001, VR-TRUST-001, VR-DATA-001, VR-SCORE-001, and VR-DELETE-001.
Primary attacker stories are VR-ABUSE-PUBLIC-SCRAPE, VR-ABUSE-SCORE-MANIPULATION,
VR-ABUSE-DATABASE-ROLE, VR-ABUSE-DELETE-RESURRECTION, and VR-ABUSE-RESOURCE-EXHAUSTION.

## Alternatives considered

- **Add fields to either existing v1 page:** rejected because both components are closed and strict
  clients treat unknown response fields as invalid.
- **Fetch a second handle-to-status map beside the existing race response:** rejected because two
  independent public reads can race with visibility or ranking changes and produce a mixed page.
- **Expose a rounded receipt date:** rejected because a bounded relative-day value directly matches
  the UI, avoids browser timezone reinterpretation, and remains server-derived.
- **Use connector time or the latest reported date:** rejected because client time is untrusted and
  the reported date has no documented timezone.
- **Persist a mutable streak column on the profile:** rejected because the value is derived from
  existing score state, would introduce another correction/deletion lifecycle, and is unnecessary
  for the bounded top-32 query.
- **Let streak increase score or break ties:** rejected because Community activity status confers no
  ranking authority, reward, privilege, or authorization.

## Migration and rollback

Revision 0029 is forward-only. It adds one index, one function, one grant, and one migration-ledger
row; it adds no retained personal field and rewrites no finalized score. Existing public operations
remain available if the status route is disabled.

After shared deployment, a defect requires a reviewed forward migration. Removing the feature before
publication requires removing the separate operation/component, generated artifacts,
mapper/store/route/browser call, database function and index through a later migration, tests, and
documentation together. Rollback must never add these fields to either existing response.

## Verification

Repository evidence covers:

- exact canonical schema bounds, optional-streak semantics, generated TypeScript/OpenAPI drift, and
  rejection of unknown, private, malformed, and out-of-range fields;
- isolated PostgreSQL evidence for UTC-day freshness, saturation, current-day grace, cross-season
  streak continuation, hidden-streak omission, active-profile filtering, materialized-future
  suppression, unchanged legacy allowlists, five-second execution deadline, and Web-only authority;
- exact thirteen-column mapping, fixed query, least-privileged checkout probe, frozen output,
  ordering invariants, and generic projection rejection;
- exact route parsing, response revalidation, no-store delivery, no-queue admission, and closed
  method handling; and
- EN/RU browser rendering plus full-page synthetic fallback for invalid, oversized, failed, or
  unavailable responses.

There is still no cache/invalidation, edge scrape or client-rate policy, query-plan/load result,
monitoring backend, live Web database credential/certificate, real-user result, or deployment.

## References

- [Public score response contract](0010-community-score-response-contract.md)
- [Bounded public race projection](0037-bounded-public-community-race-projection.md)
- [Project plan](../PROJECT_PLAN.md)
- [Compatibility policy](../architecture/COMPATIBILITY_POLICY.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
