\set ON_ERROR_STOP on

-- Revision 0009: immutable Community scoring version and Jobs-only open-season refresh.
-- Canonical checksum: database/migrations/manifest.json.
-- cspell:ignore isodow

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

ALTER TABLE viberacing_private.maintenance_locks
  DROP CONSTRAINT maintenance_locks_capability;
ALTER TABLE viberacing_private.maintenance_locks
  ADD CONSTRAINT maintenance_locks_capability CHECK (
    capability IN ('ingest_retention_cleanup', 'community_scoring_refresh')
  );

INSERT INTO viberacing_private.maintenance_locks (capability)
VALUES ('community_scoring_refresh');

CREATE TABLE viberacing_private.score_versions (
  score_version varchar(32) PRIMARY KEY,
  trust_tier varchar(9) NOT NULL,
  formula_code varchar(32) NOT NULL,
  daily_multiplier smallint NOT NULL,
  token_scale integer NOT NULL,
  daily_cap smallint NOT NULL,
  weekly_cap smallint NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  CONSTRAINT score_versions_id_format CHECK (
    score_version ~ '^[a-z][a-z0-9_]{2,31}$'
  ),
  CONSTRAINT score_versions_trust_tier CHECK (trust_tier = 'community'),
  CONSTRAINT score_versions_formula_code CHECK (formula_code = 'logarithmic_v1'),
  CONSTRAINT score_versions_parameter_bounds CHECK (
    daily_multiplier BETWEEN 1 AND 1000
    AND token_scale BETWEEN 1 AND 1000000000
    AND daily_cap BETWEEN 1 AND 10000
    AND weekly_cap BETWEEN daily_cap AND daily_cap * 7
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
VALUES ('community_v1', 'community', 'logarithmic_v1', 250, 10000, 1000, 7000);

CREATE FUNCTION viberacing_private.prevent_score_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '23000',
    MESSAGE = 'score versions are immutable';
END
$function$;

CREATE TRIGGER score_versions_immutable
BEFORE UPDATE OR DELETE ON viberacing_private.score_versions
FOR EACH ROW EXECUTE FUNCTION viberacing_private.prevent_score_version_mutation();

CREATE TABLE viberacing_private.seasons (
  season_start date PRIMARY KEY,
  season_end date NOT NULL,
  score_version varchar(32) NOT NULL
    REFERENCES viberacing_private.score_versions (score_version) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  refreshed_at timestamptz(3),
  CONSTRAINT seasons_monday_start CHECK (
    pg_catalog.date_part('isodow', season_start) = 1
  ),
  CONSTRAINT seasons_seven_day_range CHECK (
    season_end = season_start + 6
  ),
  CONSTRAINT seasons_refresh_order CHECK (
    refreshed_at IS NULL OR refreshed_at >= created_at
  )
);

CREATE FUNCTION viberacing_private.prevent_season_definition_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.season_start IS DISTINCT FROM OLD.season_start
    OR NEW.season_end IS DISTINCT FROM OLD.season_end
    OR NEW.score_version IS DISTINCT FROM OLD.score_version
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'season definitions are immutable';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER seasons_definition_immutable
BEFORE UPDATE ON viberacing_private.seasons
FOR EACH ROW EXECUTE FUNCTION viberacing_private.prevent_season_definition_mutation();

CREATE TABLE viberacing_private.season_entries (
  season_start date NOT NULL
    REFERENCES viberacing_private.seasons (season_start) ON DELETE CASCADE,
  profile_id uuid NOT NULL
    REFERENCES viberacing_private.profiles (profile_id) ON DELETE CASCADE,
  weekly_score smallint NOT NULL,
  active_days smallint NOT NULL,
  contributing_source_count smallint NOT NULL,
  rank_position integer NOT NULL,
  display_order integer NOT NULL,
  computed_at timestamptz(3) NOT NULL,
  CONSTRAINT season_entries_weekly_score CHECK (weekly_score BETWEEN 0 AND 7000),
  CONSTRAINT season_entries_active_days CHECK (active_days BETWEEN 0 AND 7),
  CONSTRAINT season_entries_source_count CHECK (
    contributing_source_count BETWEEN 0 AND 32
  ),
  CONSTRAINT season_entries_rank_positive CHECK (
    rank_position > 0 AND display_order > 0
  ),
  CONSTRAINT season_entries_profile_unique UNIQUE (season_start, profile_id),
  CONSTRAINT season_entries_display_order_unique UNIQUE (season_start, display_order)
);

CREATE TABLE viberacing_private.season_daily_scores (
  season_start date NOT NULL,
  profile_id uuid NOT NULL,
  score_date date NOT NULL,
  daily_score smallint NOT NULL,
  CONSTRAINT season_daily_scores_entry_fk
    FOREIGN KEY (season_start, profile_id)
    REFERENCES viberacing_private.season_entries (season_start, profile_id)
    ON DELETE CASCADE,
  CONSTRAINT season_daily_scores_date_range CHECK (
    score_date BETWEEN season_start AND season_start + 6
  ),
  CONSTRAINT season_daily_scores_value CHECK (daily_score BETWEEN 0 AND 1000),
  CONSTRAINT season_daily_scores_profile_date_unique UNIQUE (
    season_start,
    profile_id,
    score_date
  )
);

CREATE INDEX season_entries_ranking_idx
  ON viberacing_private.season_entries (season_start, rank_position, display_order);
CREATE INDEX season_entries_profile_history_idx
  ON viberacing_private.season_entries (profile_id, season_start DESC);

ALTER TABLE viberacing_private.score_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.score_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY score_versions_owner_all ON viberacing_private.score_versions
  FOR ALL TO viberacing_owner USING (true) WITH CHECK (true);

ALTER TABLE viberacing_private.seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.seasons FORCE ROW LEVEL SECURITY;
CREATE POLICY seasons_owner_all ON viberacing_private.seasons
  FOR ALL TO viberacing_owner USING (true) WITH CHECK (true);

ALTER TABLE viberacing_private.season_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.season_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY season_entries_owner_all ON viberacing_private.season_entries
  FOR ALL TO viberacing_owner USING (true) WITH CHECK (true);

ALTER TABLE viberacing_private.season_daily_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.season_daily_scores FORCE ROW LEVEL SECURITY;
CREATE POLICY season_daily_scores_owner_all ON viberacing_private.season_daily_scores
  FOR ALL TO viberacing_owner USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE
  viberacing_private.score_versions,
  viberacing_private.seasons,
  viberacing_private.season_entries,
  viberacing_private.season_daily_scores
FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

CREATE FUNCTION viberacing_api.refresh_community_season(
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
  selected_score_version text;
  score_multiplier smallint;
  score_token_scale integer;
  score_daily_cap smallint;
  score_weekly_cap smallint;
  daily_row_count integer;
  now_at timestamptz(3) := pg_catalog.statement_timestamp();
BEGIN
  IF p_season_start IS NULL
    OR pg_catalog.date_part('isodow', p_season_start) IS DISTINCT FROM 1 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  PERFORM lock_record.capability
  FROM viberacing_private.maintenance_locks AS lock_record
  WHERE lock_record.capability = 'community_scoring_refresh'
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.source_day_values AS current_value
    WHERE current_value.codex_reported_date
      BETWEEN p_season_start AND p_season_start + 6
  ) THEN
    DELETE FROM viberacing_private.season_entries AS entry_record
    WHERE entry_record.season_start = p_season_start;

    UPDATE viberacing_private.seasons AS season_record
    SET refreshed_at = now_at
    WHERE season_record.season_start = p_season_start;

    profile_count := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO viberacing_private.seasons (
    season_start,
    season_end,
    score_version,
    created_at
  )
  VALUES (
    p_season_start,
    p_season_start + 6,
    'community_v1',
    now_at
  )
  ON CONFLICT (season_start) DO NOTHING;

  SELECT season_record.score_version
  INTO selected_score_version
  FROM viberacing_private.seasons AS season_record
  WHERE season_record.season_start = p_season_start
  FOR UPDATE;

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
      now_at
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

  profile_count := daily_row_count / 7;

  UPDATE viberacing_private.seasons AS season_record
  SET refreshed_at = now_at
  WHERE season_record.season_start = p_season_start;

  RETURN NEXT;
EXCEPTION
  WHEN data_exception OR integrity_constraint_violation OR lock_not_available THEN
    PERFORM viberacing_private.operation_failed();
    RETURN;
END
$function$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA viberacing_private
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA viberacing_api
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

GRANT EXECUTE ON FUNCTION viberacing_api.issue_invite(
  uuid, bytea, timestamptz, uuid, text, text
) TO viberacing_admin;

GRANT EXECUTE ON FUNCTION viberacing_api.enroll_profile(
  uuid, bytea, uuid, bigint, text, text, text, text, boolean,
  uuid, bytea, timestamptz, uuid, text
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.create_auth_challenge(
  uuid, bytea, uuid, text, bytea, bytea, timestamptz
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.consume_auth_challenge(
  uuid, bytea, uuid, text, bytea, bytea
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.register_initial_passkey(
  uuid, bytea, uuid, uuid, bytea, bytea, text, bigint, boolean, boolean, uuid, text
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.rotate_session(
  uuid, bytea, uuid, bytea, timestamptz, uuid, text
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.revoke_session(uuid, bytea, uuid, text)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.request_profile_deletion(
  uuid, bytea, text, uuid, uuid, bytea, uuid, text
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.start_pairing(
  uuid, bytea, bytea, bytea, uuid, bytea, text, text, text, text, timestamptz
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.read_pairing_for_approval(uuid, bytea, bytea)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.create_pairing_approval_challenge(
  uuid, bytea, uuid, bytea, text, text, uuid, bytea, bytea, timestamptz
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.approve_pairing(
  uuid, bytea, uuid, uuid, bytea, uuid, text
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.read_pairing_verification_material(bytea)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.activate_pairing(bytea, uuid, text, uuid, text)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.poll_pairing_status(bytea)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.read_source_inventory(uuid, bytea)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.pause_source(uuid, bytea, text, uuid, text)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.create_source_action_challenge(
  uuid, bytea, text, text, uuid, bytea, bytea, timestamptz
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.reactivate_source(
  uuid, bytea, text, uuid, bytea, uuid, text
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.unlink_source(
  uuid, bytea, text, uuid, bytea, uuid, text
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.revoke_device(uuid, bytea, text, uuid, text)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.create_passkey_login_challenge(
  uuid, bytea, bytea, timestamptz
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.read_passkey_verification_material(bytea)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.complete_passkey_login(
  uuid, bytea, bytea, uuid, bytea, bigint, boolean,
  uuid, bytea, timestamptz, uuid, text
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.create_passkey_change_challenge(
  uuid, bytea, text, uuid, uuid, bytea, bytea, timestamptz
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.consume_passkey_challenge(
  uuid, bytea, uuid, text, bytea, bytea, uuid, bigint, boolean
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.read_passkey_inventory(uuid, bytea)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.add_passkey(
  uuid, bytea, uuid, bytea, uuid, bytea, bytea, text,
  bigint, boolean, boolean, uuid, text
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.revoke_passkey(
  uuid, bytea, uuid, uuid, bytea, uuid, text
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.create_recovery_change_challenge(
  uuid, bytea, uuid, bytea, bytea, timestamptz
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.replace_recovery_codes(
  uuid, bytea, uuid, bytea, uuid, uuid[], text[], uuid, text
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.read_recovery_code_verification_material(uuid)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.start_recovery(
  uuid, uuid, bytea, bytea, bytea, timestamptz, uuid, text
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.complete_recovery_registration(
  uuid, bytea, bytea, bytea, uuid, bytea, bytea, text,
  bigint, boolean, boolean, uuid, bytea, timestamptz, uuid, text
) TO viberacing_web;

GRANT EXECUTE ON FUNCTION viberacing_api.read_device_verification_material(text)
  TO viberacing_ingest;
GRANT EXECUTE ON FUNCTION viberacing_api.submit_community_sync(
  uuid, text, text, uuid, text, timestamptz, text, text,
  bytea, bytea, bytea, text[], bigint[]
) TO viberacing_ingest;

GRANT EXECUTE ON FUNCTION viberacing_api.cleanup_expired_ingest_state(integer)
  TO viberacing_jobs;
GRANT EXECUTE ON FUNCTION viberacing_api.refresh_community_season(date)
  TO viberacing_jobs;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (9, 'community_scoring_foundation');

COMMIT;
