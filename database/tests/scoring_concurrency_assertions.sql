\set ON_ERROR_STOP on

-- Read-only assertions over committed synthetic scoring race fixtures. The integration project is
-- ephemeral and is destroyed immediately after the complete test run.

CREATE FUNCTION pg_temp.scoring_race_date(p_day_offset integer)
RETURNS date
LANGUAGE sql
STABLE
AS $function$
  SELECT pg_catalog.current_setting('viberacing.test_week_start')::date + p_day_offset
$function$;

SET ROLE viberacing_owner;

DO $assertion$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.seasons
    WHERE season_start = pg_temp.scoring_race_date(0)
      AND season_end = pg_temp.scoring_race_date(6)
      AND score_version = 'community_v1'
      AND refreshed_at IS NOT NULL
  ) <> 1
    OR (
      SELECT pg_catalog.count(*)
      FROM viberacing_private.season_entries
      WHERE season_start = pg_temp.scoring_race_date(0)
        AND profile_id = '00000000-0000-4000-8000-000000015101'
        AND weekly_score = 599
        AND active_days = 1
        AND contributing_source_count = 1
        AND rank_position = 1
        AND display_order = 1
    ) <> 1
    OR (
      SELECT pg_catalog.count(*)
      FROM viberacing_private.season_daily_scores
      WHERE season_start = pg_temp.scoring_race_date(0)
        AND profile_id = '00000000-0000-4000-8000-000000015101'
    ) <> 7
    OR (
      SELECT pg_catalog.count(*)
      FROM viberacing_private.season_daily_scores
      WHERE season_start = pg_temp.scoring_race_date(0)
        AND profile_id = '00000000-0000-4000-8000-000000015101'
        AND score_date = pg_temp.scoring_race_date(0)
        AND daily_score = 599
    ) <> 1 THEN
    RAISE EXCEPTION 'concurrent scoring refresh did not converge on one exact projection';
  END IF;
END
$assertion$;

RESET ROLE;
