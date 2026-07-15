\set ON_ERROR_STOP on

-- Read-only assertions over the committed opposing-order, multi-season Ingest race.

CREATE FUNCTION pg_temp.ingest_season_lock_date(p_day_offset integer)
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
    FROM viberacing_private.usage_snapshots
    WHERE usage_snapshot_id IN (
      '00000000-0000-4000-8000-000000011505',
      '00000000-0000-4000-8000-000000011506'
    )
      AND outcome = 'accepted'
      AND entry_count = 2
  ) <> 2
    OR (
      SELECT tokens = 400
        AND accepted_snapshot_id = '00000000-0000-4000-8000-000000011505'
      FROM viberacing_private.source_day_values
      WHERE source_id = 'src_' || pg_catalog.repeat('S', 22)
        AND codex_reported_date = pg_temp.ingest_season_lock_date(0)
    ) IS DISTINCT FROM true
    OR (
      SELECT tokens = 100
        AND accepted_snapshot_id = '00000000-0000-4000-8000-000000011505'
      FROM viberacing_private.source_day_values
      WHERE source_id = 'src_' || pg_catalog.repeat('S', 22)
        AND codex_reported_date = pg_temp.ingest_season_lock_date(7)
    ) IS DISTINCT FROM true
    OR (
      SELECT tokens = 800
        AND accepted_snapshot_id = '00000000-0000-4000-8000-000000011506'
      FROM viberacing_private.source_day_values
      WHERE source_id = 'src_' || pg_catalog.repeat('T', 22)
        AND codex_reported_date = pg_temp.ingest_season_lock_date(0)
    ) IS DISTINCT FROM true
    OR (
      SELECT tokens = 100
        AND accepted_snapshot_id = '00000000-0000-4000-8000-000000011506'
      FROM viberacing_private.source_day_values
      WHERE source_id = 'src_' || pg_catalog.repeat('T', 22)
        AND codex_reported_date = pg_temp.ingest_season_lock_date(7)
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'opposing-order season locks did not converge on both accepted snapshots';
  END IF;
END
$assertion$;

RESET ROLE;
