\set ON_ERROR_STOP on

-- Revision 0011: bounded, privacy-filtered Community score projection for the Web service.
-- Canonical checksum: database/migrations/manifest.json.
-- cspell:ignore isodow

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

CREATE FUNCTION viberacing_api.list_public_community_scores(
  p_season_start date,
  p_limit integer
)
RETURNS TABLE (
  season_start date,
  season_end date,
  score_version text,
  season_finalized boolean,
  handle text,
  weekly_score smallint,
  active_days smallint,
  source_count smallint,
  rank_position integer,
  display_position integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET statement_timeout = '5s'
AS $function$
BEGIN
  IF p_season_start IS NULL
    OR pg_catalog.date_part('isodow', p_season_start) IS DISTINCT FROM 1
    OR p_season_start < DATE '1999-12-27'
    OR p_season_start > DATE '2099-12-28'
    OR p_limit IS NULL
    OR p_limit NOT BETWEEN 1 AND 100 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  RETURN QUERY
  WITH visible_entries AS MATERIALIZED (
    SELECT
      season_record.season_start,
      season_record.season_end,
      season_record.score_version::text,
      season_record.state = 'finalized' AS season_finalized,
      profile_record.handle::text,
      entry_record.weekly_score,
      entry_record.active_days,
      entry_record.contributing_source_count AS source_count,
      entry_record.display_order
    FROM viberacing_private.seasons AS season_record
    JOIN viberacing_private.season_entries AS entry_record
      ON entry_record.season_start = season_record.season_start
    JOIN viberacing_private.profiles AS profile_record
      ON profile_record.profile_id = entry_record.profile_id
    WHERE season_record.season_start = p_season_start
      AND profile_record.state = 'active'
  ),
  public_ranking AS MATERIALIZED (
    SELECT
      visible_entry.*,
      pg_catalog.rank() OVER (
        ORDER BY visible_entry.weekly_score DESC, visible_entry.active_days DESC
      )::integer AS rank_position,
      pg_catalog.row_number() OVER (
        ORDER BY
          visible_entry.weekly_score DESC,
          visible_entry.active_days DESC,
          visible_entry.display_order
      )::integer AS display_position
    FROM visible_entries AS visible_entry
  )
  SELECT
    ranked_entry.season_start,
    ranked_entry.season_end,
    ranked_entry.score_version,
    ranked_entry.season_finalized,
    ranked_entry.handle,
    ranked_entry.weekly_score,
    ranked_entry.active_days,
    ranked_entry.source_count,
    ranked_entry.rank_position,
    ranked_entry.display_position
  FROM public_ranking AS ranked_entry
  ORDER BY ranked_entry.display_position
  LIMIT p_limit;
EXCEPTION
  WHEN data_exception THEN
    PERFORM viberacing_private.operation_failed();
    RETURN;
END
$function$;

REVOKE EXECUTE ON FUNCTION viberacing_api.list_public_community_scores(date, integer)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

GRANT EXECUTE ON FUNCTION viberacing_api.list_public_community_scores(date, integer)
  TO viberacing_web;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (11, 'community_public_score_read');

COMMIT;
