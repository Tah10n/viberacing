\set ON_ERROR_STOP on

-- Read-only assertions over committed synthetic finalized source-day race fixtures.

SET ROLE viberacing_owner;

DO $assertions$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM viberacing_private.source_day_values
    WHERE source_id IN (
      'src_' || pg_catalog.lpad('39701', 22, 'R'),
      'src_' || pg_catalog.lpad('39702', 22, 'S')
    )
      AND codex_reported_date BETWEEN DATE '2008-01-07' AND DATE '2008-01-13'
  ) THEN
    RAISE EXCEPTION 'serialized source-day cleanup workers left eligible values behind';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.finalized_season_profile_freshness
    WHERE season_start = DATE '2008-01-07'
      AND profile_id = '00000000-0000-4000-8000-000000039701'
      AND deleted_source_day_value_count = 1
      AND source_day_value_count = 1
      AND source_values_purged_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'the first serialized source-day worker did not settle its projection';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.finalized_season_profile_freshness
    WHERE season_start = DATE '2008-01-07'
      AND profile_id = '00000000-0000-4000-8000-000000039702'
      AND deleted_source_day_value_count = 1
      AND source_day_value_count = 1
      AND source_values_purged_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'the second serialized source-day worker did not settle its projection';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM viberacing_private.profiles
    WHERE profile_id = '00000000-0000-4000-8000-000000039704'
  ) OR EXISTS (
    SELECT 1
    FROM viberacing_private.finalized_season_profile_freshness
    WHERE profile_id = '00000000-0000-4000-8000-000000039704'
  ) OR NOT EXISTS (
    SELECT 1
    FROM viberacing_private.deletion_jobs
    WHERE deletion_job_id = '00000000-0000-4000-8000-000000039804'
      AND profile_id IS NULL
      AND state = 'purged'
      AND completed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'source-day cleanup and profile purge did not settle one terminal profile';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.seasons
    WHERE season_start = DATE '2009-01-05'
      AND state = 'finalized'
      AND finalized_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'the finalization overlap did not reach terminal state';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.finalized_season_profile_freshness
    WHERE season_start = DATE '2009-01-05'
      AND profile_id = '00000000-0000-4000-8000-000000039703'
      AND last_accepted_date = DATE '2009-01-07'
      AND retained_source_count = 1
      AND source_day_value_count = 1
      AND deleted_source_day_value_count = 0
      AND source_values_purged_at IS NULL
  ) THEN
    RAISE EXCEPTION 'the finalization overlap lost its exact rounded freshness inventory';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.source_day_values
    WHERE source_id = 'src_' || pg_catalog.lpad('39703', 22, 'T')
      AND codex_reported_date = DATE '2009-01-05'
  ) THEN
    RAISE EXCEPTION 'cleanup removed a newly finalized source-day value before retention elapsed';
  END IF;
END
$assertions$;

RESET ROLE;
