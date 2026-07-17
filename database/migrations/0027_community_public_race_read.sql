\set ON_ERROR_STOP on

-- Revision 0027: bounded public Community race projection with optional active CarRecipe.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

CREATE FUNCTION viberacing_api.list_public_community_race(
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
  display_position integer,
  car_recipe jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET statement_timeout = '5s'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    score_record.season_start,
    score_record.season_end,
    score_record.score_version,
    score_record.season_finalized,
    score_record.handle,
    score_record.weekly_score,
    score_record.active_days,
    score_record.source_count,
    score_record.rank_position,
    score_record.display_position,
    CASE
      WHEN recipe_record.profile_id IS NULL THEN NULL
      ELSE pg_catalog.jsonb_build_object(
        'schemaVersion', recipe_record.schema_version,
        'chassis', recipe_record.chassis,
        'nose', recipe_record.nose,
        'cockpit', recipe_record.cockpit,
        'wing', recipe_record.wing,
        'wheels', recipe_record.wheels,
        'palette', recipe_record.palette,
        'trail', recipe_record.trail,
        'seed', recipe_record.seed
      )
    END AS car_recipe
  FROM viberacing_api.list_public_community_scores(p_season_start, p_limit) AS score_record
  JOIN viberacing_private.profiles AS profile_record
    ON profile_record.handle = score_record.handle
    AND profile_record.state = 'active'
  LEFT JOIN viberacing_private.profile_car_recipes AS recipe_record
    ON recipe_record.profile_id = profile_record.profile_id
  ORDER BY score_record.display_position;
EXCEPTION
  WHEN data_exception THEN
    PERFORM viberacing_private.operation_failed();
    RETURN;
END
$function$;

REVOKE EXECUTE ON FUNCTION viberacing_api.list_public_community_race(date, integer)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

GRANT EXECUTE ON FUNCTION viberacing_api.list_public_community_race(date, integer)
  TO viberacing_web;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (27, 'community_public_race_read');

COMMIT;
