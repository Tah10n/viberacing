\set ON_ERROR_STOP on

-- Revision 0039 must derive the same bounded terminal projection for already-finalized state.

SET ROLE viberacing_owner;

DO $assertions$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.finalized_season_profile_freshness
    WHERE season_start = DATE '2098-01-06'
      AND profile_id = '00000000-0000-4000-8000-000000039801'
      AND last_accepted_date = DATE '2098-01-08'
      AND retained_source_count = 1
      AND source_day_value_count = 1
      AND deleted_source_day_value_count = 0
      AND source_values_purged_at IS NULL
  ) THEN
    RAISE EXCEPTION 'revision 0039 did not backfill exact finalized freshness inventory';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.source_day_values
    WHERE source_id = 'src_' || pg_catalog.lpad('39801', 22, 'U')
      AND codex_reported_date = DATE '2098-01-06'
  ) THEN
    RAISE EXCEPTION 'revision 0039 backfill changed exact source-day state';
  END IF;
END
$assertions$;

RESET ROLE;
