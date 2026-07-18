\set ON_ERROR_STOP on

-- Revision 0029: bounded public Community race status with rounded freshness and opt-in streak.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

CREATE INDEX season_daily_scores_positive_profile_date_idx
  ON viberacing_private.season_daily_scores (profile_id, score_date)
  WHERE daily_score > 0;

CREATE FUNCTION viberacing_api.list_public_community_race_status(
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
  car_recipe jsonb,
  freshness_days integer,
  streak_days integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET statement_timeout = '5s'
AS $function$
DECLARE
  today_utc date := (pg_catalog.statement_timestamp() AT TIME ZONE 'UTC')::date;
BEGIN
  RETURN QUERY
  SELECT
    race_record.season_start,
    race_record.season_end,
    race_record.score_version,
    race_record.season_finalized,
    race_record.handle,
    race_record.weekly_score,
    race_record.active_days,
    race_record.source_count,
    race_record.rank_position,
    race_record.display_position,
    race_record.car_recipe,
    CASE
      WHEN freshness_record.last_accepted_date IS NULL THEN NULL
      ELSE LEAST(
        65535,
        GREATEST(0, today_utc - freshness_record.last_accepted_date)
      )::integer
    END AS freshness_days,
    CASE
      WHEN profile_record.streak_visible
      THEN COALESCE(streak_record.streak_days, 0)
      ELSE NULL
    END AS streak_days
  FROM viberacing_api.list_public_community_race(p_season_start, p_limit) AS race_record
  JOIN viberacing_private.profiles AS profile_record
    ON profile_record.handle = race_record.handle
    AND profile_record.state = 'active'
  CROSS JOIN LATERAL (
    SELECT
      pg_catalog.max(
        (source_value.last_accepted_at AT TIME ZONE 'UTC')::date
      ) AS last_accepted_date
    FROM viberacing_private.codex_sources AS source_record
    JOIN viberacing_private.source_day_values AS source_value
      ON source_value.source_id = source_record.source_id
    WHERE source_record.profile_id = profile_record.profile_id
      AND source_value.codex_reported_date
        BETWEEN race_record.season_start AND race_record.season_end
  ) AS freshness_record
  CROSS JOIN LATERAL (
    SELECT
      CASE
        WHEN today_utc BETWEEN race_record.season_start AND race_record.season_end
          THEN CASE
            WHEN EXISTS (
              SELECT 1
              FROM viberacing_private.season_daily_scores AS today_score
              WHERE today_score.profile_id = profile_record.profile_id
                AND today_score.score_date = today_utc
                AND today_score.daily_score > 0
            ) THEN today_utc
            ELSE today_utc - 1
          END
        ELSE race_record.season_end
      END AS anchor_date
  ) AS streak_anchor
  LEFT JOIN LATERAL (
    SELECT pg_catalog.count(*)::integer AS streak_days
    FROM (
      SELECT
        active_score.score_date,
        active_score.score_date - (
          pg_catalog.row_number() OVER (ORDER BY active_score.score_date)
        )::integer AS streak_group
      FROM viberacing_private.season_daily_scores AS active_score
      WHERE profile_record.streak_visible
        AND active_score.profile_id = profile_record.profile_id
        AND active_score.daily_score > 0
        AND active_score.score_date >= DATE '1999-12-27'
        AND active_score.score_date <= streak_anchor.anchor_date
    ) AS grouped_active_score
    GROUP BY grouped_active_score.streak_group
    HAVING pg_catalog.max(grouped_active_score.score_date) = streak_anchor.anchor_date
  ) AS streak_record ON true
  WHERE race_record.season_start <= today_utc
  ORDER BY race_record.display_position;
EXCEPTION
  WHEN data_exception THEN
    PERFORM viberacing_private.operation_failed();
    RETURN;
END
$function$;

REVOKE EXECUTE ON FUNCTION viberacing_api.list_public_community_race_status(date, integer)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

GRANT EXECUTE ON FUNCTION viberacing_api.list_public_community_race_status(date, integer)
  TO viberacing_web;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (29, 'community_public_race_status');

COMMIT;
