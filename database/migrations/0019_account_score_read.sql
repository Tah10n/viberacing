\set ON_ERROR_STOP on

-- Revision 0019: session-owned current-week derived score detail for the account page.
-- Canonical checksum: database/migrations/manifest.json.
-- cspell:ignore isodow

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

CREATE FUNCTION viberacing_api.read_profile_score(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_season_start date
)
RETURNS TABLE (
  season_start date,
  season_end date,
  season_finalized boolean,
  weekly_score smallint,
  active_days smallint,
  source_count smallint,
  score_date date,
  daily_score smallint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $function$
DECLARE
  authenticated_profile_id uuid;
BEGIN
  IF p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32
    OR p_season_start IS NULL
    OR p_season_start < DATE '1999-12-27'
    OR p_season_start > DATE '2099-12-28'
    OR pg_catalog.date_part('isodow', p_season_start) IS DISTINCT FROM 1 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  authenticated_profile_id := viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest,
    ARRAY['active', 'hidden']
  );

  RETURN QUERY
  SELECT
    season_record.season_start,
    season_record.season_end,
    season_record.state = 'finalized',
    entry_record.weekly_score,
    entry_record.active_days,
    entry_record.contributing_source_count,
    daily_record.score_date,
    daily_record.daily_score
  FROM viberacing_private.profiles AS profile_record
  JOIN viberacing_private.season_entries AS entry_record
    ON entry_record.profile_id = profile_record.profile_id
    AND entry_record.season_start = p_season_start
  JOIN viberacing_private.seasons AS season_record
    ON season_record.season_start = entry_record.season_start
  JOIN viberacing_private.season_daily_scores AS daily_record
    ON daily_record.season_start = entry_record.season_start
    AND daily_record.profile_id = entry_record.profile_id
  WHERE profile_record.profile_id = authenticated_profile_id
    AND profile_record.state = 'active'
  ORDER BY daily_record.score_date;
END
$function$;

REVOKE EXECUTE ON FUNCTION viberacing_api.read_profile_score(uuid, bytea, date)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
GRANT EXECUTE ON FUNCTION viberacing_api.read_profile_score(uuid, bytea, date)
  TO viberacing_web;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (19, 'account_score_read');

COMMIT;
