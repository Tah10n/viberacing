\set ON_ERROR_STOP on

-- Read-only assertions over the committed synthetic finalization race fixture.

CREATE FUNCTION pg_temp.finalization_race_date(p_day_offset integer)
RETURNS date
LANGUAGE sql
STABLE
AS $function$
  SELECT pg_catalog.current_setting('viberacing.test_week_start')::date - 14 + p_day_offset
$function$;

SET ROLE viberacing_owner;

DO $assertion$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.seasons
    WHERE season_start = pg_temp.finalization_race_date(0)
      AND season_end = pg_temp.finalization_race_date(6)
      AND state = 'finalized'
      AND score_version = 'community_v1'
      AND finalized_at IS NOT NULL
      AND finalized_at >= grace_ends_at
      AND finalized_at >= refreshed_at
  ) <> 1
    OR (
      SELECT pg_catalog.count(*)
      FROM viberacing_private.season_entries
      WHERE season_start = pg_temp.finalization_race_date(0)
        AND profile_id = '00000000-0000-4000-8000-000000017101'
        AND weekly_score = 599
        AND active_days = 1
        AND contributing_source_count = 1
        AND rank_position = 1
        AND display_order = 1
    ) <> 1
    OR (
      SELECT pg_catalog.count(*)
      FROM viberacing_private.season_daily_scores
      WHERE season_start = pg_temp.finalization_race_date(0)
        AND profile_id = '00000000-0000-4000-8000-000000017101'
    ) <> 7
    OR (
      SELECT pg_catalog.count(*)
      FROM viberacing_private.usage_snapshots
      WHERE usage_snapshot_id = '00000000-0000-4000-8000-000000017502'
        AND outcome = 'quarantined'
        AND quarantine_reason = 'season_closed'
    ) <> 1
    OR (
      SELECT tokens = 100000
        AND accepted_snapshot_id = '00000000-0000-4000-8000-000000017501'
      FROM viberacing_private.source_day_values
      WHERE source_id = 'src_' || pg_catalog.repeat('M', 22)
        AND codex_reported_date = pg_temp.finalization_race_date(0)
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'finalization and late ingest did not converge on one terminal projection';
  END IF;
END
$assertion$;

RESET ROLE;
