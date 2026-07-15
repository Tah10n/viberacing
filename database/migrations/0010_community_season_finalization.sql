\set ON_ERROR_STOP on

-- Revision 0010: server-time Community grace closure and immutable season finalization.
-- Canonical checksum: database/migrations/manifest.json.
-- cspell:ignore isodow

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

CREATE FUNCTION viberacing_private.community_season_start(p_date date)
RETURNS date
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT p_date - (pg_catalog.date_part('isodow', p_date)::integer - 1)
$function$;

CREATE FUNCTION viberacing_private.community_season_grace_ends_at(p_season_start date)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT pg_catalog.timezone('UTC', p_season_start::timestamp) + INTERVAL '9 days'
$function$;

CREATE FUNCTION viberacing_private.community_season_is_closed(
  p_season_start date,
  p_received_at timestamptz
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT p_received_at
    >= viberacing_private.community_season_grace_ends_at(p_season_start)
$function$;

CREATE FUNCTION viberacing_private.lock_community_seasons(p_dates text[])
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  target_season_start date;
BEGIN
  FOR target_season_start IN
    SELECT DISTINCT viberacing_private.community_season_start(
      submitted_date.value::date
    )
    FROM pg_catalog.unnest(p_dates) AS submitted_date(value)
    ORDER BY 1
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      824762002,
      (target_season_start - DATE '2000-01-03')::integer
    );
  END LOOP;
END
$function$;

ALTER TABLE viberacing_private.usage_snapshots
  DROP CONSTRAINT usage_snapshots_quarantine_reason;
ALTER TABLE viberacing_private.usage_snapshots
  ADD CONSTRAINT usage_snapshots_quarantine_reason CHECK (
    quarantine_reason IS NULL
    OR quarantine_reason IN ('decrease', 'source_state', 'season_closed')
  );

ALTER TABLE viberacing_private.seasons
  ADD COLUMN state varchar(9) NOT NULL DEFAULT 'open',
  ADD COLUMN grace_ends_at timestamptz(3),
  ADD COLUMN finalized_at timestamptz(3);

UPDATE viberacing_private.seasons AS season_record
SET grace_ends_at = viberacing_private.community_season_grace_ends_at(
  season_record.season_start
);

ALTER TABLE viberacing_private.seasons
  ALTER COLUMN grace_ends_at SET NOT NULL,
  ADD CONSTRAINT seasons_state CHECK (state IN ('open', 'finalized')),
  ADD CONSTRAINT seasons_supported_range CHECK (
    season_start BETWEEN DATE '1999-12-27' AND DATE '2099-12-28'
  ),
  ADD CONSTRAINT seasons_exact_grace_deadline CHECK (
    grace_ends_at = viberacing_private.community_season_grace_ends_at(season_start)
  ),
  ADD CONSTRAINT seasons_finalization_shape CHECK (
    (state = 'open' AND finalized_at IS NULL)
    OR (
      state = 'finalized'
      AND finalized_at IS NOT NULL
      AND finalized_at >= grace_ends_at
      AND refreshed_at IS NOT NULL
      AND finalized_at >= refreshed_at
    )
  );

DROP TRIGGER seasons_definition_immutable ON viberacing_private.seasons;

CREATE OR REPLACE FUNCTION viberacing_private.prevent_season_definition_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'season definitions are immutable';
  END IF;

  IF NEW.season_start IS DISTINCT FROM OLD.season_start
    OR NEW.season_end IS DISTINCT FROM OLD.season_end
    OR NEW.score_version IS DISTINCT FROM OLD.score_version
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.grace_ends_at IS DISTINCT FROM OLD.grace_ends_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'season definitions are immutable';
  END IF;

  IF OLD.state = 'finalized' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'finalized seasons are immutable';
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state
    OR NEW.finalized_at IS DISTINCT FROM OLD.finalized_at THEN
    IF OLD.state <> 'open'
      OR OLD.finalized_at IS NOT NULL
      OR NEW.state <> 'finalized'
      OR NEW.finalized_at IS NULL
      OR NEW.finalized_at < NEW.grace_ends_at
      OR NEW.refreshed_at IS NULL
      OR NEW.finalized_at < NEW.refreshed_at THEN
      RAISE EXCEPTION USING
        ERRCODE = '23000',
        MESSAGE = 'invalid season finalization transition';
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER seasons_definition_immutable
BEFORE UPDATE OR DELETE ON viberacing_private.seasons
FOR EACH ROW EXECUTE FUNCTION viberacing_private.prevent_season_definition_mutation();

CREATE FUNCTION viberacing_private.prevent_finalized_projection_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  target_season_start date;
  target_profile_id uuid;
  touches_finalized_season boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_season_start := OLD.season_start;
    target_profile_id := OLD.profile_id;
  ELSE
    target_season_start := NEW.season_start;
    target_profile_id := NEW.profile_id;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT EXISTS (
      SELECT 1
      FROM viberacing_private.seasons AS season_record
      WHERE season_record.state = 'finalized'
        AND season_record.season_start IN (OLD.season_start, NEW.season_start)
    )
    INTO touches_finalized_season;
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM viberacing_private.seasons AS season_record
      WHERE season_record.state = 'finalized'
        AND season_record.season_start = target_season_start
    )
    INTO touches_finalized_season;
  END IF;

  IF touches_finalized_season THEN
    IF TG_OP = 'DELETE' AND NOT EXISTS (
      SELECT 1
      FROM viberacing_private.profiles AS profile_record
      WHERE profile_record.profile_id = target_profile_id
        AND profile_record.state <> 'deletion_pending'
    ) THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'finalized season projections are immutable';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER season_entries_finalized_immutable
BEFORE INSERT OR UPDATE OR DELETE ON viberacing_private.season_entries
FOR EACH ROW EXECUTE FUNCTION viberacing_private.prevent_finalized_projection_mutation();

CREATE TRIGGER season_daily_scores_finalized_immutable
BEFORE INSERT OR UPDATE OR DELETE ON viberacing_private.season_daily_scores
FOR EACH ROW EXECUTE FUNCTION viberacing_private.prevent_finalized_projection_mutation();

CREATE FUNCTION viberacing_private.materialize_community_season(
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
      )::smallint AS daily_score
    FROM daily_totals AS daily_total
  ),
  profile_scores AS MATERIALIZED (
    SELECT
      daily_score.profile_id,
      LEAST(
        score_weekly_cap::bigint,
        pg_catalog.sum(daily_score.daily_score)
      )::smallint AS weekly_score,
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
    'community_v1',
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

CREATE FUNCTION viberacing_api.finalize_community_season(
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
    'community_v1',
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

CREATE OR REPLACE FUNCTION viberacing_api.submit_community_sync(
  p_device_key_id uuid,
  p_device_id text,
  p_source_id text,
  p_usage_snapshot_id uuid,
  p_sync_id text,
  p_observed_at timestamptz,
  p_connector_version text,
  p_codex_version text,
  p_body_digest bytea,
  p_signature bytea,
  p_nonce_digest bytea,
  p_codex_reported_dates text[],
  p_tokens bigint[]
)
RETURNS TABLE (
  outcome text,
  accepted_entries integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  candidate_profile_id uuid;
  locked_profile_id uuid;
  locked_source_id text;
  locked_source_state text;
  locked_device_key_id uuid;
  existing_source_id text;
  existing_body_digest bytea;
  existing_signature bytea;
  existing_nonce_digest bytea;
  existing_observed_at timestamptz;
  season_closed boolean;
  should_quarantine boolean;
  submitted_entry_count integer := pg_catalog.cardinality(p_codex_reported_dates);
  now_at timestamptz(3);
BEGIN
  IF p_device_key_id IS NULL
    OR p_device_id IS NULL
    OR p_device_id !~ '^dev_[A-Za-z0-9_-]{22}$'
    OR p_source_id IS NULL
    OR p_source_id !~ '^src_[A-Za-z0-9_-]{22}$'
    OR p_usage_snapshot_id IS NULL
    OR p_sync_id IS NULL
    OR p_sync_id !~ '^syn_[A-Za-z0-9_-]{22}$'
    OR p_observed_at IS NULL
    OR p_observed_at IS DISTINCT FROM pg_catalog.date_trunc('milliseconds', p_observed_at)
    OR p_connector_version IS NULL
    OR pg_catalog.char_length(p_connector_version) NOT BETWEEN 5 AND 64
    OR p_connector_version !~ '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$'
    OR p_codex_version IS NULL
    OR pg_catalog.char_length(p_codex_version) NOT BETWEEN 5 AND 64
    OR p_codex_version !~ '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$'
    OR pg_catalog.octet_length(p_body_digest) IS DISTINCT FROM 32
    OR pg_catalog.octet_length(p_signature) IS DISTINCT FROM 64
    OR pg_catalog.octet_length(p_nonce_digest) IS DISTINCT FROM 32
    OR submitted_entry_count IS NULL
    OR submitted_entry_count NOT BETWEEN 1 AND 31
    OR pg_catalog.cardinality(p_tokens) IS DISTINCT FROM submitted_entry_count
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(p_codex_reported_dates) AS submitted_date(value)
      WHERE submitted_date.value IS NULL
        OR submitted_date.value !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
        OR pg_catalog.to_char(
          pg_catalog.to_date(submitted_date.value, 'FXYYYY-MM-DD'),
          'YYYY-MM-DD'
        ) <> submitted_date.value
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(p_tokens) AS submitted_tokens(value)
      WHERE submitted_tokens.value IS NULL
        OR submitted_tokens.value NOT BETWEEN 0 AND 9007199254740991
    )
    OR (
      SELECT pg_catalog.count(DISTINCT submitted_date.value)
      FROM pg_catalog.unnest(p_codex_reported_dates) AS submitted_date(value)
    ) <> submitted_entry_count THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT source_record.profile_id
  INTO candidate_profile_id
  FROM viberacing_private.device_keys AS device_record
  JOIN viberacing_private.codex_sources AS source_record
    ON source_record.source_id = device_record.source_id
  WHERE device_record.device_key_id = p_device_key_id
    AND device_record.device_id = p_device_id
    AND device_record.source_id = p_source_id;

  IF candidate_profile_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  PERFORM viberacing_private.lock_community_seasons(p_codex_reported_dates);

  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());

  SELECT profile_id
  INTO locked_profile_id
  FROM viberacing_private.profiles
  WHERE profile_id = candidate_profile_id
    AND state IN ('active', 'hidden')
  FOR UPDATE;

  IF locked_profile_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT source_id, state
  INTO locked_source_id, locked_source_state
  FROM viberacing_private.codex_sources
  WHERE source_id = p_source_id
    AND profile_id = locked_profile_id
    AND state IN ('active', 'quarantined')
  FOR UPDATE;

  IF locked_source_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT device_key_id
  INTO locked_device_key_id
  FROM viberacing_private.device_keys
  WHERE device_key_id = p_device_key_id
    AND device_id = p_device_id
    AND source_id = locked_source_id
    AND state = 'active'
  FOR UPDATE;

  IF locked_device_key_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT
    snapshot_record.source_id,
    snapshot_record.body_digest,
    snapshot_record.signature,
    snapshot_record.nonce_digest,
    snapshot_record.observed_at
  INTO
    existing_source_id,
    existing_body_digest,
    existing_signature,
    existing_nonce_digest,
    existing_observed_at
  FROM viberacing_private.usage_snapshots AS snapshot_record
  WHERE snapshot_record.device_key_id = locked_device_key_id
    AND snapshot_record.sync_id = p_sync_id
  FOR UPDATE;

  IF FOUND THEN
    IF existing_source_id IS DISTINCT FROM locked_source_id
      OR existing_body_digest IS DISTINCT FROM p_body_digest
      OR existing_signature IS DISTINCT FROM p_signature
      OR existing_nonce_digest IS DISTINCT FROM p_nonce_digest
      OR existing_observed_at IS DISTINCT FROM p_observed_at THEN
      PERFORM viberacing_private.operation_failed();
    END IF;

    outcome := 'duplicate';
    accepted_entries := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_observed_at < now_at - INTERVAL '15 minutes'
    OR p_observed_at > now_at + INTERVAL '2 minutes' THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM (
      SELECT DISTINCT viberacing_private.community_season_start(
        submitted_date.value::date
      ) AS season_start
      FROM pg_catalog.unnest(p_codex_reported_dates) AS submitted_date(value)
    ) AS submitted_season
    LEFT JOIN viberacing_private.seasons AS season_record
      ON season_record.season_start = submitted_season.season_start
    WHERE viberacing_private.community_season_is_closed(
      submitted_season.season_start,
      now_at
    )
      OR season_record.state = 'finalized'
  )
  INTO season_closed;

  INSERT INTO viberacing_private.device_nonces (
    device_key_id,
    nonce_digest,
    received_at,
    expires_at
  )
  VALUES (
    locked_device_key_id,
    p_nonce_digest,
    now_at,
    now_at + INTERVAL '15 minutes'
  );

  SELECT locked_source_state = 'quarantined'
    OR season_closed
    OR EXISTS (
      SELECT 1
      FROM ROWS FROM (
        pg_catalog.unnest(p_codex_reported_dates),
        pg_catalog.unnest(p_tokens)
      ) AS submitted_entry(codex_reported_date, tokens)
      JOIN viberacing_private.source_day_values AS current_value
        ON current_value.source_id = locked_source_id
        AND current_value.codex_reported_date = submitted_entry.codex_reported_date::date
      WHERE submitted_entry.tokens < current_value.tokens
    )
  INTO should_quarantine;

  outcome := CASE WHEN should_quarantine THEN 'quarantined' ELSE 'accepted' END;
  accepted_entries := CASE WHEN should_quarantine THEN 0 ELSE submitted_entry_count END;

  INSERT INTO viberacing_private.usage_snapshots (
    usage_snapshot_id,
    device_key_id,
    device_id,
    source_id,
    sync_id,
    observed_at,
    connector_version,
    codex_version,
    body_digest,
    signature,
    nonce_digest,
    outcome,
    quarantine_reason,
    entry_count,
    received_at,
    retention_expires_at
  )
  VALUES (
    p_usage_snapshot_id,
    locked_device_key_id,
    p_device_id,
    locked_source_id,
    p_sync_id,
    p_observed_at,
    p_connector_version,
    p_codex_version,
    p_body_digest,
    p_signature,
    p_nonce_digest,
    outcome,
    CASE
      WHEN season_closed THEN 'season_closed'
      WHEN locked_source_state = 'quarantined' THEN 'source_state'
      WHEN should_quarantine THEN 'decrease'
      ELSE NULL
    END,
    submitted_entry_count,
    now_at,
    now_at + INTERVAL '30 days'
  );

  INSERT INTO viberacing_private.usage_snapshot_entries (
    usage_snapshot_id,
    codex_reported_date,
    tokens
  )
  SELECT
    p_usage_snapshot_id,
    submitted_entry.codex_reported_date::date,
    submitted_entry.tokens
  FROM ROWS FROM (
    pg_catalog.unnest(p_codex_reported_dates),
    pg_catalog.unnest(p_tokens)
  ) AS submitted_entry(codex_reported_date, tokens);

  IF NOT should_quarantine THEN
    INSERT INTO viberacing_private.source_day_values (
      source_id,
      codex_reported_date,
      tokens,
      accepted_snapshot_id,
      accepted_sync_id,
      accepted_device_id,
      first_accepted_at,
      last_accepted_at
    )
    SELECT
      locked_source_id,
      submitted_entry.codex_reported_date::date,
      submitted_entry.tokens,
      p_usage_snapshot_id,
      p_sync_id,
      p_device_id,
      now_at,
      now_at
    FROM ROWS FROM (
      pg_catalog.unnest(p_codex_reported_dates),
      pg_catalog.unnest(p_tokens)
    ) AS submitted_entry(codex_reported_date, tokens)
    ON CONFLICT (source_id, codex_reported_date)
    DO UPDATE SET
      tokens = EXCLUDED.tokens,
      accepted_snapshot_id = EXCLUDED.accepted_snapshot_id,
      accepted_sync_id = EXCLUDED.accepted_sync_id,
      accepted_device_id = EXCLUDED.accepted_device_id,
      last_accepted_at = EXCLUDED.last_accepted_at;
  END IF;

  RETURN NEXT;
EXCEPTION
  WHEN data_exception OR integrity_constraint_violation OR lock_not_available THEN
    PERFORM viberacing_private.operation_failed();
    RETURN;
END
$function$;

REVOKE EXECUTE ON FUNCTION viberacing_private.community_season_start(date)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
REVOKE EXECUTE ON FUNCTION viberacing_private.community_season_grace_ends_at(date)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
REVOKE EXECUTE ON FUNCTION viberacing_private.community_season_is_closed(date, timestamptz)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
REVOKE EXECUTE ON FUNCTION viberacing_private.lock_community_seasons(text[])
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
REVOKE EXECUTE ON FUNCTION viberacing_private.prevent_finalized_projection_mutation()
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
REVOKE EXECUTE ON FUNCTION viberacing_private.materialize_community_season(date, timestamptz)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
REVOKE EXECUTE ON FUNCTION viberacing_api.finalize_community_season(date)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

GRANT EXECUTE ON FUNCTION viberacing_api.finalize_community_season(date)
  TO viberacing_jobs;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (10, 'community_season_finalization');

COMMIT;
