\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824762001);

CREATE TABLE viberacing_private.seasons (
  season_start date NOT NULL,
  trust_tier varchar(12) NOT NULL,
  season_end date NOT NULL,
  metric_version varchar(40) NOT NULL,
  accounting_policy_version varchar(48) NOT NULL,
  state varchar(12) NOT NULL DEFAULT 'open',
  opened_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  grace_ends_at timestamptz NOT NULL,
  refreshed_at timestamptz,
  finalized_at timestamptz,
  PRIMARY KEY (season_start, trust_tier),
  CONSTRAINT seasons_start_monday
    CHECK (extract(isodow FROM season_start) = 1),
  CONSTRAINT seasons_end_sunday
    CHECK (
      season_end = season_start + 6
      AND extract(isodow FROM season_end) = 7
    ),
  CONSTRAINT seasons_metric_final
    CHECK (metric_version = 'provider_reported_tokens_v1'),
  CONSTRAINT seasons_trust_tier_closed
    CHECK (trust_tier IN ('community', 'verified')),
  CONSTRAINT seasons_accounting_policy_final
    CHECK (accounting_policy_version = 'agent_account_cumulative_utc_v1'),
  CONSTRAINT seasons_state_closed
    CHECK (state IN ('open', 'grace', 'finalized')),
  CONSTRAINT seasons_grace_exact CHECK (
    grace_ends_at = (
      (season_end + 1)::timestamp AT TIME ZONE 'UTC'
    ) + interval '48 hours'
  ),
  CONSTRAINT seasons_time_order CHECK (
    grace_ends_at > opened_at
    AND (refreshed_at IS NULL OR refreshed_at >= opened_at)
    AND (finalized_at IS NULL OR finalized_at >= opened_at)
  ),
  CONSTRAINT seasons_lifecycle_shape CHECK (
    (state IN ('open', 'grace') AND finalized_at IS NULL)
    OR (state = 'finalized' AND finalized_at IS NOT NULL)
  )
);

CREATE INDEX seasons_state_grace_idx
  ON viberacing_private.seasons (state, grace_ends_at, season_start)
  WHERE state <> 'finalized';

CREATE TABLE viberacing_private.season_profile_totals (
  season_start date NOT NULL,
  trust_tier varchar(12) NOT NULL,
  profile_id uuid NOT NULL
    REFERENCES viberacing_private.profiles(profile_id) ON DELETE RESTRICT,
  weekly_token_total numeric(60, 0) NOT NULL,
  rank_position bigint,
  display_position bigint,
  freshness_days integer NOT NULL,
  generated_at timestamptz NOT NULL,
  PRIMARY KEY (season_start, trust_tier, profile_id),
  CONSTRAINT season_profile_totals_season_fk
    FOREIGN KEY (season_start, trust_tier)
    REFERENCES viberacing_private.seasons(season_start, trust_tier)
    ON DELETE RESTRICT,
  CONSTRAINT season_profile_totals_nonnegative
    CHECK (weekly_token_total >= 0),
  CONSTRAINT season_profile_totals_rank_shape CHECK (
    (rank_position IS NULL AND display_position IS NULL)
    OR (rank_position > 0 AND display_position > 0)
  ),
  CONSTRAINT season_profile_totals_freshness_bounded
    CHECK (freshness_days BETWEEN 0 AND 366)
);

CREATE UNIQUE INDEX season_profile_totals_display_unique_idx
  ON viberacing_private.season_profile_totals (
    season_start,
    trust_tier,
    display_position
  )
  WHERE display_position IS NOT NULL;

CREATE INDEX season_profile_totals_rank_idx
  ON viberacing_private.season_profile_totals (
    season_start,
    trust_tier,
    rank_position,
    display_position
  )
  WHERE rank_position IS NOT NULL;

CREATE TABLE viberacing_private.season_profile_provider_totals (
  season_start date NOT NULL,
  trust_tier varchar(12) NOT NULL,
  profile_id uuid NOT NULL,
  provider_code varchar(24) NOT NULL
    REFERENCES viberacing_private.agent_providers(provider_code) ON DELETE RESTRICT,
  provider_token_total numeric(60, 0) NOT NULL,
  percentage integer NOT NULL,
  generated_at timestamptz NOT NULL,
  PRIMARY KEY (season_start, trust_tier, profile_id, provider_code),
  CONSTRAINT season_profile_provider_totals_profile_fk
    FOREIGN KEY (season_start, trust_tier, profile_id)
    REFERENCES viberacing_private.season_profile_totals(
      season_start,
      trust_tier,
      profile_id
    )
    ON DELETE CASCADE,
  CONSTRAINT season_profile_provider_totals_value_shape CHECK (
    provider_token_total >= 0
    AND percentage BETWEEN 0 AND 100
  )
);

CREATE TABLE viberacing_private.leaderboard_snapshots (
  snapshot_id varchar(26) PRIMARY KEY,
  season_start date NOT NULL,
  trust_tier varchar(12) NOT NULL,
  revision bigint NOT NULL,
  generated_at timestamptz NOT NULL,
  finalized boolean NOT NULL,
  participant_count integer NOT NULL,
  payload_digest bytea,
  etag varchar(66),
  state varchar(12) NOT NULL DEFAULT 'building',
  CONSTRAINT leaderboard_snapshots_id_canonical
    CHECK (snapshot_id ~ '^snp_[A-Za-z0-9_-]{22}$'),
  CONSTRAINT leaderboard_snapshots_season_fk
    FOREIGN KEY (season_start, trust_tier)
    REFERENCES viberacing_private.seasons(season_start, trust_tier)
    ON DELETE RESTRICT,
  CONSTRAINT leaderboard_snapshots_revision_positive CHECK (revision > 0),
  CONSTRAINT leaderboard_snapshots_participant_bounded
    CHECK (participant_count BETWEEN 0 AND 1000000),
  CONSTRAINT leaderboard_snapshots_state_closed
    CHECK (state IN ('building', 'published', 'superseded')),
  CONSTRAINT leaderboard_snapshots_publish_shape CHECK (
    (state = 'building' AND payload_digest IS NULL AND etag IS NULL)
    OR (
      state IN ('published', 'superseded')
      AND pg_catalog.octet_length(payload_digest) = 32
      AND etag ~ '^"[a-f0-9]{64}"$'
    )
  ),
  CONSTRAINT leaderboard_snapshots_revision_unique
    UNIQUE (season_start, trust_tier, revision)
);

CREATE INDEX leaderboard_snapshots_history_idx
  ON viberacing_private.leaderboard_snapshots (
    season_start,
    trust_tier,
    revision DESC
  );

CREATE TABLE viberacing_private.leaderboard_snapshot_pages (
  snapshot_id varchar(26) NOT NULL
    REFERENCES viberacing_private.leaderboard_snapshots(snapshot_id) ON DELETE CASCADE,
  page_kind varchar(24) NOT NULL,
  page_number integer NOT NULL,
  participant_count integer NOT NULL,
  canonical_payload text NOT NULL,
  payload_digest bytea NOT NULL,
  PRIMARY KEY (snapshot_id, page_kind, page_number),
  CONSTRAINT leaderboard_snapshot_pages_kind_closed
    CHECK (page_kind IN ('race_top32', 'leaderboard_page')),
  CONSTRAINT leaderboard_snapshot_pages_number_positive
    CHECK (page_number > 0),
  CONSTRAINT leaderboard_snapshot_pages_participant_bounded
    CHECK (
      participant_count BETWEEN 0 AND 100
      AND (page_kind <> 'race_top32' OR participant_count <= 32)
    ),
  CONSTRAINT leaderboard_snapshot_pages_payload_bounded CHECK (
    pg_catalog.octet_length(canonical_payload) BETWEEN 2 AND 1048576
    AND pg_catalog.octet_length(payload_digest) = 32
  )
);

CREATE TABLE viberacing_private.leaderboard_snapshot_profiles (
  snapshot_id varchar(26) NOT NULL
    REFERENCES viberacing_private.leaderboard_snapshots(snapshot_id) ON DELETE CASCADE,
  handle varchar(24) NOT NULL,
  canonical_payload text NOT NULL,
  payload_digest bytea NOT NULL,
  PRIMARY KEY (snapshot_id, handle),
  CONSTRAINT leaderboard_snapshot_profiles_handle_canonical
    CHECK (handle ~ '^[a-z0-9](?:[a-z0-9_-]{1,22}[a-z0-9])$'),
  CONSTRAINT leaderboard_snapshot_profiles_payload_bounded CHECK (
    pg_catalog.octet_length(canonical_payload) BETWEEN 2 AND 65536
    AND pg_catalog.octet_length(payload_digest) = 32
  )
);

CREATE TABLE viberacing_private.leaderboard_published_snapshots (
  season_start date NOT NULL,
  trust_tier varchar(12) NOT NULL,
  snapshot_id varchar(26) NOT NULL UNIQUE
    REFERENCES viberacing_private.leaderboard_snapshots(snapshot_id) ON DELETE RESTRICT,
  published_at timestamptz NOT NULL,
  PRIMARY KEY (season_start, trust_tier),
  CONSTRAINT leaderboard_published_snapshots_season_fk
    FOREIGN KEY (season_start, trust_tier)
    REFERENCES viberacing_private.seasons(season_start, trust_tier)
    ON DELETE RESTRICT
);

CREATE TABLE viberacing_private.maintenance_mutexes (
  capability varchar(32) PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  CONSTRAINT maintenance_mutexes_capability_closed CHECK (
    capability IN ('season_ensure', 'leaderboard_refresh', 'season_finalization')
  )
);

INSERT INTO viberacing_private.maintenance_mutexes (capability)
VALUES
  ('season_ensure'),
  ('leaderboard_refresh'),
  ('season_finalization');

CREATE FUNCTION viberacing_private.enforce_season_update()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.season_start <> OLD.season_start
    OR NEW.season_end <> OLD.season_end
    OR NEW.trust_tier <> OLD.trust_tier
    OR NEW.metric_version <> OLD.metric_version
    OR NEW.accounting_policy_version <> OLD.accounting_policy_version
    OR NEW.opened_at <> OLD.opened_at
    OR NEW.grace_ends_at <> OLD.grace_ends_at
    OR OLD.state = 'finalized'
    OR (OLD.state = 'open' AND NEW.state NOT IN ('open', 'grace', 'finalized'))
    OR (OLD.state = 'grace' AND NEW.state NOT IN ('grace', 'finalized'))
    OR NEW.refreshed_at IS DISTINCT FROM OLD.refreshed_at
      AND (
        NEW.refreshed_at IS NULL
        OR (OLD.refreshed_at IS NOT NULL AND NEW.refreshed_at < OLD.refreshed_at)
      )
    OR OLD.finalized_at IS NOT NULL
      AND NEW.finalized_at IS DISTINCT FROM OLD.finalized_at
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER seasons_enforce_update
BEFORE UPDATE ON viberacing_private.seasons
FOR EACH ROW EXECUTE FUNCTION viberacing_private.enforce_season_update();

CREATE FUNCTION viberacing_private.enforce_snapshot_update()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.snapshot_id <> OLD.snapshot_id
    OR NEW.season_start <> OLD.season_start
    OR NEW.trust_tier <> OLD.trust_tier
    OR NEW.revision <> OLD.revision
    OR NEW.generated_at <> OLD.generated_at
    OR NEW.finalized <> OLD.finalized
    OR NEW.participant_count <> OLD.participant_count
    OR (
      OLD.state = 'building'
      AND NEW.state NOT IN ('building', 'published')
    )
    OR (
      OLD.state = 'published'
      AND NEW.state NOT IN ('published', 'superseded')
    )
    OR OLD.state = 'superseded'
    OR (
      OLD.state <> 'building'
      AND (
        NEW.payload_digest IS DISTINCT FROM OLD.payload_digest
        OR NEW.etag IS DISTINCT FROM OLD.etag
      )
    )
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER leaderboard_snapshots_enforce_update
BEFORE UPDATE ON viberacing_private.leaderboard_snapshots
FOR EACH ROW EXECUTE FUNCTION viberacing_private.enforce_snapshot_update();

CREATE FUNCTION viberacing_private.reject_snapshot_payload_update()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  PERFORM viberacing_private.operation_failed();
  RETURN NULL;
END
$function$;

CREATE TRIGGER leaderboard_snapshot_pages_immutable
BEFORE UPDATE ON viberacing_private.leaderboard_snapshot_pages
FOR EACH ROW EXECUTE FUNCTION viberacing_private.reject_snapshot_payload_update();

CREATE TRIGGER leaderboard_snapshot_profiles_immutable
BEFORE UPDATE ON viberacing_private.leaderboard_snapshot_profiles
FOR EACH ROW EXECUTE FUNCTION viberacing_private.reject_snapshot_payload_update();

CREATE FUNCTION viberacing_private.enforce_derived_total_mutation()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_season_start date;
  v_trust_tier text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_season_start := OLD.season_start;
    v_trust_tier := OLD.trust_tier;
  ELSE
    v_season_start := NEW.season_start;
    v_trust_tier := NEW.trust_tier;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM viberacing_private.seasons AS season
    WHERE season.season_start = v_season_start
      AND season.trust_tier = v_trust_tier
      AND season.state = 'finalized'
  ) THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER season_profile_totals_finalized_guard
BEFORE INSERT OR UPDATE OR DELETE ON viberacing_private.season_profile_totals
FOR EACH ROW EXECUTE FUNCTION viberacing_private.enforce_derived_total_mutation();

CREATE TRIGGER season_profile_provider_totals_finalized_guard
BEFORE INSERT OR UPDATE OR DELETE ON viberacing_private.season_profile_provider_totals
FOR EACH ROW EXECUTE FUNCTION viberacing_private.enforce_derived_total_mutation();

CREATE FUNCTION viberacing_private.enforce_observation_seasons_open()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_season_start date;
BEGIN
  FOREACH v_season_start IN ARRAY NEW.season_starts
  LOOP
    PERFORM 1
    FROM viberacing_private.seasons AS season
    WHERE season.season_start = v_season_start
      AND season.trust_tier = 'community'
      AND season.metric_version = 'provider_reported_tokens_v1'
      AND season.accounting_policy_version = 'agent_account_cumulative_utc_v1'
      AND season.state IN ('open', 'grace')
    FOR SHARE;
    IF NOT FOUND THEN
      PERFORM viberacing_private.operation_failed();
    END IF;
  END LOOP;
  RETURN NEW;
END
$function$;

CREATE TRIGGER usage_observations_require_open_seasons
BEFORE INSERT ON viberacing_private.usage_observations
FOR EACH ROW EXECUTE FUNCTION viberacing_private.enforce_observation_seasons_open();

CREATE FUNCTION viberacing_private.enforce_day_total_season_open()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_season_start date;
BEGIN
  v_season_start := NEW.usage_date
    - (extract(isodow FROM NEW.usage_date)::integer - 1);
  PERFORM 1
  FROM viberacing_private.seasons AS season
  WHERE season.season_start = v_season_start
    AND season.trust_tier = 'community'
    AND season.state IN ('open', 'grace')
  FOR SHARE;
  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER agent_account_day_totals_require_open_season
BEFORE INSERT OR UPDATE ON viberacing_private.agent_account_day_totals
FOR EACH ROW EXECUTE FUNCTION viberacing_private.enforce_day_total_season_open();

CREATE FUNCTION viberacing_private.mark_profile_seasons_dirty()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF NEW.public_visibility IS DISTINCT FROM OLD.public_visibility
    OR NEW.state IS DISTINCT FROM OLD.state
    OR NEW.handle IS DISTINCT FROM OLD.handle
    OR NEW.provider_breakdown_visible IS DISTINCT FROM OLD.provider_breakdown_visible
  THEN
    INSERT INTO viberacing_private.ranking_refresh_outbox (
      season_start,
      trust_tier,
      dirty_since,
      last_observation_id,
      attempt_count,
      next_attempt_at,
      state
    )
    SELECT
      season.season_start,
      season.trust_tier,
      v_now,
      NULL,
      0,
      v_now,
      'pending'
    FROM viberacing_private.seasons AS season
    WHERE season.trust_tier = 'community'
      AND season.state IN ('open', 'grace')
      AND (
        EXISTS (
          SELECT 1
          FROM viberacing_private.agent_accounts AS account
          JOIN viberacing_private.agent_account_day_totals AS day_total
            ON day_total.agent_account_id = account.agent_account_id
          WHERE account.profile_id = NEW.profile_id
            AND day_total.usage_date BETWEEN season.season_start AND season.season_end
        )
        OR EXISTS (
          SELECT 1
          FROM viberacing_private.leaderboard_published_snapshots AS published
          JOIN viberacing_private.leaderboard_snapshot_profiles AS snapshot_profile
            ON snapshot_profile.snapshot_id = published.snapshot_id
          WHERE published.season_start = season.season_start
            AND published.trust_tier = season.trust_tier
            AND snapshot_profile.handle IN (OLD.handle, NEW.handle)
        )
      )
    ON CONFLICT (season_start, trust_tier) DO UPDATE
    SET dirty_since = least(ranking_refresh_outbox.dirty_since, EXCLUDED.dirty_since),
        last_observation_id = coalesce(
          EXCLUDED.last_observation_id,
          ranking_refresh_outbox.last_observation_id
        ),
        attempt_count = 0,
        next_attempt_at = least(
          ranking_refresh_outbox.next_attempt_at,
          EXCLUDED.next_attempt_at
        ),
        state = 'pending';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER profiles_mark_seasons_dirty
AFTER UPDATE ON viberacing_private.profiles
FOR EACH ROW EXECUTE FUNCTION viberacing_private.mark_profile_seasons_dirty();

CREATE FUNCTION viberacing_private.build_community_snapshot(
  p_season_start date,
  p_finalized boolean
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_generated_at timestamptz := pg_catalog.clock_timestamp();
  v_page_count integer;
  v_page_number integer;
  v_participant_count integer;
  v_participants jsonb;
  v_payload text;
  v_payload_digest bytea;
  v_payload_inventory text;
  v_previous_snapshot_id text;
  v_profile record;
  v_public_state text;
  v_race_count integer;
  v_revision bigint;
  v_season viberacing_private.seasons%ROWTYPE;
  v_snapshot_digest bytea;
  v_snapshot_id text;
BEGIN
  SELECT season.*
  INTO v_season
  FROM viberacing_private.seasons AS season
  WHERE season.season_start = p_season_start
    AND season.trust_tier = 'community'
    AND season.state IN ('open', 'grace')
  FOR UPDATE;
  IF v_season.season_start IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  v_public_state := CASE WHEN p_finalized THEN 'finalized' ELSE v_season.state END;

  DELETE FROM viberacing_private.season_profile_provider_totals
  WHERE season_start = p_season_start
    AND trust_tier = 'community';
  DELETE FROM viberacing_private.season_profile_totals
  WHERE season_start = p_season_start
    AND trust_tier = 'community';

  WITH profile_totals AS (
    SELECT
      account.profile_id,
      pg_catalog.sum(day_total.cumulative_token_total)::numeric(60, 0)
        AS weekly_token_total,
      pg_catalog.max(day_total.usage_date) AS latest_usage_date
    FROM viberacing_private.agent_account_day_totals AS day_total
    JOIN viberacing_private.agent_accounts AS account
      ON account.agent_account_id = day_total.agent_account_id
    JOIN viberacing_private.profiles AS profile
      ON profile.profile_id = account.profile_id
    WHERE day_total.usage_date BETWEEN v_season.season_start AND v_season.season_end
      AND account.identity_assurance = 'community_local'
      AND account.scope_kind = 'agent_account'
      AND profile.state = 'active'
    GROUP BY account.profile_id
  ),
  visible_ranked AS (
    SELECT
      profile_total.profile_id,
      pg_catalog.rank() OVER (
        ORDER BY profile_total.weekly_token_total DESC
      ) AS rank_position,
      pg_catalog.row_number() OVER (
        ORDER BY profile_total.weekly_token_total DESC, profile_total.profile_id
      ) AS display_position
    FROM profile_totals AS profile_total
    JOIN viberacing_private.profiles AS profile
      ON profile.profile_id = profile_total.profile_id
    WHERE profile.public_visibility = 'public'
  )
  INSERT INTO viberacing_private.season_profile_totals (
    season_start,
    trust_tier,
    profile_id,
    weekly_token_total,
    rank_position,
    display_position,
    freshness_days,
    generated_at
  )
  SELECT
    v_season.season_start,
    'community',
    profile_total.profile_id,
    profile_total.weekly_token_total,
    visible_ranked.rank_position,
    visible_ranked.display_position,
    (
      least(
        (v_generated_at AT TIME ZONE 'UTC')::date,
        v_season.season_end
      ) - profile_total.latest_usage_date
    )::integer,
    v_generated_at
  FROM profile_totals AS profile_total
  LEFT JOIN visible_ranked
    ON visible_ranked.profile_id = profile_total.profile_id;

  INSERT INTO viberacing_private.season_profile_provider_totals (
    season_start,
    trust_tier,
    profile_id,
    provider_code,
    provider_token_total,
    percentage,
    generated_at
  )
  SELECT
    v_season.season_start,
    'community',
    account.profile_id,
    account.provider_code,
    pg_catalog.sum(day_total.cumulative_token_total)::numeric(60, 0),
    CASE
      WHEN profile_total.weekly_token_total = 0 THEN 0
      ELSE pg_catalog.floor(
        pg_catalog.sum(day_total.cumulative_token_total)
          * 100
          / profile_total.weekly_token_total
      )::integer
    END,
    v_generated_at
  FROM viberacing_private.agent_account_day_totals AS day_total
  JOIN viberacing_private.agent_accounts AS account
    ON account.agent_account_id = day_total.agent_account_id
  JOIN viberacing_private.season_profile_totals AS profile_total
    ON profile_total.season_start = v_season.season_start
    AND profile_total.trust_tier = 'community'
    AND profile_total.profile_id = account.profile_id
  WHERE day_total.usage_date BETWEEN v_season.season_start AND v_season.season_end
    AND account.identity_assurance = 'community_local'
    AND account.scope_kind = 'agent_account'
  GROUP BY
    account.profile_id,
    account.provider_code,
    profile_total.weekly_token_total;

  SELECT pg_catalog.count(*)::integer
  INTO v_participant_count
  FROM viberacing_private.season_profile_totals
  WHERE season_start = v_season.season_start
    AND trust_tier = 'community'
    AND rank_position IS NOT NULL;

  SELECT coalesce(pg_catalog.max(snapshot.revision), 0) + 1
  INTO v_revision
  FROM viberacing_private.leaderboard_snapshots AS snapshot
  WHERE snapshot.season_start = v_season.season_start
    AND snapshot.trust_tier = 'community';

  v_snapshot_id := 'snp_' || pg_catalog.substr(
    pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          v_season.season_start::text || chr(10)
            || v_revision::text || chr(10)
            || pg_catalog.to_char(
              v_generated_at AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            ),
          'UTF8'
        )
      ),
      'hex'
    ),
    1,
    22
  );

  INSERT INTO viberacing_private.leaderboard_snapshots (
    snapshot_id,
    season_start,
    trust_tier,
    revision,
    generated_at,
    finalized,
    participant_count
  )
  VALUES (
    v_snapshot_id,
    v_season.season_start,
    'community',
    v_revision,
    v_generated_at,
    p_finalized,
    v_participant_count
  );

  v_page_count := greatest(1, pg_catalog.ceil(v_participant_count / 100.0)::integer);
  FOR v_page_number IN 1..v_page_count LOOP
    SELECT coalesce(
      pg_catalog.jsonb_agg(participant.value ORDER BY participant.display_position),
      jsonb '[]'
    )
    INTO v_participants
    FROM (
      SELECT
        profile_total.display_position,
        pg_catalog.jsonb_build_object(
          'displayPosition',
          profile_total.display_position,
          'freshnessDays',
          profile_total.freshness_days,
          'handle',
          profile.handle,
          'rankPosition',
          profile_total.rank_position,
          'weeklyTokenTotal',
          profile_total.weekly_token_total::text
        ) || CASE
          WHEN profile.provider_breakdown_visible THEN
            pg_catalog.jsonb_build_object(
              'providerBreakdown',
              (
                SELECT coalesce(
                  pg_catalog.jsonb_agg(
                    pg_catalog.jsonb_build_object(
                      'percentage',
                      provider_total.percentage,
                      'provider',
                      provider_total.provider_code
                    )
                    ORDER BY provider_total.provider_code
                  ),
                  jsonb '[]'
                )
                FROM viberacing_private.season_profile_provider_totals AS provider_total
                WHERE provider_total.season_start = v_season.season_start
                  AND provider_total.trust_tier = 'community'
                  AND provider_total.profile_id = profile_total.profile_id
              )
            )
          ELSE jsonb '{}'
        END AS value
      FROM viberacing_private.season_profile_totals AS profile_total
      JOIN viberacing_private.profiles AS profile
        ON profile.profile_id = profile_total.profile_id
      WHERE profile_total.season_start = v_season.season_start
        AND profile_total.trust_tier = 'community'
        AND profile_total.display_position BETWEEN
          ((v_page_number - 1) * 100 + 1) AND (v_page_number * 100)
      ORDER BY profile_total.display_position
    ) AS participant;

    v_payload := pg_catalog.jsonb_build_object(
      'generatedAt',
      pg_catalog.to_char(
        v_generated_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ),
      'metricVersion',
      v_season.metric_version,
      'nextPage',
      CASE WHEN v_page_number < v_page_count THEN v_page_number + 1 ELSE NULL END,
      'page',
      v_page_number,
      'pageSize',
      100,
      'participantCount',
      v_participant_count,
      'participants',
      v_participants,
      'schemaVersion',
      1,
      'seasonEnd',
      v_season.season_end::text,
      'seasonStart',
      v_season.season_start::text,
      'seasonState',
      v_public_state,
      'snapshotRevision',
      v_revision,
      'trustTier',
      'community'
    )::text;
    v_payload_digest := pg_catalog.sha256(pg_catalog.convert_to(v_payload, 'UTF8'));

    INSERT INTO viberacing_private.leaderboard_snapshot_pages (
      snapshot_id,
      page_kind,
      page_number,
      participant_count,
      canonical_payload,
      payload_digest
    )
    VALUES (
      v_snapshot_id,
      'leaderboard_page',
      v_page_number,
      pg_catalog.jsonb_array_length(v_participants),
      v_payload,
      v_payload_digest
    );
  END LOOP;

  SELECT coalesce(
    pg_catalog.jsonb_agg(participant.value ORDER BY participant.display_position),
    jsonb '[]'
  )
  INTO v_participants
  FROM (
    SELECT
      profile_total.display_position,
      pg_catalog.jsonb_build_object(
        'displayPosition',
        profile_total.display_position,
        'freshnessDays',
        profile_total.freshness_days,
        'handle',
        profile.handle,
        'rankPosition',
        profile_total.rank_position,
        'weeklyTokenTotal',
        profile_total.weekly_token_total::text
      ) || CASE
        WHEN profile.provider_breakdown_visible THEN
          pg_catalog.jsonb_build_object(
            'providerBreakdown',
            (
              SELECT coalesce(
                pg_catalog.jsonb_agg(
                  pg_catalog.jsonb_build_object(
                    'percentage',
                    provider_total.percentage,
                    'provider',
                    provider_total.provider_code
                  )
                  ORDER BY provider_total.provider_code
                ),
                jsonb '[]'
              )
              FROM viberacing_private.season_profile_provider_totals AS provider_total
              WHERE provider_total.season_start = v_season.season_start
                AND provider_total.trust_tier = 'community'
                AND provider_total.profile_id = profile_total.profile_id
            )
          )
        ELSE jsonb '{}'
      END AS value
    FROM viberacing_private.season_profile_totals AS profile_total
    JOIN viberacing_private.profiles AS profile
      ON profile.profile_id = profile_total.profile_id
    WHERE profile_total.season_start = v_season.season_start
      AND profile_total.trust_tier = 'community'
      AND profile_total.display_position BETWEEN 1 AND 32
    ORDER BY profile_total.display_position
  ) AS participant;

  v_race_count := pg_catalog.jsonb_array_length(v_participants);
  v_payload := pg_catalog.jsonb_build_object(
    'generatedAt',
    pg_catalog.to_char(
      v_generated_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'metricVersion',
    v_season.metric_version,
    'nextPage',
    NULL,
    'page',
    1,
    'pageSize',
    32,
    'participantCount',
    v_participant_count,
    'participants',
    v_participants,
    'schemaVersion',
    1,
    'seasonEnd',
    v_season.season_end::text,
    'seasonStart',
    v_season.season_start::text,
    'seasonState',
    v_public_state,
    'snapshotRevision',
    v_revision,
    'trustTier',
    'community'
  )::text;
  v_payload_digest := pg_catalog.sha256(pg_catalog.convert_to(v_payload, 'UTF8'));
  INSERT INTO viberacing_private.leaderboard_snapshot_pages (
    snapshot_id,
    page_kind,
    page_number,
    participant_count,
    canonical_payload,
    payload_digest
  )
  VALUES (
    v_snapshot_id,
    'race_top32',
    1,
    v_race_count,
    v_payload,
    v_payload_digest
  );

  FOR v_profile IN
    SELECT
      profile.profile_id,
      profile.handle,
      profile.provider_breakdown_visible,
      profile_total.weekly_token_total,
      profile_total.rank_position,
      profile_total.freshness_days
    FROM viberacing_private.season_profile_totals AS profile_total
    JOIN viberacing_private.profiles AS profile
      ON profile.profile_id = profile_total.profile_id
    WHERE profile_total.season_start = v_season.season_start
      AND profile_total.trust_tier = 'community'
      AND profile_total.rank_position IS NOT NULL
    ORDER BY profile.handle
  LOOP
    v_payload := (
      pg_catalog.jsonb_build_object(
        'freshnessDays',
        v_profile.freshness_days,
        'handle',
        v_profile.handle,
        'participantCount',
        v_participant_count,
        'rankPosition',
        v_profile.rank_position,
        'schemaVersion',
        1,
        'season',
        pg_catalog.jsonb_build_object(
          'seasonEnd',
          v_season.season_end::text,
          'seasonStart',
          v_season.season_start::text,
          'seasonState',
          v_public_state
        ),
        'trustTier',
        'community',
        'weeklyTokenTotal',
        v_profile.weekly_token_total::text
      ) || CASE
        WHEN v_profile.provider_breakdown_visible THEN
          pg_catalog.jsonb_build_object(
            'providerBreakdown',
            (
              SELECT coalesce(
                pg_catalog.jsonb_agg(
                  pg_catalog.jsonb_build_object(
                    'percentage',
                    provider_total.percentage,
                    'provider',
                    provider_total.provider_code
                  )
                  ORDER BY provider_total.provider_code
                ),
                jsonb '[]'
              )
              FROM viberacing_private.season_profile_provider_totals AS provider_total
              WHERE provider_total.season_start = v_season.season_start
                AND provider_total.trust_tier = 'community'
                AND provider_total.profile_id = v_profile.profile_id
            )
          )
        ELSE jsonb '{}'
      END
    )::text;
    v_payload_digest := pg_catalog.sha256(pg_catalog.convert_to(v_payload, 'UTF8'));
    INSERT INTO viberacing_private.leaderboard_snapshot_profiles (
      snapshot_id,
      handle,
      canonical_payload,
      payload_digest
    )
    VALUES (
      v_snapshot_id,
      v_profile.handle,
      v_payload,
      v_payload_digest
    );
  END LOOP;

  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.leaderboard_snapshot_pages
    WHERE snapshot_id = v_snapshot_id
      AND page_kind = 'leaderboard_page'
  ) <> v_page_count OR (
    SELECT participant_count
    FROM viberacing_private.leaderboard_snapshot_pages
    WHERE snapshot_id = v_snapshot_id
      AND page_kind = 'race_top32'
      AND page_number = 1
  ) <> least(v_participant_count, 32) OR (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.leaderboard_snapshot_profiles
    WHERE snapshot_id = v_snapshot_id
  ) <> v_participant_count THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT coalesce(
    pg_catalog.string_agg(
      page.page_kind || ':' || page.page_number::text || ':'
        || pg_catalog.encode(page.payload_digest, 'hex'),
      '|' ORDER BY page.page_kind, page.page_number
    ),
    ''
  ) || '|' || coalesce(
    (
      SELECT pg_catalog.string_agg(
        profile.handle || ':' || pg_catalog.encode(profile.payload_digest, 'hex'),
        '|' ORDER BY profile.handle
      )
      FROM viberacing_private.leaderboard_snapshot_profiles AS profile
      WHERE profile.snapshot_id = v_snapshot_id
    ),
    ''
  )
  INTO v_payload_inventory
  FROM viberacing_private.leaderboard_snapshot_pages AS page
  WHERE page.snapshot_id = v_snapshot_id;

  v_snapshot_digest := pg_catalog.sha256(
    pg_catalog.convert_to(v_payload_inventory, 'UTF8')
  );
  UPDATE viberacing_private.leaderboard_snapshots
  SET payload_digest = v_snapshot_digest,
      etag = '"' || pg_catalog.encode(v_snapshot_digest, 'hex') || '"',
      state = 'published'
  WHERE snapshot_id = v_snapshot_id
    AND state = 'building';
  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT published.snapshot_id
  INTO v_previous_snapshot_id
  FROM viberacing_private.leaderboard_published_snapshots AS published
  WHERE published.season_start = v_season.season_start
    AND published.trust_tier = 'community'
  FOR UPDATE;

  IF v_previous_snapshot_id IS NOT NULL THEN
    UPDATE viberacing_private.leaderboard_snapshots
    SET state = 'superseded'
    WHERE snapshot_id = v_previous_snapshot_id
      AND state = 'published';
    IF NOT FOUND THEN
      PERFORM viberacing_private.operation_failed();
    END IF;
  END IF;

  INSERT INTO viberacing_private.leaderboard_published_snapshots (
    season_start,
    trust_tier,
    snapshot_id,
    published_at
  )
  VALUES (
    v_season.season_start,
    'community',
    v_snapshot_id,
    v_generated_at
  )
  ON CONFLICT (season_start, trust_tier) DO UPDATE
  SET snapshot_id = EXCLUDED.snapshot_id,
      published_at = EXCLUDED.published_at;

  RETURN v_snapshot_id;
END
$function$;

CREATE FUNCTION viberacing_api.ensure_current_community_season()
RETURNS date
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_season_start date;
BEGIN
  PERFORM 1
  FROM viberacing_private.maintenance_mutexes
  WHERE capability = 'season_ensure'
  FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_season_start := (v_now AT TIME ZONE 'UTC')::date
    - (extract(isodow FROM (v_now AT TIME ZONE 'UTC')::date)::integer - 1);

  INSERT INTO viberacing_private.seasons (
    season_start,
    trust_tier,
    season_end,
    metric_version,
    accounting_policy_version,
    opened_at,
    grace_ends_at
  )
  VALUES (
    v_season_start,
    'community',
    v_season_start + 6,
    'provider_reported_tokens_v1',
    'agent_account_cumulative_utc_v1',
    v_now,
    ((v_season_start + 7)::timestamp AT TIME ZONE 'UTC') + interval '48 hours'
  )
  ON CONFLICT (season_start, trust_tier) DO NOTHING;

  INSERT INTO viberacing_private.ranking_refresh_outbox (
    season_start,
    trust_tier,
    dirty_since,
    last_observation_id,
    attempt_count,
    next_attempt_at,
    state
  )
  VALUES (
    v_season_start,
    'community',
    v_now,
    NULL,
    0,
    v_now,
    'pending'
  )
  ON CONFLICT (season_start, trust_tier) DO NOTHING;

  RETURN v_season_start;
END
$function$;

CREATE FUNCTION viberacing_api.refresh_next_dirty_community_season()
RETURNS TABLE (
  outcome text,
  season_start date,
  snapshot_id text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_outbox viberacing_private.ranking_refresh_outbox%ROWTYPE;
  v_snapshot_id text;
BEGIN
  PERFORM 1
  FROM viberacing_private.maintenance_mutexes
  WHERE capability = 'leaderboard_refresh'
  FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'busy'::text, NULL::date, NULL::text;
    RETURN;
  END IF;

  SELECT outbox.*
  INTO v_outbox
  FROM viberacing_private.ranking_refresh_outbox AS outbox
  JOIN viberacing_private.seasons AS season
    ON season.season_start = outbox.season_start
    AND season.trust_tier = outbox.trust_tier
  WHERE outbox.trust_tier = 'community'
    AND outbox.state IN ('pending', 'retry')
    AND outbox.next_attempt_at <= v_now
    AND season.state IN ('open', 'grace')
  ORDER BY outbox.next_attempt_at, outbox.season_start
  FOR UPDATE OF outbox SKIP LOCKED
  LIMIT 1;

  IF v_outbox.season_start IS NULL THEN
    RETURN QUERY SELECT 'idle'::text, NULL::date, NULL::text;
    RETURN;
  END IF;

  UPDATE viberacing_private.seasons AS season
  SET state = 'grace'
  WHERE season.season_start = v_outbox.season_start
    AND season.trust_tier = 'community'
    AND season.state = 'open'
    AND v_now >= ((season.season_end + 1)::timestamp AT TIME ZONE 'UTC');

  BEGIN
    v_snapshot_id := viberacing_private.build_community_snapshot(
      v_outbox.season_start,
      false
    );
  EXCEPTION
    WHEN OTHERS THEN
      UPDATE viberacing_private.ranking_refresh_outbox AS outbox
      SET attempt_count = least(outbox.attempt_count + 1, 100),
          next_attempt_at = v_now + CASE
            WHEN outbox.attempt_count = 0 THEN interval '1 minute'
            WHEN outbox.attempt_count = 1 THEN interval '2 minutes'
            WHEN outbox.attempt_count = 2 THEN interval '5 minutes'
            WHEN outbox.attempt_count = 3 THEN interval '15 minutes'
            ELSE interval '1 hour'
          END,
          state = 'retry'
      WHERE outbox.season_start = v_outbox.season_start
        AND outbox.trust_tier = 'community';
      RETURN QUERY
      SELECT 'retry_scheduled'::text, v_outbox.season_start, NULL::text;
      RETURN;
  END;

  DELETE FROM viberacing_private.ranking_refresh_outbox AS outbox
  WHERE outbox.season_start = v_outbox.season_start
    AND outbox.trust_tier = 'community';
  UPDATE viberacing_private.seasons AS season
  SET refreshed_at = v_now
  WHERE season.season_start = v_outbox.season_start
    AND season.trust_tier = 'community'
    AND season.state IN ('open', 'grace');

  RETURN QUERY
  SELECT 'published'::text, v_outbox.season_start, v_snapshot_id;
END
$function$;

CREATE FUNCTION viberacing_api.finalize_next_due_community_season()
RETURNS TABLE (
  outcome text,
  season_start date,
  snapshot_id text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_season viberacing_private.seasons%ROWTYPE;
  v_snapshot_id text;
BEGIN
  PERFORM 1
  FROM viberacing_private.maintenance_mutexes
  WHERE capability = 'season_finalization'
  FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'busy'::text, NULL::date, NULL::text;
    RETURN;
  END IF;

  SELECT season.*
  INTO v_season
  FROM viberacing_private.seasons AS season
  WHERE season.trust_tier = 'community'
    AND season.state IN ('open', 'grace')
    AND season.grace_ends_at <= v_now
  ORDER BY season.season_start
  FOR UPDATE SKIP LOCKED
  LIMIT 1;
  IF v_season.season_start IS NULL THEN
    RETURN QUERY SELECT 'idle'::text, NULL::date, NULL::text;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM viberacing_private.ranking_refresh_outbox
    WHERE ranking_refresh_outbox.season_start = v_season.season_start
      AND trust_tier = 'community'
  ) THEN
    UPDATE viberacing_private.ranking_refresh_outbox AS outbox
    SET next_attempt_at = least(outbox.next_attempt_at, v_now),
        state = 'pending'
    WHERE outbox.season_start = v_season.season_start
      AND outbox.trust_tier = 'community';
    RETURN QUERY
    SELECT 'needs_refresh'::text, v_season.season_start, NULL::text;
    RETURN;
  END IF;

  BEGIN
    v_snapshot_id := viberacing_private.build_community_snapshot(
      v_season.season_start,
      true
    );
    UPDATE viberacing_private.seasons AS season
    SET state = 'finalized',
        refreshed_at = v_now,
        finalized_at = v_now
    WHERE season.season_start = v_season.season_start
      AND season.trust_tier = 'community'
      AND season.state IN ('open', 'grace');
    IF NOT FOUND THEN
      PERFORM viberacing_private.operation_failed();
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO viberacing_private.ranking_refresh_outbox (
        season_start,
        trust_tier,
        dirty_since,
        last_observation_id,
        attempt_count,
        next_attempt_at,
        state
      )
      VALUES (
        v_season.season_start,
        'community',
        v_now,
        NULL,
        1,
        v_now + interval '1 minute',
        'retry'
      )
      ON CONFLICT (season_start, trust_tier) DO UPDATE
      SET attempt_count = least(ranking_refresh_outbox.attempt_count + 1, 100),
          next_attempt_at = v_now + interval '1 minute',
          state = 'retry';
      RETURN QUERY
      SELECT 'retry_scheduled'::text, v_season.season_start, NULL::text;
      RETURN;
  END;

  RETURN QUERY
  SELECT 'finalized'::text, v_season.season_start, v_snapshot_id;
END
$function$;

CREATE FUNCTION viberacing_api.read_current_leaderboard_page(p_page integer)
RETURNS TABLE (
  canonical_payload text,
  payload_digest bytea,
  etag text,
  generated_at timestamptz,
  finalized boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT
    page.canonical_payload,
    page.payload_digest,
    snapshot.etag::text,
    snapshot.generated_at,
    snapshot.finalized
  FROM viberacing_private.leaderboard_published_snapshots AS published
  JOIN viberacing_private.leaderboard_snapshots AS snapshot
    ON snapshot.snapshot_id = published.snapshot_id
  JOIN viberacing_private.leaderboard_snapshot_pages AS page
    ON page.snapshot_id = published.snapshot_id
    AND page.page_kind = 'leaderboard_page'
    AND page.page_number = p_page
  WHERE published.season_start = (
      (pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::date
        - (
          extract(
            isodow FROM (pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::date
          )::integer - 1
        )
    )
    AND published.trust_tier = 'community'
    AND p_page BETWEEN 1 AND 10000
    AND snapshot.state = 'published'
  LIMIT 1
$function$;

CREATE FUNCTION viberacing_api.read_season_leaderboard_page(
  p_season_start date,
  p_page integer
)
RETURNS TABLE (
  canonical_payload text,
  payload_digest bytea,
  etag text,
  generated_at timestamptz,
  finalized boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT
    page.canonical_payload,
    page.payload_digest,
    snapshot.etag::text,
    snapshot.generated_at,
    snapshot.finalized
  FROM viberacing_private.leaderboard_published_snapshots AS published
  JOIN viberacing_private.leaderboard_snapshots AS snapshot
    ON snapshot.snapshot_id = published.snapshot_id
  JOIN viberacing_private.leaderboard_snapshot_pages AS page
    ON page.snapshot_id = published.snapshot_id
    AND page.page_kind = 'leaderboard_page'
    AND page.page_number = p_page
  WHERE published.season_start = p_season_start
    AND published.trust_tier = 'community'
    AND p_page BETWEEN 1 AND 10000
    AND extract(isodow FROM p_season_start) = 1
    AND snapshot.state = 'published'
  LIMIT 1
$function$;

CREATE FUNCTION viberacing_api.read_current_race_top32()
RETURNS TABLE (
  canonical_payload text,
  payload_digest bytea,
  etag text,
  generated_at timestamptz,
  finalized boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT
    page.canonical_payload,
    page.payload_digest,
    snapshot.etag::text,
    snapshot.generated_at,
    snapshot.finalized
  FROM viberacing_private.leaderboard_published_snapshots AS published
  JOIN viberacing_private.leaderboard_snapshots AS snapshot
    ON snapshot.snapshot_id = published.snapshot_id
  JOIN viberacing_private.leaderboard_snapshot_pages AS page
    ON page.snapshot_id = published.snapshot_id
    AND page.page_kind = 'race_top32'
    AND page.page_number = 1
  WHERE published.season_start = (
      (pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::date
        - (
          extract(
            isodow FROM (pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::date
          )::integer - 1
        )
    )
    AND published.trust_tier = 'community'
    AND snapshot.state = 'published'
  LIMIT 1
$function$;

CREATE FUNCTION viberacing_api.read_current_public_profile(p_handle text)
RETURNS TABLE (
  canonical_payload text,
  payload_digest bytea,
  etag text,
  generated_at timestamptz,
  finalized boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT
    profile.canonical_payload,
    profile.payload_digest,
    snapshot.etag::text,
    snapshot.generated_at,
    snapshot.finalized
  FROM viberacing_private.leaderboard_published_snapshots AS published
  JOIN viberacing_private.leaderboard_snapshots AS snapshot
    ON snapshot.snapshot_id = published.snapshot_id
  JOIN viberacing_private.leaderboard_snapshot_profiles AS profile
    ON profile.snapshot_id = published.snapshot_id
    AND profile.handle = p_handle
  WHERE published.season_start = (
      (pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::date
        - (
          extract(
            isodow FROM (pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::date
          )::integer - 1
        )
    )
    AND published.trust_tier = 'community'
    AND p_handle ~ '^[a-z0-9](?:[a-z0-9_-]{1,22}[a-z0-9])$'
    AND snapshot.state = 'published'
  LIMIT 1
$function$;

CREATE FUNCTION viberacing_api.read_season_public_profile(
  p_season_start date,
  p_handle text
)
RETURNS TABLE (
  canonical_payload text,
  payload_digest bytea,
  etag text,
  generated_at timestamptz,
  finalized boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT
    profile.canonical_payload,
    profile.payload_digest,
    snapshot.etag::text,
    snapshot.generated_at,
    snapshot.finalized
  FROM viberacing_private.leaderboard_published_snapshots AS published
  JOIN viberacing_private.leaderboard_snapshots AS snapshot
    ON snapshot.snapshot_id = published.snapshot_id
  JOIN viberacing_private.leaderboard_snapshot_profiles AS profile
    ON profile.snapshot_id = published.snapshot_id
    AND profile.handle = p_handle
  WHERE published.season_start = p_season_start
    AND published.trust_tier = 'community'
    AND extract(isodow FROM p_season_start) = 1
    AND p_handle ~ '^[a-z0-9](?:[a-z0-9_-]{1,22}[a-z0-9])$'
    AND snapshot.state = 'published'
  LIMIT 1
$function$;

ALTER TABLE viberacing_private.seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.seasons FORCE ROW LEVEL SECURITY;
CREATE POLICY seasons_owner_only ON viberacing_private.seasons
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

ALTER TABLE viberacing_private.season_profile_totals ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.season_profile_totals FORCE ROW LEVEL SECURITY;
CREATE POLICY season_profile_totals_owner_only
  ON viberacing_private.season_profile_totals
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

ALTER TABLE viberacing_private.season_profile_provider_totals ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.season_profile_provider_totals FORCE ROW LEVEL SECURITY;
CREATE POLICY season_profile_provider_totals_owner_only
  ON viberacing_private.season_profile_provider_totals
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

ALTER TABLE viberacing_private.leaderboard_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.leaderboard_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY leaderboard_snapshots_owner_only
  ON viberacing_private.leaderboard_snapshots
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

ALTER TABLE viberacing_private.leaderboard_snapshot_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.leaderboard_snapshot_pages FORCE ROW LEVEL SECURITY;
CREATE POLICY leaderboard_snapshot_pages_owner_only
  ON viberacing_private.leaderboard_snapshot_pages
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

ALTER TABLE viberacing_private.leaderboard_snapshot_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.leaderboard_snapshot_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY leaderboard_snapshot_profiles_owner_only
  ON viberacing_private.leaderboard_snapshot_profiles
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

ALTER TABLE viberacing_private.leaderboard_published_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.leaderboard_published_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY leaderboard_published_snapshots_owner_only
  ON viberacing_private.leaderboard_published_snapshots
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

ALTER TABLE viberacing_private.maintenance_mutexes ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.maintenance_mutexes FORCE ROW LEVEL SECURITY;
CREATE POLICY maintenance_mutexes_owner_only
  ON viberacing_private.maintenance_mutexes
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

REVOKE ALL ON ALL TABLES IN SCHEMA viberacing_private FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA viberacing_private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA viberacing_private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA viberacing_api FROM PUBLIC;

GRANT EXECUTE ON FUNCTION viberacing_api.ensure_current_community_season()
  TO viberacing_jobs;
GRANT EXECUTE ON FUNCTION viberacing_api.refresh_next_dirty_community_season()
  TO viberacing_jobs;
GRANT EXECUTE ON FUNCTION viberacing_api.finalize_next_due_community_season()
  TO viberacing_jobs;

GRANT EXECUTE ON FUNCTION viberacing_api.read_current_leaderboard_page(integer)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.read_season_leaderboard_page(date, integer)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.read_current_race_top32()
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.read_current_public_profile(text)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.read_season_public_profile(date, text)
  TO viberacing_web;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (5, 'seasons_ranking_and_snapshots');

COMMIT;
