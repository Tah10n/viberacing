\set ON_ERROR_STOP on

-- Revision 0039: bounded Jobs-only cleanup for finalized exact source-day values.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

-- Finalized public freshness needs only one UTC day per profile and season. Exact per-source
-- values remain private and can later be removed without changing the compatible public response.
CREATE TABLE viberacing_private.finalized_season_profile_freshness (
  season_start date NOT NULL
    REFERENCES viberacing_private.seasons (season_start) ON DELETE RESTRICT,
  profile_id uuid NOT NULL
    REFERENCES viberacing_private.profiles (profile_id) ON DELETE CASCADE,
  last_accepted_date date NOT NULL,
  retained_source_count smallint NOT NULL,
  source_day_value_count smallint NOT NULL,
  deleted_source_day_value_count smallint NOT NULL DEFAULT 0,
  source_values_purged_at timestamptz(3),
  CONSTRAINT finalized_season_profile_freshness_primary_key
    PRIMARY KEY (season_start, profile_id),
  CONSTRAINT finalized_season_profile_freshness_source_count CHECK (
    retained_source_count BETWEEN 1 AND 32
  ),
  CONSTRAINT finalized_season_profile_freshness_value_count CHECK (
    source_day_value_count BETWEEN retained_source_count AND 224
  ),
  CONSTRAINT finalized_season_profile_freshness_progress CHECK (
    deleted_source_day_value_count BETWEEN 0 AND source_day_value_count
    AND (
      (
        deleted_source_day_value_count < source_day_value_count
        AND source_values_purged_at IS NULL
      )
      OR (
        deleted_source_day_value_count = source_day_value_count
        AND source_values_purged_at IS NOT NULL
      )
    )
  )
);

CREATE INDEX finalized_seasons_source_retention_idx
  ON viberacing_private.seasons (finalized_at, season_start)
  WHERE state = 'finalized';
CREATE INDEX finalized_freshness_pending_retention_idx
  ON viberacing_private.finalized_season_profile_freshness (season_start, profile_id)
  WHERE source_values_purged_at IS NULL;
CREATE INDEX source_day_values_retention_order_idx
  ON viberacing_private.source_day_values (
    last_accepted_at,
    source_id,
    codex_reported_date
  );

ALTER TABLE viberacing_private.finalized_season_profile_freshness ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.finalized_season_profile_freshness FORCE ROW LEVEL SECURITY;
CREATE POLICY finalized_season_profile_freshness_owner_all
  ON viberacing_private.finalized_season_profile_freshness
  FOR ALL TO viberacing_owner USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE viberacing_private.finalized_season_profile_freshness
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

-- Existing terminal seasons receive a projection before the immutability trigger is installed.
-- Any impossible source/value count makes the migration fail through the public safety checks.
INSERT INTO viberacing_private.finalized_season_profile_freshness (
  season_start,
  profile_id,
  last_accepted_date,
  retained_source_count,
  source_day_value_count
)
SELECT
  season_record.season_start,
  source_record.profile_id,
  pg_catalog.max(
    (source_value.last_accepted_at AT TIME ZONE 'UTC')::date
  ),
  pg_catalog.count(DISTINCT source_value.source_id)::smallint,
  pg_catalog.count(*)::smallint
FROM viberacing_private.seasons AS season_record
JOIN viberacing_private.source_day_values AS source_value
  ON source_value.codex_reported_date
    BETWEEN season_record.season_start AND season_record.season_end
JOIN viberacing_private.codex_sources AS source_record
  ON source_record.source_id = source_value.source_id
WHERE season_record.state = 'finalized'
GROUP BY season_record.season_start, source_record.profile_id;

CREATE FUNCTION viberacing_private.capture_finalized_season_profile_freshness()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF OLD.state <> 'open'
    OR NEW.state <> 'finalized'
    OR NEW.finalized_at IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  INSERT INTO viberacing_private.finalized_season_profile_freshness (
    season_start,
    profile_id,
    last_accepted_date,
    retained_source_count,
    source_day_value_count
  )
  SELECT
    NEW.season_start,
    source_record.profile_id,
    pg_catalog.max(
      (source_value.last_accepted_at AT TIME ZONE 'UTC')::date
    ),
    pg_catalog.count(DISTINCT source_value.source_id)::smallint,
    pg_catalog.count(*)::smallint
  FROM viberacing_private.source_day_values AS source_value
  JOIN viberacing_private.codex_sources AS source_record
    ON source_record.source_id = source_value.source_id
  WHERE source_value.codex_reported_date
    BETWEEN NEW.season_start AND NEW.season_end
  GROUP BY source_record.profile_id;

  RETURN NEW;
EXCEPTION
  WHEN integrity_constraint_violation OR numeric_value_out_of_range THEN
    PERFORM viberacing_private.operation_failed();
    RETURN NULL;
END
$function$;

CREATE TRIGGER seasons_capture_finalized_profile_freshness
AFTER UPDATE OF state ON viberacing_private.seasons
FOR EACH ROW
WHEN (OLD.state IS DISTINCT FROM NEW.state)
EXECUTE FUNCTION viberacing_private.capture_finalized_season_profile_freshness();

CREATE FUNCTION viberacing_private.enforce_finalized_profile_freshness_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  season_finalized_at timestamptz(3);
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM viberacing_private.profiles AS profile_record
      WHERE profile_record.profile_id = OLD.profile_id
        AND profile_record.state <> 'deletion_pending'
    ) THEN
      RETURN OLD;
    END IF;

    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT season_record.finalized_at
  INTO season_finalized_at
  FROM viberacing_private.seasons AS season_record
  WHERE season_record.season_start = NEW.season_start
    AND season_record.state = 'finalized';

  IF season_finalized_at IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_source_day_value_count <> 0
      OR NEW.source_values_purged_at IS NOT NULL THEN
      PERFORM viberacing_private.operation_failed();
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.season_start IS DISTINCT FROM OLD.season_start
    OR NEW.profile_id IS DISTINCT FROM OLD.profile_id
    OR NEW.last_accepted_date IS DISTINCT FROM OLD.last_accepted_date
    OR NEW.retained_source_count IS DISTINCT FROM OLD.retained_source_count
    OR NEW.source_day_value_count IS DISTINCT FROM OLD.source_day_value_count
    OR OLD.source_values_purged_at IS NOT NULL
    OR NEW.deleted_source_day_value_count <> OLD.deleted_source_day_value_count + 1
    OR (
      NEW.deleted_source_day_value_count < NEW.source_day_value_count
      AND NEW.source_values_purged_at IS NOT NULL
    )
    OR (
      NEW.deleted_source_day_value_count = NEW.source_day_value_count
      AND (
        NEW.source_values_purged_at IS NULL
        OR NEW.source_values_purged_at < season_finalized_at + INTERVAL '30 days'
      )
    ) THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER finalized_profile_freshness_transition_guard
BEFORE INSERT OR UPDATE OR DELETE
ON viberacing_private.finalized_season_profile_freshness
FOR EACH ROW
EXECUTE FUNCTION viberacing_private.enforce_finalized_profile_freshness_transition();

-- Revision 0038 predates this new direct profile relation. Preserve its fail-closed shape rule by
-- excluding any enrollment profile that already has finalized usage-derived projection state.
CREATE OR REPLACE FUNCTION viberacing_api.cleanup_abandoned_enrollments(
  p_batch_size integer
)
RETURNS TABLE (
  deleted_enrollments integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  candidate_profile_id uuid;
  changed_rows bigint;
  locked_mutex_count bigint;
  now_at timestamptz(3);
BEGIN
  IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 1000 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  PERFORM lock_record.capability
  FROM viberacing_private.maintenance_locks AS lock_record
  WHERE lock_record.capability IN (
    'auth_retention_cleanup',
    'profile_deletion_purge'
  )
  ORDER BY lock_record.capability
  FOR UPDATE;

  GET DIAGNOSTICS locked_mutex_count = ROW_COUNT;
  IF locked_mutex_count <> 2 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  now_at := pg_catalog.clock_timestamp();
  deleted_enrollments := 0;

  LOOP
    EXIT WHEN deleted_enrollments >= p_batch_size;
    candidate_profile_id := NULL;

    SELECT profile_record.profile_id
    INTO candidate_profile_id
    FROM viberacing_private.profiles AS profile_record
    WHERE profile_record.state = 'enrolling'
      AND EXISTS (
        SELECT 1
        FROM viberacing_private.invites AS invite_record
        WHERE invite_record.redeemed_profile_id = profile_record.profile_id
          AND invite_record.state = 'redeemed'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.sessions AS session_record
        WHERE session_record.profile_id = profile_record.profile_id
          AND (
            session_record.expires_at >= now_at
            OR session_record.authentication_kind <> 'enrollment'
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.auth_challenges AS challenge_record
        WHERE challenge_record.profile_id = profile_record.profile_id
          AND (
            challenge_record.expires_at >= now_at
            OR challenge_record.purpose <> 'passkey_registration'
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.passkeys AS passkey_record
        WHERE passkey_record.profile_id = profile_record.profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.recovery_codes AS recovery_code
        WHERE recovery_code.profile_id = profile_record.profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.recovery_authorities AS recovery_authority
        WHERE recovery_authority.profile_id = profile_record.profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.codex_sources AS source_record
        WHERE source_record.profile_id = profile_record.profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.deletion_jobs AS deletion_job
        WHERE deletion_job.profile_id = profile_record.profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.season_entries AS season_entry
        WHERE season_entry.profile_id = profile_record.profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.finalized_season_profile_freshness AS freshness_record
        WHERE freshness_record.profile_id = profile_record.profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.profile_car_recipes AS active_recipe
        WHERE active_recipe.profile_id = profile_record.profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.car_recipe_proposals AS pending_recipe
        WHERE pending_recipe.profile_id = profile_record.profile_id
      )
    ORDER BY profile_record.created_at, profile_record.profile_id
    LIMIT 1
    FOR UPDATE OF profile_record SKIP LOCKED;

    EXIT WHEN candidate_profile_id IS NULL;

    DELETE FROM viberacing_private.profiles AS profile_record
    WHERE profile_record.profile_id = candidate_profile_id
      AND profile_record.state = 'enrolling'
      AND EXISTS (
        SELECT 1
        FROM viberacing_private.invites AS invite_record
        WHERE invite_record.redeemed_profile_id = profile_record.profile_id
          AND invite_record.state = 'redeemed'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.sessions AS session_record
        WHERE session_record.profile_id = profile_record.profile_id
          AND (
            session_record.expires_at >= now_at
            OR session_record.authentication_kind <> 'enrollment'
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.auth_challenges AS challenge_record
        WHERE challenge_record.profile_id = profile_record.profile_id
          AND (
            challenge_record.expires_at >= now_at
            OR challenge_record.purpose <> 'passkey_registration'
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.passkeys AS passkey_record
        WHERE passkey_record.profile_id = profile_record.profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.recovery_codes AS recovery_code
        WHERE recovery_code.profile_id = profile_record.profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.recovery_authorities AS recovery_authority
        WHERE recovery_authority.profile_id = profile_record.profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.codex_sources AS source_record
        WHERE source_record.profile_id = profile_record.profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.deletion_jobs AS deletion_job
        WHERE deletion_job.profile_id = profile_record.profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.season_entries AS season_entry
        WHERE season_entry.profile_id = profile_record.profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.finalized_season_profile_freshness AS freshness_record
        WHERE freshness_record.profile_id = profile_record.profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.profile_car_recipes AS active_recipe
        WHERE active_recipe.profile_id = profile_record.profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.car_recipe_proposals AS pending_recipe
        WHERE pending_recipe.profile_id = profile_record.profile_id
      );

    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    IF changed_rows <> 1 THEN
      PERFORM viberacing_private.operation_failed();
    END IF;
    deleted_enrollments := deleted_enrollments + 1;
  END LOOP;

  RETURN NEXT;
EXCEPTION
  WHEN lock_not_available OR integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
    RETURN;
END
$function$;

CREATE OR REPLACE FUNCTION viberacing_api.list_public_community_race_status(
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
  LEFT JOIN viberacing_private.finalized_season_profile_freshness AS finalized_freshness
    ON finalized_freshness.season_start = race_record.season_start
    AND finalized_freshness.profile_id = profile_record.profile_id
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

CREATE FUNCTION viberacing_api.cleanup_finalized_source_day_values(
  p_batch_size integer
)
RETURNS TABLE (
  deleted_source_day_values integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  candidate record;
  changed_rows bigint;
  cutoff_at timestamptz(3);
  live_last_accepted_date date;
  live_source_count bigint;
  live_value_count bigint;
  locked_mutex_count bigint;
  now_at timestamptz(3);
BEGIN
  IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 1000 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  -- Preserve profile-purge order while serializing terminal scoring and every capability that can
  -- remove an exact source-day provenance reference. No new maintenance row or caller lock exists.
  PERFORM lock_record.capability
  FROM viberacing_private.maintenance_locks AS lock_record
  WHERE lock_record.capability IN (
    'community_scoring_refresh',
    'ingest_retention_cleanup',
    'profile_deletion_purge'
  )
  ORDER BY lock_record.capability
  FOR UPDATE;

  GET DIAGNOSTICS locked_mutex_count = ROW_COUNT;
  IF locked_mutex_count <> 3 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  now_at := pg_catalog.clock_timestamp();
  cutoff_at := now_at - INTERVAL '30 days';
  deleted_source_day_values := 0;

  LOOP
    EXIT WHEN deleted_source_day_values >= p_batch_size;
    candidate := NULL;

    SELECT
      season_record.season_start,
      projection_record.profile_id,
      source_value.source_id,
      source_value.codex_reported_date,
      projection_record.last_accepted_date,
      projection_record.retained_source_count,
      projection_record.source_day_value_count,
      projection_record.deleted_source_day_value_count
    INTO candidate
    FROM viberacing_private.seasons AS season_record
    JOIN viberacing_private.finalized_season_profile_freshness AS projection_record
      ON projection_record.season_start = season_record.season_start
    JOIN viberacing_private.codex_sources AS source_record
      ON source_record.profile_id = projection_record.profile_id
    JOIN viberacing_private.source_day_values AS source_value
      ON source_value.source_id = source_record.source_id
      AND source_value.codex_reported_date
        BETWEEN season_record.season_start AND season_record.season_end
    WHERE season_record.state = 'finalized'
      AND season_record.finalized_at <= cutoff_at
      AND projection_record.source_values_purged_at IS NULL
      AND projection_record.deleted_source_day_value_count
        < projection_record.source_day_value_count
    ORDER BY
      season_record.finalized_at,
      season_record.season_start,
      projection_record.profile_id,
      source_value.last_accepted_at,
      source_value.source_id,
      source_value.codex_reported_date
    LIMIT 1
    FOR UPDATE OF projection_record, source_value SKIP LOCKED;

    EXIT WHEN candidate.season_start IS NULL;

    SELECT
      pg_catalog.count(DISTINCT source_value.source_id),
      pg_catalog.count(*),
      pg_catalog.max(
        (source_value.last_accepted_at AT TIME ZONE 'UTC')::date
      )
    INTO live_source_count, live_value_count, live_last_accepted_date
    FROM viberacing_private.source_day_values AS source_value
    JOIN viberacing_private.codex_sources AS source_record
      ON source_record.source_id = source_value.source_id
    WHERE source_record.profile_id = candidate.profile_id
      AND source_value.codex_reported_date
        BETWEEN candidate.season_start AND candidate.season_start + 6;

    IF live_value_count + candidate.deleted_source_day_value_count
        <> candidate.source_day_value_count
      OR live_last_accepted_date IS DISTINCT FROM candidate.last_accepted_date
      OR (
        candidate.deleted_source_day_value_count = 0
        AND live_source_count <> candidate.retained_source_count
      ) THEN
      PERFORM viberacing_private.operation_failed();
    END IF;

    DELETE FROM viberacing_private.source_day_values AS source_value
    WHERE source_value.source_id = candidate.source_id
      AND source_value.codex_reported_date = candidate.codex_reported_date
      AND EXISTS (
        SELECT 1
        FROM viberacing_private.codex_sources AS source_record
        WHERE source_record.source_id = source_value.source_id
          AND source_record.profile_id = candidate.profile_id
      )
      AND EXISTS (
        SELECT 1
        FROM viberacing_private.seasons AS season_record
        JOIN viberacing_private.finalized_season_profile_freshness AS projection_record
          ON projection_record.season_start = season_record.season_start
          AND projection_record.profile_id = candidate.profile_id
        WHERE season_record.season_start = candidate.season_start
          AND season_record.state = 'finalized'
          AND season_record.finalized_at <= cutoff_at
          AND projection_record.source_values_purged_at IS NULL
          AND projection_record.deleted_source_day_value_count
            = candidate.deleted_source_day_value_count
          AND projection_record.source_day_value_count = candidate.source_day_value_count
      );

    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    IF changed_rows <> 1 THEN
      PERFORM viberacing_private.operation_failed();
    END IF;

    UPDATE viberacing_private.finalized_season_profile_freshness AS projection_record
    SET deleted_source_day_value_count = projection_record.deleted_source_day_value_count + 1,
      source_values_purged_at = CASE
        WHEN projection_record.deleted_source_day_value_count + 1
          = projection_record.source_day_value_count
        THEN now_at
        ELSE NULL
      END
    WHERE projection_record.season_start = candidate.season_start
      AND projection_record.profile_id = candidate.profile_id
      AND projection_record.source_values_purged_at IS NULL
      AND projection_record.deleted_source_day_value_count
        = candidate.deleted_source_day_value_count
      AND projection_record.source_day_value_count = candidate.source_day_value_count;

    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    IF changed_rows <> 1 THEN
      PERFORM viberacing_private.operation_failed();
    END IF;

    deleted_source_day_values := deleted_source_day_values + 1;
  END LOOP;

  RETURN NEXT;
EXCEPTION
  WHEN lock_not_available OR integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
    RETURN;
END
$function$;

REVOKE EXECUTE ON FUNCTION viberacing_private.capture_finalized_season_profile_freshness()
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
REVOKE EXECUTE ON FUNCTION viberacing_private.enforce_finalized_profile_freshness_transition()
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
REVOKE EXECUTE ON FUNCTION viberacing_api.cleanup_finalized_source_day_values(integer)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

GRANT EXECUTE ON FUNCTION viberacing_api.cleanup_finalized_source_day_values(integer)
  TO viberacing_jobs;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (39, 'finalized_source_day_retention_cleanup');

COMMIT;
