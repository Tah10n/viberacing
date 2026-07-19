# ADR 0062: Finalized source-day retention cleanup

- Status: Accepted
- Date: 2026-07-18
- Decision owners: Ingest, Scoring, Jobs, Database, Security, Privacy, and Operations
- Supersedes: None
- Superseded by: None

## Context

Community ingestion stores one monotonic exact token value and exact server receipt timestamps per
opaque source and reported date. Raw signed snapshots already become Jobs-cleanup-eligible after 30
days, but their minimized `source_day_values` projection previously remained until source/profile
deletion. Open-season scoring and public rounded freshness need that projection. A terminally
finalized season does not: weekly/daily score rows are immutable, and the public status response
needs only the UTC day of the latest accepted receipt for one profile and season.

Deleting source-day rows directly after raw-snapshot expiry would be unsafe. A scheduler can be late
or absent, so a non-finalized season may still need exact values for its first materialization. The
public status projection also derives `freshnessDays` from the exact rows and would silently change
after deletion unless a smaller stable projection existed first. A partial row batch must not lose
its integrity baseline or let owner-side count drift turn bounded cleanup into an unreviewed broad
delete.

The repository still has no deployed scheduler, production Jobs login, monitoring, correction
authority, cache/backup policy, or real-user retention evidence. This decision must remain a local
bounded capability and must not imply those operational controls.

## Decision

Revision 0039 adds private `finalized_season_profile_freshness`. On the exact database transition
from `open` to `finalized`, an owner trigger captures one row for every profile that has accepted
source/day state in that season:

- the season and profile keys;
- the UTC date, not timestamp, of the latest accepted server receipt;
- the number of retained opaque sources, from 1 through the existing public ceiling of 32;
- the exact source/day row count, from the source count through 224; and
- zero cleanup progress with no purge timestamp.

The maximum 224 is the existing 32-source ceiling multiplied by seven dates in one season. A count
outside either ceiling fails the finalization transaction closed. Applying the migration derives the
same rows for already-finalized seasons before the transition guard is installed. No raw token,
source ID, device ID, sync ID, exact timestamp, request value, or new public response field enters
the projection.

The projection is immutable except for one Jobs cleanup progress transition at a time. The deleted
row count must increase by exactly one and can never exceed the captured total. The purge timestamp
must remain null until the exact total is reached, then becomes mandatory and cannot precede 30 days
after finalization. Deletion of a projection row is permitted only through the existing
`deletion_pending` profile-purge exception. Runtime roles have no direct table access.

The existing compatible public race-status database function now prefers the finalized UTC-date
projection and falls back to live source/day rows for open or conservatively missing-projection
history. It continues to derive the same saturated `freshnessDays`; score, rank, source count,
streak, CarRecipe, visibility, ordering, query, return columns, and public contracts do not change.
The exact receipt timestamps remain private and become physically removable without changing a
terminal public status row.

Revision 0039 also adds Jobs-only `viberacing_api.cleanup_finalized_source_day_values(integer)`. The
integer batch is from 1 through 1000 and counts source/day rows, not profiles or seasons. Null,
zero, fractional application input, or a database value above 1000 fails closed. The function pins
`pg_catalog,pg_temp`, a five-second lock timeout, and a 30-second statement timeout.

Before capturing one server cutoff, cleanup locks the existing `community_scoring_refresh`,
`ingest_retention_cleanup`, and `profile_deletion_purge` mutex rows in their stable alphabetical
order. All three must exist. It adds no caller-selected lock or maintenance row. A row is eligible
only when:

- its season is terminally `finalized` and `finalized_at` is at least 30 days old;
- its profile/season projection is still pending and has remaining captured rows; and
- its source still belongs to that exact profile and its reported date remains inside that season.

Candidates are deterministic by finalization, season, profile, accepted receipt time, source, and
date. Each candidate locks the exact projection and source/day row with `SKIP LOCKED`. Before every
delete, the function proves that live rows plus recorded deletions equal the captured total and that
the live maximum UTC receipt date still equals the saved public projection. On the first row it also
rechecks the exact retained-source count. Oldest receipt time is deleted first, so the captured
maximum remains present until the final row. Eligibility is repeated at deletion, and the projection
advances exactly once afterward. Any count, ownership, date-range, or transition drift fails the
whole invocation closed.

The local Jobs runner adds one exact `cleanup-finalized-source-day-values` command using the fixed
maximum batch, its existing least-privileged login probe, one prepared call, closed result parsing,
and generic output. Jobs receives and discards only one nonnegative count no greater than the
requested batch.

Because the new projection directly references a profile, revision 0039 also replaces the revision
0038 abandoned-enrollment function with the same boundary plus one repeated
`NOT EXISTS finalized_season_profile_freshness` predicate. A malformed `enrolling` profile with
finalized usage-derived state is preserved for investigation rather than cascaded or allowed to
block canonical abandoned-enrollment progress.

## Security and privacy consequences

The change replaces indefinitely retained exact per-source daily token values and receipt
timestamps, after a terminal 30-day window, with one day-rounded per-profile freshness reference and
bounded progress metadata. Public output keeps its existing granularity. The projection remains
private even though the response can derive a public day count from it.

Terminal finalization is the authority boundary. Open, missing, recent, or malformed seasons are
never cleanup-eligible, so an absent scheduler cannot cause not-yet-materialized Community data to
be discarded. Ingest cannot mutate accepted source/day state after the grace deadline; the shared
scoring/Ingest/profile-purge mutex order prevents cleanup from racing finalization, raw retention,
or primary deletion. Forced RLS and the Jobs-only grant preserve VR-DATA-001.

The retained rounded date can still reveal coarse activity freshness through the already-public
opt-in status surface. It contains less information than exact per-source values and receipt
timestamps. Profile deletion removes it through the existing personal projection cascade.

After cleanup, a future correction process cannot reconstruct exact source/day evidence from this
table. That is deliberate data minimization: any future correction authority must define its own
reviewed evidence, authorization, user visibility, and retention contract rather than silently
depending on indefinitely retained private input. Final score rows remain immutable.

This decision does not supply a scheduler, cadence, retry policy, production login/TLS path,
monitoring, alert, external audit sink, legal policy, cache or backup purge, restore replay,
correction workflow, capacity result, deployment, or real-user evidence. An encrypted backup may
retain older exact rows until a separately disclosed expiry.

Affected invariants are VR-INGEST-001, VR-INGEST-002, VR-DATA-001, VR-DELETE-001, and VR-PUBLIC-001.
Primary attacker stories are VR-ABUSE-USAGE-FORGERY, VR-ABUSE-SEASON-RACE,
VR-ABUSE-DATABASE-CROSS-ROLE, VR-ABUSE-DELETE-RESURRECTION, and VR-ABUSE-RESOURCE-EXHAUSTION.

## Alternatives considered

- **Retain exact source/day rows until profile deletion:** rejected because finalized public score
  and rounded freshness do not require indefinite exact per-source Usage history.
- **Delete 30 days after receipt without finalization:** rejected because a late or absent Jobs
  scheduler could destroy the only input to a not-yet-materialized season.
- **Delete immediately at finalization:** rejected because a 30-day terminal dispute/diagnostic
  window is consistent with raw snapshot policy and gives operators time to identify defects.
- **Derive freshness from remaining rows during partial cleanup:** rejected because deleting the
  latest row would change the public response and destroy the integrity baseline.
- **Store the exact latest receipt timestamp:** rejected because the public contract exposes only
  complete UTC days and does not need time-of-day precision.
- **Batch by profile and delete every row at once:** rejected because one invocation could delete up
  to 224 rows per requested profile and make the CLI batch meaning ambiguous. The selected batch is
  an exact physical-row ceiling.
- **Reuse raw-snapshot cleanup:** rejected because raw signed evidence and monotonic source/day
  state have different foreign keys, public consumers, and finalization conditions.
- **Add a new maintenance mutex:** rejected because the existing scoring, Ingest-retention, and
  profile-purge capabilities already define every intersecting lock boundary.
- **Make the rounded projection public-table readable:** rejected because the existing
  `SECURITY DEFINER` projection can return only the compatible response and runtime roles need no
  direct table access.

## Migration and rollback

Revision 0039 is append-only. It adds one forced-RLS private table, three supporting indexes, two
private trigger functions, two triggers, one Jobs API function/grant, a compatible replacement of
the race-status function, and a fail-closed replacement of abandoned-enrollment cleanup. It
backfills only a derived day/count projection for already-finalized state; it does not delete data
when applied. Physical deletion requires a later explicit Jobs call after the 30-day boundary.

Before production scheduling, operators must publish the exact cadence and retention policy,
provision a narrow Jobs-only login and TLS path, measure batch/lock behavior, configure monitoring
and alerts, and define backup expiry plus restore replay. An application deploy must understand the
projection before any cleanup invocation.

In an unreleased disposable database, rollback is rebuild. After shared application, rollback is a
new reviewed forward migration: stop the scheduler, revoke the Jobs grant, keep the rounded
projection available to the public status function, and remove code/indexes only after no caller
depends on them. Deleted exact source/day rows cannot be reconstructed by schema rollback.

## Verification

Repository evidence covers:

- exact 1/32 source and 1/224 value bounds, forced RLS, owner policy, and no runtime direct access;
- an upgrade fixture after revision 0038 proving revision 0039 backfills one terminal projection
  without changing exact source/day state;
- finalization-time capture of the UTC latest-receipt date and exact source/value inventory;
- unchanged public finalized freshness, score, rank, streak, and ordering before and after cleanup;
- open, recent, missing-projection, and malformed-count preservation;
- batch-one progress, maximum batch acceptance, idempotency, and exact result bounds;
- oldest-receipt deletion, repeated live/captured count checks, and fail-closed drift;
- immutable projection fields, exact one-step progress, terminal purge timestamp, and profile-purge
  cascade compatibility;
- missing mutexes, invalid inputs, and exact Jobs-only execution grants;
- cleanup-worker serialization plus finalization/cleanup and profile-purge/cleanup lock behavior;
- preservation of a malformed abandoned enrollment that references finalized freshness;
- the fixed Jobs parser, prepared call, result validator, generic output, and destructive failure
  release; and
- the complete built Jobs command set through one disposable narrow login with exact stored state.

The evidence remains synthetic and local. It proves no production schedule, login/TLS credential,
monitoring, alert, backup deletion, restore replay, correction process, capacity, deployment, or
legal retention result.

## References

- [Community season grace and finalization](0008-community-season-grace-and-finalization.md)
- [Bounded Community race status](0040-bounded-public-community-race-status.md)
- [Bounded primary profile purge](0034-bounded-profile-deletion-purge.md)
- [Bounded abandoned-enrollment cleanup](0061-bounded-abandoned-enrollment-retention-cleanup.md)
- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [Database workspace](../../database/README.md)
- [Jobs workspace](../../apps/jobs/README.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
