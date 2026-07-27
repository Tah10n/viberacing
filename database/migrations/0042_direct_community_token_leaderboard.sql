\set ON_ERROR_STOP on

-- Revision 0042: additive direct-token Community seasons and Web projection.
-- Canonical checksum: database/migrations/manifest.json.
-- cspell:ignore isodow

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

ALTER TABLE viberacing_private.score_versions
  DROP CONSTRAINT score_versions_formula_code,
  DROP CONSTRAINT score_versions_parameter_bounds,
  ADD CONSTRAINT score_versions_formula_code CHECK (
    formula_code IN ('logarithmic_v1', 'direct_tokens_v1')
  ),
  ADD CONSTRAINT score_versions_parameter_bounds CHECK (
    (
      formula_code = 'logarithmic_v1'
      AND daily_multiplier BETWEEN 1 AND 1000
      AND token_scale BETWEEN 1 AND 1000000000
      AND daily_cap BETWEEN 1 AND 10000
      AND weekly_cap BETWEEN daily_cap AND daily_cap * 7
    )
    OR (
      formula_code = 'direct_tokens_v1'
      AND daily_multiplier = 1
      AND token_scale = 1
      AND daily_cap = 1
      AND weekly_cap = 1
    )
  );

INSERT INTO viberacing_private.score_versions (
  score_version,
  trust_tier,
  formula_code,
  daily_multiplier,
  token_scale,
  daily_cap,
  weekly_cap
)
VALUES ('community_tokens_v1', 'community', 'direct_tokens_v1', 1, 1, 1, 1);

ALTER TABLE viberacing_private.season_entries
  DROP CONSTRAINT season_entries_weekly_score,
  ALTER COLUMN weekly_score TYPE bigint,
  ADD CONSTRAINT season_entries_weekly_score CHECK (
    weekly_score BETWEEN 0 AND 9007199254740991
  );

ALTER TABLE viberacing_private.season_daily_scores
  DROP CONSTRAINT season_daily_scores_value,
  ALTER COLUMN daily_score TYPE bigint,
  ADD CONSTRAINT season_daily_scores_value CHECK (
    daily_score BETWEEN 0 AND 9007199254740991
  );

CREATE FUNCTION viberacing_private.community_score_version_for_season(
  p_season_start date
)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT CASE
    WHEN p_season_start >= DATE '2026-07-27' THEN 'community_tokens_v1'
    ELSE 'community_v1'
  END
$function$;

CREATE OR REPLACE FUNCTION viberacing_private.materialize_community_season(
  p_season_start date,
  p_computed_at timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  selected_score_version text;
  score_multiplier smallint;
  score_token_scale integer;
  score_daily_cap smallint;
  score_weekly_cap smallint;
  daily_row_count integer;
BEGIN
  SELECT season_record.score_version
  INTO selected_score_version
  FROM viberacing_private.seasons AS season_record
  WHERE season_record.season_start = p_season_start
    AND season_record.state = 'open';

  IF selected_score_version IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  IF selected_score_version = 'community_v1' THEN
    SELECT
      version_record.daily_multiplier,
      version_record.token_scale,
      version_record.daily_cap,
      version_record.weekly_cap
    INTO
      score_multiplier,
      score_token_scale,
      score_daily_cap,
      score_weekly_cap
    FROM viberacing_private.score_versions AS version_record
    WHERE version_record.score_version = selected_score_version
      AND version_record.trust_tier = 'community'
      AND version_record.formula_code = 'logarithmic_v1';

    IF score_multiplier IS NULL
      OR score_token_scale IS NULL
      OR score_daily_cap IS NULL
      OR score_weekly_cap IS NULL THEN
      PERFORM viberacing_private.operation_failed();
    END IF;

    DELETE FROM viberacing_private.season_entries AS entry_record
    WHERE entry_record.season_start = p_season_start;

    WITH source_values AS MATERIALIZED (
      SELECT
        source_record.profile_id,
        current_value.source_id,
        current_value.codex_reported_date AS score_date,
        current_value.tokens::numeric AS tokens
      FROM viberacing_private.source_day_values AS current_value
      JOIN viberacing_private.codex_sources AS source_record
        ON source_record.source_id = current_value.source_id
      JOIN viberacing_private.profiles AS profile_record
        ON profile_record.profile_id = source_record.profile_id
      WHERE current_value.codex_reported_date
        BETWEEN p_season_start AND p_season_start + 6
        AND source_record.state IN ('active', 'paused', 'unlinked')
        AND profile_record.state = 'active'
    ),
    participating_profiles AS MATERIALIZED (
      SELECT DISTINCT source_value.profile_id
      FROM source_values AS source_value
    ),
    season_dates AS MATERIALIZED (
      SELECT p_season_start + offset_record.day_offset AS score_date
      FROM pg_catalog.generate_series(0, 6) AS offset_record(day_offset)
    ),
    daily_totals AS MATERIALIZED (
      SELECT
        participating_profile.profile_id,
        season_date.score_date,
        COALESCE(pg_catalog.sum(source_value.tokens), 0::numeric) AS daily_tokens
      FROM participating_profiles AS participating_profile
      CROSS JOIN season_dates AS season_date
      LEFT JOIN source_values AS source_value
        ON source_value.profile_id = participating_profile.profile_id
        AND source_value.score_date = season_date.score_date
      GROUP BY participating_profile.profile_id, season_date.score_date
    ),
    daily_scores AS MATERIALIZED (
      SELECT
        daily_total.profile_id,
        daily_total.score_date,
        daily_total.daily_tokens,
        LEAST(
          score_daily_cap::numeric,
          pg_catalog.round(
            score_multiplier::numeric
            * pg_catalog.ln(
              1::numeric + daily_total.daily_tokens / score_token_scale::numeric
            )
          )
        )::bigint AS daily_score
      FROM daily_totals AS daily_total
    ),
    profile_scores AS MATERIALIZED (
      SELECT
        daily_score.profile_id,
        LEAST(
          score_weekly_cap::bigint,
          pg_catalog.sum(daily_score.daily_score)
        )::bigint AS weekly_score,
        pg_catalog.count(*) FILTER (
          WHERE daily_score.daily_tokens > 0
        )::smallint AS active_days,
        (
          SELECT pg_catalog.count(DISTINCT source_value.source_id)::smallint
          FROM source_values AS source_value
          WHERE source_value.profile_id = daily_score.profile_id
            AND source_value.tokens > 0
        ) AS contributing_source_count
      FROM daily_scores AS daily_score
      GROUP BY daily_score.profile_id
    ),
    ranked_scores AS MATERIALIZED (
      SELECT
        profile_score.profile_id,
        profile_score.weekly_score,
        profile_score.active_days,
        profile_score.contributing_source_count,
        pg_catalog.rank() OVER (
          ORDER BY profile_score.weekly_score DESC, profile_score.active_days DESC
        )::integer AS rank_position,
        pg_catalog.row_number() OVER (
          ORDER BY
            profile_score.weekly_score DESC,
            profile_score.active_days DESC,
            profile_score.profile_id
        )::integer AS display_order
      FROM profile_scores AS profile_score
    ),
    inserted_entries AS (
      INSERT INTO viberacing_private.season_entries (
        season_start,
        profile_id,
        weekly_score,
        active_days,
        contributing_source_count,
        rank_position,
        display_order,
        computed_at
      )
      SELECT
        p_season_start,
        ranked_score.profile_id,
        ranked_score.weekly_score,
        ranked_score.active_days,
        ranked_score.contributing_source_count,
        ranked_score.rank_position,
        ranked_score.display_order,
        p_computed_at
      FROM ranked_scores AS ranked_score
      RETURNING profile_id
    )
    INSERT INTO viberacing_private.season_daily_scores (
      season_start,
      profile_id,
      score_date,
      daily_score
    )
    SELECT
      p_season_start,
      daily_score.profile_id,
      daily_score.score_date,
      daily_score.daily_score
    FROM daily_scores AS daily_score
    JOIN inserted_entries AS inserted_entry
      ON inserted_entry.profile_id = daily_score.profile_id;
  ELSIF selected_score_version = 'community_tokens_v1' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM viberacing_private.score_versions AS version_record
      WHERE version_record.score_version = selected_score_version
        AND version_record.trust_tier = 'community'
        AND version_record.formula_code = 'direct_tokens_v1'
    ) THEN
      PERFORM viberacing_private.operation_failed();
    END IF;

    DELETE FROM viberacing_private.season_entries AS entry_record
    WHERE entry_record.season_start = p_season_start;

    WITH source_values AS MATERIALIZED (
      SELECT
        source_record.profile_id,
        current_value.source_id,
        current_value.codex_reported_date AS score_date,
        current_value.tokens::numeric AS tokens
      FROM viberacing_private.source_day_values AS current_value
      JOIN viberacing_private.codex_sources AS source_record
        ON source_record.source_id = current_value.source_id
      JOIN viberacing_private.profiles AS profile_record
        ON profile_record.profile_id = source_record.profile_id
      WHERE current_value.codex_reported_date
        BETWEEN p_season_start AND p_season_start + 6
        AND source_record.state IN ('active', 'paused', 'unlinked')
        AND profile_record.state = 'active'
    ),
    participating_profiles AS MATERIALIZED (
      SELECT DISTINCT source_value.profile_id
      FROM source_values AS source_value
    ),
    season_dates AS MATERIALIZED (
      SELECT p_season_start + offset_record.day_offset AS score_date
      FROM pg_catalog.generate_series(0, 6) AS offset_record(day_offset)
    ),
    daily_totals AS MATERIALIZED (
      SELECT
        participating_profile.profile_id,
        season_date.score_date,
        COALESCE(pg_catalog.sum(source_value.tokens), 0::numeric) AS daily_tokens
      FROM participating_profiles AS participating_profile
      CROSS JOIN season_dates AS season_date
      LEFT JOIN source_values AS source_value
        ON source_value.profile_id = participating_profile.profile_id
        AND source_value.score_date = season_date.score_date
      GROUP BY participating_profile.profile_id, season_date.score_date
    ),
    profile_totals AS MATERIALIZED (
      SELECT
        daily_total.profile_id,
        pg_catalog.sum(daily_total.daily_tokens) AS weekly_tokens,
        pg_catalog.count(*) FILTER (
          WHERE daily_total.daily_tokens > 0
        )::smallint AS active_days
      FROM daily_totals AS daily_total
      GROUP BY daily_total.profile_id
      HAVING pg_catalog.max(daily_total.daily_tokens) <= 9007199254740991::numeric
        AND pg_catalog.sum(daily_total.daily_tokens) <= 9007199254740991::numeric
    ),
    profile_entries AS MATERIALIZED (
      SELECT
        profile_total.profile_id,
        profile_total.weekly_tokens::bigint AS weekly_score,
        profile_total.active_days,
        (
          SELECT pg_catalog.count(DISTINCT source_value.source_id)::smallint
          FROM source_values AS source_value
          WHERE source_value.profile_id = profile_total.profile_id
            AND source_value.tokens > 0
        ) AS contributing_source_count
      FROM profile_totals AS profile_total
    ),
    ranked_scores AS MATERIALIZED (
      SELECT
        profile_entry.profile_id,
        profile_entry.weekly_score,
        profile_entry.active_days,
        profile_entry.contributing_source_count,
        pg_catalog.rank() OVER (
          ORDER BY profile_entry.weekly_score DESC
        )::integer AS rank_position,
        pg_catalog.row_number() OVER (
          ORDER BY profile_entry.weekly_score DESC, profile_entry.profile_id
        )::integer AS display_order
      FROM profile_entries AS profile_entry
    ),
    inserted_entries AS (
      INSERT INTO viberacing_private.season_entries (
        season_start,
        profile_id,
        weekly_score,
        active_days,
        contributing_source_count,
        rank_position,
        display_order,
        computed_at
      )
      SELECT
        p_season_start,
        ranked_score.profile_id,
        ranked_score.weekly_score,
        ranked_score.active_days,
        ranked_score.contributing_source_count,
        ranked_score.rank_position,
        ranked_score.display_order,
        p_computed_at
      FROM ranked_scores AS ranked_score
      RETURNING profile_id
    )
    INSERT INTO viberacing_private.season_daily_scores (
      season_start,
      profile_id,
      score_date,
      daily_score
    )
    SELECT
      p_season_start,
      daily_total.profile_id,
      daily_total.score_date,
      daily_total.daily_tokens::bigint
    FROM daily_totals AS daily_total
    JOIN inserted_entries AS inserted_entry
      ON inserted_entry.profile_id = daily_total.profile_id;
  ELSE
    PERFORM viberacing_private.operation_failed();
  END IF;

  GET DIAGNOSTICS daily_row_count = ROW_COUNT;

  IF daily_row_count % 7 <> 0 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.seasons AS season_record
  SET refreshed_at = p_computed_at
  WHERE season_record.season_start = p_season_start
    AND season_record.state = 'open';

  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  RETURN daily_row_count / 7;
END
$function$;

CREATE OR REPLACE FUNCTION viberacing_api.refresh_community_season(
  p_season_start date
)
RETURNS TABLE (
  profile_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  season_state text;
  season_grace_ends_at timestamptz;
  now_at timestamptz(3);
BEGIN
  IF p_season_start IS NULL
    OR pg_catalog.date_part('isodow', p_season_start) IS DISTINCT FROM 1
    OR p_season_start < DATE '1999-12-27'
    OR p_season_start > DATE '2099-12-28' THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  PERFORM lock_record.capability
  FROM viberacing_private.maintenance_locks AS lock_record
  WHERE lock_record.capability = 'community_scoring_refresh'
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    824762002,
    (p_season_start - DATE '2000-01-03')::integer
  );

  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());

  season_grace_ends_at := viberacing_private.community_season_grace_ends_at(p_season_start);
  IF viberacing_private.community_season_is_closed(p_season_start, now_at) THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.source_day_values AS current_value
    WHERE current_value.codex_reported_date
      BETWEEN p_season_start AND p_season_start + 6
  ) AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.seasons AS season_record
    WHERE season_record.season_start = p_season_start
  ) THEN
    profile_count := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO viberacing_private.seasons (
    season_start,
    season_end,
    score_version,
    created_at,
    state,
    grace_ends_at
  )
  VALUES (
    p_season_start,
    p_season_start + 6,
    viberacing_private.community_score_version_for_season(p_season_start),
    now_at,
    'open',
    season_grace_ends_at
  )
  ON CONFLICT (season_start) DO NOTHING;

  SELECT season_record.state, season_record.grace_ends_at
  INTO season_state, season_grace_ends_at
  FROM viberacing_private.seasons AS season_record
  WHERE season_record.season_start = p_season_start
  FOR UPDATE;

  IF season_state <> 'open'
    OR season_grace_ends_at IS NULL
    OR now_at >= season_grace_ends_at THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  profile_count := viberacing_private.materialize_community_season(
    p_season_start,
    now_at
  );
  RETURN NEXT;
EXCEPTION
  WHEN data_exception OR integrity_constraint_violation OR lock_not_available THEN
    PERFORM viberacing_private.operation_failed();
    RETURN;
END
$function$;

CREATE OR REPLACE FUNCTION viberacing_api.finalize_community_season(
  p_season_start date
)
RETURNS TABLE (
  profile_count integer,
  finalized_at timestamptz(3)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  season_state text;
  season_grace_ends_at timestamptz;
  stored_finalized_at timestamptz(3);
  now_at timestamptz(3);
BEGIN
  IF p_season_start IS NULL
    OR pg_catalog.date_part('isodow', p_season_start) IS DISTINCT FROM 1
    OR p_season_start < DATE '1999-12-27'
    OR p_season_start > DATE '2099-12-28' THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  PERFORM lock_record.capability
  FROM viberacing_private.maintenance_locks AS lock_record
  WHERE lock_record.capability = 'community_scoring_refresh'
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    824762002,
    (p_season_start - DATE '2000-01-03')::integer
  );

  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());

  season_grace_ends_at := viberacing_private.community_season_grace_ends_at(p_season_start);

  INSERT INTO viberacing_private.seasons (
    season_start,
    season_end,
    score_version,
    created_at,
    state,
    grace_ends_at
  )
  VALUES (
    p_season_start,
    p_season_start + 6,
    viberacing_private.community_score_version_for_season(p_season_start),
    now_at,
    'open',
    season_grace_ends_at
  )
  ON CONFLICT (season_start) DO NOTHING;

  SELECT
    season_record.state,
    season_record.grace_ends_at,
    season_record.finalized_at
  INTO season_state, season_grace_ends_at, stored_finalized_at
  FROM viberacing_private.seasons AS season_record
  WHERE season_record.season_start = p_season_start
  FOR UPDATE;

  IF season_state = 'finalized' THEN
    SELECT pg_catalog.count(*)::integer
    INTO profile_count
    FROM viberacing_private.season_entries AS entry_record
    WHERE entry_record.season_start = p_season_start;

    finalized_at := stored_finalized_at;
    RETURN NEXT;
    RETURN;
  END IF;

  IF season_state <> 'open'
    OR season_grace_ends_at IS NULL
    OR now_at < season_grace_ends_at THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  profile_count := viberacing_private.materialize_community_season(
    p_season_start,
    now_at
  );

  UPDATE viberacing_private.seasons AS season_record
  SET state = 'finalized',
    finalized_at = now_at
  WHERE season_record.season_start = p_season_start
    AND season_record.state = 'open';

  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  finalized_at := now_at;
  RETURN NEXT;
EXCEPTION
  WHEN data_exception OR integrity_constraint_violation OR lock_not_available THEN
    PERFORM viberacing_private.operation_failed();
    RETURN;
END
$function$;

CREATE OR REPLACE FUNCTION viberacing_api.list_public_community_scores(
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
      entry_record.weekly_score::smallint AS weekly_score,
      entry_record.active_days,
      entry_record.contributing_source_count AS source_count,
      entry_record.display_order
    FROM viberacing_private.seasons AS season_record
    JOIN viberacing_private.season_entries AS entry_record
      ON entry_record.season_start = season_record.season_start
    JOIN viberacing_private.profiles AS profile_record
      ON profile_record.profile_id = entry_record.profile_id
    WHERE season_record.season_start = p_season_start
      AND season_record.score_version = 'community_v1'
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

CREATE OR REPLACE FUNCTION viberacing_api.read_profile_score(
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
    entry_record.weekly_score::smallint,
    entry_record.active_days,
    entry_record.contributing_source_count,
    daily_record.score_date,
    daily_record.daily_score::smallint
  FROM viberacing_private.profiles AS profile_record
  JOIN viberacing_private.season_entries AS entry_record
    ON entry_record.profile_id = profile_record.profile_id
    AND entry_record.season_start = p_season_start
  JOIN viberacing_private.seasons AS season_record
    ON season_record.season_start = entry_record.season_start
    AND season_record.score_version = 'community_v1'
  JOIN viberacing_private.season_daily_scores AS daily_record
    ON daily_record.season_start = entry_record.season_start
    AND daily_record.profile_id = entry_record.profile_id
  WHERE profile_record.profile_id = authenticated_profile_id
    AND profile_record.state = 'active'
  ORDER BY daily_record.score_date;
END
$function$;

CREATE FUNCTION viberacing_api.list_public_community_token_race_status(
  p_season_start date,
  p_limit integer
)
RETURNS TABLE (
  season_start date,
  season_end date,
  metric_version text,
  season_finalized boolean,
  handle text,
  weekly_token_total bigint,
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
      season_record.score_version::text AS metric_version,
      season_record.state = 'finalized' AS season_finalized,
      profile_record.profile_id,
      profile_record.handle::text,
      profile_record.streak_visible,
      entry_record.weekly_score AS weekly_token_total,
      entry_record.active_days,
      entry_record.contributing_source_count AS source_count,
      entry_record.display_order
    FROM viberacing_private.seasons AS season_record
    JOIN viberacing_private.season_entries AS entry_record
      ON entry_record.season_start = season_record.season_start
    JOIN viberacing_private.profiles AS profile_record
      ON profile_record.profile_id = entry_record.profile_id
    WHERE season_record.season_start = p_season_start
      AND season_record.score_version = 'community_tokens_v1'
      AND profile_record.state = 'active'
  ),
  public_ranking AS MATERIALIZED (
    SELECT
      visible_entry.*,
      pg_catalog.rank() OVER (
        ORDER BY visible_entry.weekly_token_total DESC
      )::integer AS rank_position,
      pg_catalog.row_number() OVER (
        ORDER BY
          visible_entry.weekly_token_total DESC,
          visible_entry.display_order
      )::integer AS display_position
    FROM visible_entries AS visible_entry
  )
  SELECT
    ranked_entry.season_start,
    ranked_entry.season_end,
    ranked_entry.metric_version,
    ranked_entry.season_finalized,
    ranked_entry.handle,
    ranked_entry.weekly_token_total,
    ranked_entry.active_days,
    ranked_entry.source_count,
    ranked_entry.rank_position,
    ranked_entry.display_position,
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
    END AS car_recipe,
    CASE
      WHEN freshness_record.last_accepted_date IS NULL THEN NULL
      ELSE LEAST(
        65535,
        GREATEST(0, today_utc - freshness_record.last_accepted_date)
      )::integer
    END AS freshness_days,
    CASE
      WHEN ranked_entry.streak_visible
      THEN COALESCE(streak_record.streak_days, 0)
      ELSE NULL
    END AS streak_days
  FROM public_ranking AS ranked_entry
  LEFT JOIN viberacing_private.profile_car_recipes AS recipe_record
    ON recipe_record.profile_id = ranked_entry.profile_id
  LEFT JOIN viberacing_private.finalized_season_profile_freshness AS finalized_freshness
    ON finalized_freshness.season_start = ranked_entry.season_start
    AND finalized_freshness.profile_id = ranked_entry.profile_id
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      finalized_freshness.last_accepted_date,
      pg_catalog.max(
        (source_value.last_accepted_at AT TIME ZONE 'UTC')::date
      )
    ) AS last_accepted_date
    FROM viberacing_private.codex_sources AS source_record
    JOIN viberacing_private.source_day_values AS source_value
      ON source_value.source_id = source_record.source_id
    WHERE source_record.profile_id = ranked_entry.profile_id
      AND source_value.codex_reported_date
        BETWEEN ranked_entry.season_start AND ranked_entry.season_end
  ) AS freshness_record
  CROSS JOIN LATERAL (
    SELECT
      CASE
        WHEN today_utc BETWEEN ranked_entry.season_start AND ranked_entry.season_end
          THEN CASE
            WHEN EXISTS (
              SELECT 1
              FROM viberacing_private.season_daily_scores AS today_score
              WHERE today_score.profile_id = ranked_entry.profile_id
                AND today_score.score_date = today_utc
                AND today_score.daily_score > 0
            ) THEN today_utc
            ELSE today_utc - 1
          END
        ELSE ranked_entry.season_end
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
      WHERE ranked_entry.streak_visible
        AND active_score.profile_id = ranked_entry.profile_id
        AND active_score.daily_score > 0
        AND active_score.score_date >= DATE '1999-12-27'
        AND active_score.score_date <= streak_anchor.anchor_date
    ) AS grouped_active_score
    GROUP BY grouped_active_score.streak_group
    HAVING pg_catalog.max(grouped_active_score.score_date) = streak_anchor.anchor_date
  ) AS streak_record ON true
  WHERE ranked_entry.season_start <= today_utc
  ORDER BY ranked_entry.display_position
  LIMIT p_limit;
EXCEPTION
  WHEN data_exception THEN
    PERFORM viberacing_private.operation_failed();
    RETURN;
END
$function$;

REVOKE EXECUTE ON FUNCTION viberacing_private.community_score_version_for_season(date)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

REVOKE EXECUTE ON FUNCTION viberacing_api.list_public_community_token_race_status(date, integer)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
GRANT EXECUTE ON FUNCTION viberacing_api.list_public_community_token_race_status(date, integer)
  TO viberacing_web;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (42, 'direct_community_token_leaderboard');

COMMIT;
