\set ON_ERROR_STOP on

-- Revision 0040: bounded data-backed historical Community season finalization.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

CREATE INDEX seasons_open_backlog_start_idx
  ON viberacing_private.seasons (season_start)
  WHERE state = 'open';

CREATE FUNCTION viberacing_api.finalize_community_season_backlog()
RETURNS TABLE (
  finalized_season_count integer,
  profile_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  target_season_start date;
  processed_profile_count integer;
  now_at timestamptz(3);
BEGIN
  PERFORM lock_record.capability
  FROM viberacing_private.maintenance_locks AS lock_record
  WHERE lock_record.capability = 'community_scoring_refresh'
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());

  SELECT candidate.season_start
  INTO target_season_start
  FROM (
    SELECT open_candidate.season_start
    FROM (
      SELECT season_record.season_start
      FROM viberacing_private.seasons AS season_record
      WHERE season_record.state = 'open'
        AND season_record.grace_ends_at <= now_at
      ORDER BY season_record.season_start
      LIMIT 1
    ) AS open_candidate

    UNION

    SELECT source_candidate.season_start
    FROM (
      SELECT viberacing_private.community_season_start(
        source_value.codex_reported_date
      ) AS season_start
      FROM viberacing_private.source_day_values AS source_value
      WHERE source_value.codex_reported_date
          <= (now_at AT TIME ZONE 'UTC')::date - 2
        AND viberacing_private.community_season_grace_ends_at(
          viberacing_private.community_season_start(source_value.codex_reported_date)
        ) <= now_at
        AND NOT EXISTS (
          SELECT 1
          FROM viberacing_private.seasons AS season_record
          WHERE season_record.season_start
              = viberacing_private.community_season_start(
                source_value.codex_reported_date
              )
            AND season_record.state = 'finalized'
        )
      ORDER BY source_value.codex_reported_date, source_value.source_id
      LIMIT 1
    ) AS source_candidate
  ) AS candidate
  ORDER BY candidate.season_start
  LIMIT 1;

  IF target_season_start IS NULL THEN
    finalized_season_count := 0;
    profile_count := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT finalization.profile_count
  INTO processed_profile_count
  FROM viberacing_api.finalize_community_season(target_season_start) AS finalization;

  IF NOT FOUND OR processed_profile_count IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  finalized_season_count := 1;
  profile_count := processed_profile_count;
  RETURN NEXT;
EXCEPTION
  WHEN data_exception OR integrity_constraint_violation OR lock_not_available THEN
    PERFORM viberacing_private.operation_failed();
    RETURN;
END
$function$;

REVOKE EXECUTE ON FUNCTION viberacing_api.finalize_community_season_backlog()
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

GRANT EXECUTE ON FUNCTION viberacing_api.finalize_community_season_backlog()
  TO viberacing_jobs;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (40, 'historical_season_backlog_finalization');

COMMIT;
