\set ON_ERROR_STOP on

BEGIN;

SET LOCAL ROLE viberacing_owner;

CREATE FUNCTION pg_temp.profile_uuid(p_index integer)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
STRICT
AS $function$
  SELECT (
    '60000000-0000-4000-8000-' || pg_catalog.lpad(p_index::text, 12, '0')
  )::uuid
$function$;

CREATE FUNCTION pg_temp.entity_suffix(p_index integer, p_padding text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $function$
  SELECT pg_catalog.lpad(p_index::text, 22, p_padding)
$function$;

CREATE FUNCTION pg_temp.create_rank_profile(
  p_index integer,
  p_handle text,
  p_public boolean,
  p_breakdown_visible boolean
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  INSERT INTO viberacing_private.profiles (
    profile_id,
    github_user_id,
    handle,
    locale,
    provider_breakdown_visible,
    hidden_at
  )
  VALUES (
    pg_temp.profile_uuid(p_index),
    950000000000000 + p_index,
    p_handle,
    'en',
    p_breakdown_visible,
    pg_catalog.transaction_timestamp()
  );

  UPDATE viberacing_private.profiles
  SET state = 'active',
      public_visibility = CASE WHEN p_public THEN 'public' ELSE 'hidden' END
  WHERE profile_id = pg_temp.profile_uuid(p_index);
END
$function$;

CREATE FUNCTION pg_temp.create_rank_account(
  p_account_index integer,
  p_profile_index integer,
  p_provider_code text,
  p_entry_count integer,
  p_season_starts date[]
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_account_suffix text := pg_temp.entity_suffix(p_account_index, 'A');
  v_device_suffix text := pg_temp.entity_suffix(p_account_index, 'D');
  v_installation_suffix text := pg_temp.entity_suffix(p_account_index, 'I');
  v_observation_suffix text := pg_temp.entity_suffix(p_account_index, 'O');
  v_sync_suffix text := pg_temp.entity_suffix(p_account_index, 'S');
BEGIN
  INSERT INTO viberacing_private.agent_accounts (
    agent_account_id,
    profile_id,
    provider_code,
    accounting_revision,
    scope_kind,
    fingerprint_kind,
    account_fingerprint_digest,
    private_label,
    identity_assurance
  )
  VALUES (
    'acc_' || v_account_suffix,
    pg_temp.profile_uuid(p_profile_index),
    p_provider_code,
    1,
    'agent_account',
    'stable_opaque',
    pg_catalog.sha256(
      pg_catalog.convert_to('account:' || p_account_index::text, 'UTF8')
    ),
    'Ranking fixture ' || p_account_index::text,
    'community_local'
  );

  INSERT INTO viberacing_private.connector_installations (
    installation_id,
    profile_id,
    installation_public_key,
    label,
    connector_version,
    os_family,
    architecture,
    state,
    activated_at,
    last_seen_at
  )
  VALUES (
    'ins_' || v_installation_suffix,
    pg_temp.profile_uuid(p_profile_index),
    pg_catalog.sha256(
      pg_catalog.convert_to('installation:' || p_account_index::text, 'UTF8')
    ),
    'Ranking fixture ' || p_account_index::text,
    '0.0.0',
    'linux',
    'x86_64',
    'active',
    pg_catalog.transaction_timestamp(),
    pg_catalog.transaction_timestamp()
  );

  INSERT INTO viberacing_private.device_keys (
    device_key_id,
    device_id,
    profile_id,
    installation_id,
    agent_account_id,
    public_key
  )
  VALUES (
    'key_' || v_device_suffix,
    'dev_' || v_device_suffix,
    pg_temp.profile_uuid(p_profile_index),
    'ins_' || v_installation_suffix,
    'acc_' || v_account_suffix,
    pg_catalog.sha256(
      pg_catalog.convert_to('device:' || p_account_index::text, 'UTF8')
    )
  );

  INSERT INTO viberacing_private.usage_observations (
    observation_id,
    device_key_id,
    device_id,
    installation_id,
    agent_account_id,
    sync_id,
    observed_at,
    body_digest,
    signature,
    device_nonce_digest,
    origin_nonce_digest,
    reader_version,
    client_version,
    outcome,
    entry_count,
    accepted_entry_count,
    season_starts,
    retention_expires_at
  )
  VALUES (
    'obs_' || v_observation_suffix,
    'key_' || v_device_suffix,
    'dev_' || v_device_suffix,
    'ins_' || v_installation_suffix,
    'acc_' || v_account_suffix,
    'syn_' || v_sync_suffix,
    pg_catalog.transaction_timestamp(),
    pg_catalog.sha256(
      pg_catalog.convert_to('body:' || p_account_index::text, 'UTF8')
    ),
    pg_catalog.decode(pg_catalog.repeat('ab', 64), 'hex'),
    pg_catalog.sha256(
      pg_catalog.convert_to('device-nonce:' || p_account_index::text, 'UTF8')
    ),
    pg_catalog.sha256(
      pg_catalog.convert_to('origin-nonce:' || p_account_index::text, 'UTF8')
    ),
    p_provider_code || '_fixture_v1',
    '0.0.0',
    'accepted',
    p_entry_count,
    p_entry_count,
    p_season_starts,
    pg_catalog.transaction_timestamp() + interval '45 days'
  );
END
$function$;

CREATE FUNCTION pg_temp.add_rank_days(
  p_account_index integer,
  p_season_start date,
  p_daily_total numeric,
  p_day_count integer
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_account_suffix text := pg_temp.entity_suffix(p_account_index, 'A');
  v_device_suffix text := pg_temp.entity_suffix(p_account_index, 'D');
  v_observation_suffix text := pg_temp.entity_suffix(p_account_index, 'O');
  v_sync_suffix text := pg_temp.entity_suffix(p_account_index, 'S');
BEGIN
  INSERT INTO viberacing_private.agent_account_day_totals (
    agent_account_id,
    usage_date,
    cumulative_token_total,
    accepted_observation_id,
    accepted_sync_id,
    accepted_device_id,
    first_accepted_at,
    last_accepted_at
  )
  SELECT
    'acc_' || v_account_suffix,
    p_season_start + generated.day_offset,
    p_daily_total,
    'obs_' || v_observation_suffix,
    'syn_' || v_sync_suffix,
    'dev_' || v_device_suffix,
    pg_catalog.transaction_timestamp(),
    pg_catalog.transaction_timestamp()
  FROM pg_catalog.generate_series(0, p_day_count - 1) AS generated(day_offset);
END
$function$;

DO $fixture$
DECLARE
  v_current_season date := (pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::date
    - (
      extract(
        isodow FROM (pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::date
      )::integer - 1
    );
  v_rank_season date;
  v_index integer;
BEGIN
  v_rank_season := v_current_season - 21;

  INSERT INTO viberacing_private.seasons (
    season_start,
    trust_tier,
    season_end,
    metric_version,
    accounting_policy_version,
    state,
    opened_at,
    grace_ends_at
  )
  VALUES
    (
      v_current_season,
      'community',
      v_current_season + 6,
      'provider_reported_tokens_v1',
      'agent_account_cumulative_utc_v1',
      'open',
      v_current_season::timestamp AT TIME ZONE 'UTC',
      ((v_current_season + 7)::timestamp AT TIME ZONE 'UTC') + interval '48 hours'
    ),
    (
      v_rank_season,
      'community',
      v_rank_season + 6,
      'provider_reported_tokens_v1',
      'agent_account_cumulative_utc_v1',
      'grace',
      v_rank_season::timestamp AT TIME ZONE 'UTC',
      ((v_rank_season + 7)::timestamp AT TIME ZONE 'UTC') + interval '48 hours'
    );

  UPDATE viberacing_private.agent_providers
  SET state = 'supported'
  WHERE provider_code IN ('codex', 'claude_code');

  UPDATE viberacing_private.agent_accounting_revisions
  SET enabled_for_new_accounts = true
  WHERE provider_code = 'codex'
    AND accounting_revision = 1;

  INSERT INTO viberacing_private.agent_accounting_revisions (
    provider_code,
    accounting_revision,
    reader_contract_version,
    scope_kind,
    utc_date_semantics,
    maximum_backfill_days,
    minimum_connector_version,
    enabled_for_new_accounts
  )
  VALUES (
    'claude_code',
    1,
    'claude_code_fixture_v1',
    'agent_account',
    'provider_utc_date',
    35,
    '0.0.0',
    true
  );

  PERFORM pg_temp.create_rank_profile(1, 'rank-alpha', true, true);
  PERFORM pg_temp.create_rank_profile(2, 'rank-beta', true, false);
  PERFORM pg_temp.create_rank_profile(3, 'rank-hidden', false, true);
  PERFORM pg_temp.create_rank_profile(4, 'rank-delta', true, false);

  FOR v_index IN 100..304 LOOP
    PERFORM pg_temp.create_rank_profile(
      v_index,
      'racer-' || v_index::text,
      true,
      false
    );
  END LOOP;

  PERFORM pg_temp.create_rank_account(
    1,
    1,
    'codex',
    8,
    ARRAY[v_current_season, v_rank_season]
  );
  PERFORM pg_temp.create_rank_account(
    2,
    1,
    'codex',
    8,
    ARRAY[v_current_season, v_rank_season]
  );
  PERFORM pg_temp.create_rank_account(
    3,
    1,
    'claude_code',
    8,
    ARRAY[v_current_season, v_rank_season]
  );
  PERFORM pg_temp.create_rank_account(
    4,
    2,
    'codex',
    2,
    ARRAY[v_current_season, v_rank_season]
  );
  PERFORM pg_temp.create_rank_account(
    5,
    3,
    'codex',
    2,
    ARRAY[v_current_season, v_rank_season]
  );
  PERFORM pg_temp.create_rank_account(
    6,
    4,
    'codex',
    2,
    ARRAY[v_current_season, v_rank_season]
  );

  PERFORM pg_temp.add_rank_days(1, v_rank_season, 10, 7);
  PERFORM pg_temp.add_rank_days(2, v_rank_season, 20, 7);
  PERFORM pg_temp.add_rank_days(3, v_rank_season, 30, 7);
  PERFORM pg_temp.add_rank_days(4, v_rank_season, 420, 1);
  PERFORM pg_temp.add_rank_days(5, v_rank_season, 999, 1);
  PERFORM pg_temp.add_rank_days(6, v_rank_season, 50, 1);

  PERFORM pg_temp.add_rank_days(1, v_current_season, 70, 1);
  PERFORM pg_temp.add_rank_days(2, v_current_season, 140, 1);
  PERFORM pg_temp.add_rank_days(3, v_current_season, 210, 1);
  PERFORM pg_temp.add_rank_days(4, v_current_season, 420, 1);
  PERFORM pg_temp.add_rank_days(5, v_current_season, 999, 1);
  PERFORM pg_temp.add_rank_days(6, v_current_season, 50, 1);

  FOR v_index IN 100..304 LOOP
    PERFORM pg_temp.create_rank_account(
      900 + v_index,
      v_index,
      'codex',
      1,
      ARRAY[v_current_season]
    );
    PERFORM pg_temp.add_rank_days(
      900 + v_index,
      v_current_season,
      10000 - v_index,
      1
    );
  END LOOP;

  UPDATE viberacing_private.agent_accounts
  SET state = 'paused',
      state_changed_at = pg_catalog.clock_timestamp()
  WHERE agent_account_id = 'acc_' || pg_temp.entity_suffix(2, 'A');

  UPDATE viberacing_private.agent_accounts
  SET state = 'unlinked',
      state_changed_at = pg_catalog.clock_timestamp(),
      unlinked_at = pg_catalog.clock_timestamp()
  WHERE agent_account_id = 'acc_' || pg_temp.entity_suffix(3, 'A');

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
    v_rank_season,
    'community',
    pg_catalog.clock_timestamp(),
    'obs_' || pg_temp.entity_suffix(1, 'O'),
    0,
    pg_catalog.clock_timestamp(),
    'pending'
  );
END
$fixture$;

SET LOCAL ROLE viberacing_jobs;
SELECT viberacing_api.ensure_current_community_season();
SELECT * FROM viberacing_api.refresh_next_dirty_community_season();
SELECT * FROM viberacing_api.refresh_next_dirty_community_season();
RESET ROLE;

DO $ranking_assertion$
DECLARE
  v_alpha_rank bigint;
  v_beta_rank bigint;
  v_current_season date := (pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::date
    - (
      extract(
        isodow FROM (pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::date
      )::integer - 1
    );
  v_current_snapshot text;
  v_expected_handles text[];
  v_hidden_rank bigint;
  v_page_handles text[];
  v_rank_season date;
  v_rank_snapshot text;
BEGIN
  v_rank_season := v_current_season - 21;

  SELECT published.snapshot_id
  INTO v_current_snapshot
  FROM viberacing_private.leaderboard_published_snapshots AS published
  WHERE published.season_start = v_current_season
    AND published.trust_tier = 'community';
  SELECT published.snapshot_id
  INTO v_rank_snapshot
  FROM viberacing_private.leaderboard_published_snapshots AS published
  WHERE published.season_start = v_rank_season
    AND published.trust_tier = 'community';

  IF v_current_snapshot IS NULL OR v_rank_snapshot IS NULL THEN
    RAISE EXCEPTION 'expected both current and historical snapshots';
  END IF;

  IF (
    SELECT weekly_token_total::text
    FROM viberacing_private.season_profile_totals
    WHERE season_start = v_rank_season
      AND trust_tier = 'community'
      AND profile_id = pg_temp.profile_uuid(1)
  ) <> '420' OR (
    SELECT weekly_token_total::text
    FROM viberacing_private.season_profile_totals
    WHERE season_start = v_rank_season
      AND trust_tier = 'community'
      AND profile_id = pg_temp.profile_uuid(2)
  ) <> '420' THEN
    RAISE EXCEPTION 'seven-day multi-account direct-token sum is incorrect';
  END IF;

  SELECT rank_position
  INTO v_alpha_rank
  FROM viberacing_private.season_profile_totals
  WHERE season_start = v_rank_season
    AND trust_tier = 'community'
    AND profile_id = pg_temp.profile_uuid(1);
  SELECT rank_position
  INTO v_beta_rank
  FROM viberacing_private.season_profile_totals
  WHERE season_start = v_rank_season
    AND trust_tier = 'community'
    AND profile_id = pg_temp.profile_uuid(2);
  SELECT rank_position
  INTO v_hidden_rank
  FROM viberacing_private.season_profile_totals
  WHERE season_start = v_rank_season
    AND trust_tier = 'community'
    AND profile_id = pg_temp.profile_uuid(3);

  IF v_alpha_rank <> 1 OR v_beta_rank <> 1 OR v_hidden_rank IS NOT NULL THEN
    RAISE EXCEPTION 'shared rank or hidden rank semantics are incorrect';
  END IF;
  IF (
    SELECT display_position
    FROM viberacing_private.season_profile_totals
    WHERE season_start = v_rank_season
      AND trust_tier = 'community'
      AND profile_id = pg_temp.profile_uuid(1)
  ) <> 1 OR (
    SELECT display_position
    FROM viberacing_private.season_profile_totals
    WHERE season_start = v_rank_season
      AND trust_tier = 'community'
      AND profile_id = pg_temp.profile_uuid(2)
  ) <> 2 THEN
    RAISE EXCEPTION 'stable display order is incorrect';
  END IF;

  IF (
    SELECT weekly_token_total::text
    FROM viberacing_private.season_profile_totals
    WHERE season_start = v_rank_season
      AND trust_tier = 'community'
      AND profile_id = pg_temp.profile_uuid(3)
  ) <> '999' THEN
    RAISE EXCEPTION 'hidden private total was not retained';
  END IF;

  IF (
    SELECT pg_catalog.jsonb_object_agg(
      provider_code,
      pg_catalog.jsonb_build_array(provider_token_total::text, percentage)
    )
    FROM viberacing_private.season_profile_provider_totals
    WHERE season_start = v_rank_season
      AND trust_tier = 'community'
      AND profile_id = pg_temp.profile_uuid(1)
  ) <> '{"claude_code":["210",50],"codex":["210",50]}'::jsonb THEN
    RAISE EXCEPTION 'provider totals or percentages are incorrect';
  END IF;

  IF (
    SELECT participant_count
    FROM viberacing_private.leaderboard_snapshots
    WHERE snapshot_id = v_current_snapshot
  ) <> 208 OR (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.leaderboard_snapshot_pages
    WHERE snapshot_id = v_current_snapshot
      AND page_kind = 'leaderboard_page'
  ) <> 3 OR (
    SELECT pg_catalog.sum(participant_count)
    FROM viberacing_private.leaderboard_snapshot_pages
    WHERE snapshot_id = v_current_snapshot
      AND page_kind = 'leaderboard_page'
  ) <> 208 THEN
    RAISE EXCEPTION 'current snapshot pagination inventory is incorrect';
  END IF;

  SELECT pg_catalog.array_agg(profile.handle ORDER BY totals.display_position)
  INTO v_expected_handles
  FROM viberacing_private.season_profile_totals AS totals
  JOIN viberacing_private.profiles AS profile
    ON profile.profile_id = totals.profile_id
  WHERE totals.season_start = v_current_season
    AND totals.trust_tier = 'community'
    AND totals.display_position BETWEEN 1 AND 32;

  SELECT pg_catalog.array_agg(participant.value ->> 'handle' ORDER BY participant.ordinality)
  INTO v_page_handles
  FROM viberacing_private.leaderboard_snapshot_pages AS page
  CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
    page.canonical_payload::jsonb -> 'participants'
  )
    WITH ORDINALITY AS participant(value, ordinality)
  WHERE page.snapshot_id = v_current_snapshot
    AND page.page_kind = 'race_top32'
    AND page.page_number = 1;

  IF v_page_handles IS DISTINCT FROM v_expected_handles THEN
    RAISE EXCEPTION 'top32 payload differs from ranked display order';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM viberacing_private.leaderboard_snapshot_pages AS page
    WHERE page.snapshot_id IN (v_current_snapshot, v_rank_snapshot)
      AND page.canonical_payload::jsonb @? '$.participants[*] ? (@.handle == "rank-hidden")'
  ) OR EXISTS (
    SELECT 1
    FROM viberacing_private.leaderboard_snapshot_profiles
    WHERE snapshot_id IN (v_current_snapshot, v_rank_snapshot)
      AND handle = 'rank-hidden'
  ) THEN
    RAISE EXCEPTION 'hidden profile leaked into a public snapshot';
  END IF;

  IF NOT (
    SELECT canonical_payload::jsonb ? 'providerBreakdown'
    FROM viberacing_private.leaderboard_snapshot_profiles
    WHERE snapshot_id = v_current_snapshot
      AND handle = 'rank-alpha'
  ) OR (
    SELECT canonical_payload::jsonb ? 'providerBreakdown'
    FROM viberacing_private.leaderboard_snapshot_profiles
    WHERE snapshot_id = v_current_snapshot
      AND handle = 'rank-beta'
  ) THEN
    RAISE EXCEPTION 'provider-breakdown opt-in was not respected';
  END IF;

  IF (
    SELECT (canonical_payload::jsonb ->> 'rankPosition')::bigint
    FROM viberacing_private.leaderboard_snapshot_profiles
    WHERE snapshot_id = v_current_snapshot
      AND handle = 'rank-alpha'
  ) <= 32 THEN
    RAISE EXCEPTION 'profile-summary outside top32 fixture is not outside top32';
  END IF;

  CREATE TEMP TABLE snapshot_before_failure (
    season_start date PRIMARY KEY,
    snapshot_id text NOT NULL,
    payload_digest bytea NOT NULL,
    canonical_payload text NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO snapshot_before_failure
  SELECT
    published.season_start,
    published.snapshot_id,
    page.payload_digest,
    page.canonical_payload
  FROM viberacing_private.leaderboard_published_snapshots AS published
  JOIN viberacing_private.leaderboard_snapshot_pages AS page
    ON page.snapshot_id = published.snapshot_id
    AND page.page_kind = 'leaderboard_page'
    AND page.page_number = 1
  WHERE published.season_start IN (v_current_season, v_rank_season)
    AND published.trust_tier = 'community';
END
$ranking_assertion$;

SET LOCAL ROLE viberacing_web;
SELECT * FROM viberacing_api.read_current_leaderboard_page(1);
SELECT * FROM viberacing_api.read_current_race_top32();
SELECT * FROM viberacing_api.read_current_public_profile('rank-alpha');
SELECT * FROM viberacing_api.read_season_leaderboard_page(
  (
    (pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::date
      - (
        extract(
          isodow FROM (pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::date
        )::integer - 1
      )
      - 21
  ),
  1
);
SELECT * FROM viberacing_api.read_season_public_profile(
  (
    (pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::date
      - (
        extract(
          isodow FROM (pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::date
        )::integer - 1
      )
      - 21
  ),
  'rank-alpha'
);
RESET ROLE;

UPDATE viberacing_private.profiles
SET public_visibility = 'hidden'
WHERE profile_id = pg_temp.profile_uuid(2);

DO $dirty_assertion$
DECLARE
  v_current_season date := (pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::date
    - (
      extract(
        isodow FROM (pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::date
      )::integer - 1
    );
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.ranking_refresh_outbox
    WHERE season_start IN (v_current_season, v_current_season - 21)
      AND trust_tier = 'community'
      AND state = 'pending'
  ) <> 2 THEN
    RAISE EXCEPTION 'profile visibility did not coalesce both affected seasons';
  END IF;
END
$dirty_assertion$;

CREATE FUNCTION pg_temp.reject_snapshot_page_insert()
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

CREATE TRIGGER reject_snapshot_page_insert_fixture
BEFORE INSERT ON viberacing_private.leaderboard_snapshot_pages
FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_snapshot_page_insert();

SET LOCAL ROLE viberacing_jobs;
SELECT * FROM viberacing_api.refresh_next_dirty_community_season();
RESET ROLE;

DO $failed_refresh_assertion$
DECLARE
  v_rank_season date := (
    (pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::date
      - (
        extract(
          isodow FROM (pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::date
        )::integer - 1
      )
      - 21
  );
BEGIN
  IF (
    SELECT published.snapshot_id
    FROM viberacing_private.leaderboard_published_snapshots AS published
    WHERE published.season_start = v_rank_season
      AND published.trust_tier = 'community'
  ) <> (
    SELECT snapshot_id
    FROM snapshot_before_failure
    WHERE season_start = v_rank_season
  ) OR (
    SELECT state
    FROM viberacing_private.ranking_refresh_outbox
    WHERE season_start = v_rank_season
      AND trust_tier = 'community'
  ) <> 'retry' OR EXISTS (
    SELECT 1
    FROM viberacing_private.leaderboard_snapshots
    WHERE state = 'building'
  ) THEN
    RAISE EXCEPTION 'failed refresh changed last-good or exposed partial state';
  END IF;

  IF (
    SELECT page.canonical_payload
    FROM viberacing_private.leaderboard_published_snapshots AS published
    JOIN viberacing_private.leaderboard_snapshot_pages AS page
      ON page.snapshot_id = published.snapshot_id
      AND page.page_kind = 'leaderboard_page'
      AND page.page_number = 1
    WHERE published.season_start = v_rank_season
      AND published.trust_tier = 'community'
  ) <> (
    SELECT canonical_payload
    FROM snapshot_before_failure
    WHERE season_start = v_rank_season
  ) THEN
    RAISE EXCEPTION 'failed refresh did not retain exact last-good payload';
  END IF;

  UPDATE viberacing_private.ranking_refresh_outbox
  SET next_attempt_at = greatest(dirty_since, pg_catalog.clock_timestamp())
  WHERE season_start = v_rank_season
    AND trust_tier = 'community';
END
$failed_refresh_assertion$;

DROP TRIGGER reject_snapshot_page_insert_fixture
  ON viberacing_private.leaderboard_snapshot_pages;

SET LOCAL ROLE viberacing_jobs;
SELECT * FROM viberacing_api.refresh_next_dirty_community_season();
SELECT * FROM viberacing_api.refresh_next_dirty_community_season();
RESET ROLE;

DO $hidden_republish_assertion$
DECLARE
  v_current_season date := (pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::date
    - (
      extract(
        isodow FROM (pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::date
      )::integer - 1
    );
  v_rank_season date;
BEGIN
  v_rank_season := v_current_season - 21;

  IF EXISTS (
    SELECT 1
    FROM viberacing_private.leaderboard_snapshot_profiles AS profile
    JOIN viberacing_private.leaderboard_published_snapshots AS published
      ON published.snapshot_id = profile.snapshot_id
    WHERE published.season_start IN (v_current_season, v_rank_season)
      AND published.trust_tier = 'community'
      AND profile.handle = 'rank-beta'
  ) THEN
    RAISE EXCEPTION 'hidden profile remained in republished snapshot';
  END IF;

  IF (
    SELECT weekly_token_total::text
    FROM viberacing_private.season_profile_totals
    WHERE season_start = v_rank_season
      AND trust_tier = 'community'
      AND profile_id = pg_temp.profile_uuid(2)
  ) <> '420' OR (
    SELECT rank_position
    FROM viberacing_private.season_profile_totals
    WHERE season_start = v_rank_season
      AND trust_tier = 'community'
      AND profile_id = pg_temp.profile_uuid(2)
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'hide changed private total or retained public rank';
  END IF;

  IF (
    SELECT revision
    FROM viberacing_private.leaderboard_snapshots AS snapshot
    JOIN viberacing_private.leaderboard_published_snapshots AS published
      ON published.snapshot_id = snapshot.snapshot_id
    WHERE published.season_start = v_rank_season
      AND published.trust_tier = 'community'
  ) <> 2 OR (
    SELECT state
    FROM viberacing_private.leaderboard_snapshots
    WHERE snapshot_id = (
      SELECT snapshot_id
      FROM snapshot_before_failure
      WHERE season_start = v_rank_season
    )
  ) <> 'superseded' THEN
    RAISE EXCEPTION 'snapshot revision or supersession is incorrect after retry';
  END IF;

  IF (
    SELECT canonical_payload
    FROM viberacing_private.leaderboard_snapshot_pages
    WHERE snapshot_id = (
        SELECT snapshot_id
        FROM snapshot_before_failure
        WHERE season_start = v_rank_season
      )
      AND page_kind = 'leaderboard_page'
      AND page_number = 1
  ) <> (
    SELECT canonical_payload
    FROM snapshot_before_failure
    WHERE season_start = v_rank_season
  ) THEN
    RAISE EXCEPTION 'superseded snapshot payload changed';
  END IF;
END
$hidden_republish_assertion$;

UPDATE viberacing_private.profiles
SET public_visibility = 'public'
WHERE profile_id = pg_temp.profile_uuid(2);

SET LOCAL ROLE viberacing_jobs;
SELECT * FROM viberacing_api.refresh_next_dirty_community_season();
SELECT * FROM viberacing_api.refresh_next_dirty_community_season();
RESET ROLE;

DO $show_republish_assertion$
DECLARE
  v_current_season date := (pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::date
    - (
      extract(
        isodow FROM (pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::date
      )::integer - 1
    );
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.leaderboard_snapshot_profiles AS profile
    JOIN viberacing_private.leaderboard_published_snapshots AS published
      ON published.snapshot_id = profile.snapshot_id
    WHERE published.season_start IN (v_current_season, v_current_season - 21)
      AND published.trust_tier = 'community'
      AND profile.handle = 'rank-beta'
  ) <> 2 THEN
    RAISE EXCEPTION 'show did not restore profile to both next snapshots';
  END IF;
END
$show_republish_assertion$;

SET LOCAL ROLE viberacing_jobs;
SELECT * FROM viberacing_api.finalize_next_due_community_season();
RESET ROLE;

DO $finalization_assertion$
DECLARE
  v_before_counts bigint[];
  v_before_total text;
  v_final_snapshot text;
  v_rank_season date := (
    (pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::date
      - (
        extract(
          isodow FROM (pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::date
        )::integer - 1
      )
      - 21
  );
BEGIN
  SELECT published.snapshot_id
  INTO v_final_snapshot
  FROM viberacing_private.leaderboard_published_snapshots AS published
  WHERE published.season_start = v_rank_season
    AND published.trust_tier = 'community';

  IF (
    SELECT state
    FROM viberacing_private.seasons
    WHERE season_start = v_rank_season
      AND trust_tier = 'community'
  ) <> 'finalized' OR NOT (
    SELECT finalized
    FROM viberacing_private.leaderboard_snapshots
    WHERE snapshot_id = v_final_snapshot
  ) OR (
    SELECT canonical_payload::jsonb ->> 'seasonState'
    FROM viberacing_private.leaderboard_snapshot_pages
    WHERE snapshot_id = v_final_snapshot
      AND page_kind = 'leaderboard_page'
      AND page_number = 1
  ) <> 'finalized' THEN
    RAISE EXCEPTION 'season finalization did not publish an exact final snapshot';
  END IF;

  SELECT cumulative_token_total::text
  INTO v_before_total
  FROM viberacing_private.agent_account_day_totals
  WHERE agent_account_id = 'acc_' || pg_temp.entity_suffix(1, 'A')
    AND usage_date = v_rank_season;

  v_before_counts := ARRAY[
    (SELECT pg_catalog.count(*) FROM viberacing_private.origin_nonces),
    (SELECT pg_catalog.count(*) FROM viberacing_private.device_nonces),
    (SELECT pg_catalog.count(*) FROM viberacing_private.usage_idempotency_records),
    (SELECT pg_catalog.count(*) FROM viberacing_private.usage_observations),
    (SELECT pg_catalog.count(*) FROM viberacing_private.ranking_events)
  ];

  BEGIN
    PERFORM *
    FROM viberacing_api.submit_usage_sync(
      'obs_' || pg_catalog.repeat('Z', 22),
      'evt_' || pg_catalog.repeat('Z', 22),
      'edge_test',
      pg_catalog.sha256(pg_catalog.convert_to('finalized-origin', 'UTF8')),
      pg_catalog.transaction_timestamp() + interval '30 seconds',
      'key_' || pg_temp.entity_suffix(1, 'D'),
      'dev_' || pg_temp.entity_suffix(1, 'D'),
      'acc_' || pg_temp.entity_suffix(1, 'A'),
      'syn_' || pg_catalog.repeat('Z', 22),
      pg_catalog.transaction_timestamp(),
      '0.0.0',
      'codex_app_server_0_144_5_v1',
      pg_catalog.sha256(pg_catalog.convert_to('finalized-body', 'UTF8')),
      pg_catalog.decode(pg_catalog.repeat('cd', 64), 'hex'),
      pg_catalog.sha256(pg_catalog.convert_to('finalized-device-nonce', 'UTF8')),
      ARRAY[v_rank_season],
      ARRAY['11']
    );
    RAISE EXCEPTION 'finalized season usage submission unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  IF v_before_counts <> ARRAY[
    (SELECT pg_catalog.count(*) FROM viberacing_private.origin_nonces),
    (SELECT pg_catalog.count(*) FROM viberacing_private.device_nonces),
    (SELECT pg_catalog.count(*) FROM viberacing_private.usage_idempotency_records),
    (SELECT pg_catalog.count(*) FROM viberacing_private.usage_observations),
    (SELECT pg_catalog.count(*) FROM viberacing_private.ranking_events)
  ] THEN
    RAISE EXCEPTION 'finalized season usage rejection left partial state';
  END IF;

  BEGIN
    UPDATE viberacing_private.agent_account_day_totals
    SET cumulative_token_total = cumulative_token_total + 1
    WHERE agent_account_id = 'acc_' || pg_temp.entity_suffix(1, 'A')
      AND usage_date = v_rank_season;
    RAISE EXCEPTION 'finalized season direct usage mutation unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  IF (
    SELECT cumulative_token_total::text
    FROM viberacing_private.agent_account_day_totals
    WHERE agent_account_id = 'acc_' || pg_temp.entity_suffix(1, 'A')
      AND usage_date = v_rank_season
  ) <> v_before_total THEN
    RAISE EXCEPTION 'failed finalized mutation changed accepted history';
  END IF;

  BEGIN
    UPDATE viberacing_private.leaderboard_snapshot_pages
    SET canonical_payload = canonical_payload || ' '
    WHERE snapshot_id = v_final_snapshot
      AND page_kind = 'leaderboard_page'
      AND page_number = 1;
    RAISE EXCEPTION 'finalized snapshot payload mutation unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  BEGIN
    INSERT INTO viberacing_private.leaderboard_snapshot_pages (
      snapshot_id,
      page_kind,
      page_number,
      participant_count,
      canonical_payload,
      payload_digest
    )
    VALUES (
      v_final_snapshot,
      'leaderboard_page',
      9999,
      0,
      '{}',
      pg_catalog.sha256(pg_catalog.convert_to('{}', 'UTF8'))
    );
    RAISE EXCEPTION 'late finalized snapshot payload insert unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  BEGIN
    DELETE FROM viberacing_private.leaderboard_snapshot_pages
    WHERE snapshot_id = v_final_snapshot
      AND page_kind = 'race_top32'
      AND page_number = 1;
    RAISE EXCEPTION 'finalized snapshot payload deletion unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  BEGIN
    DELETE FROM viberacing_private.leaderboard_snapshots
    WHERE snapshot_id = v_final_snapshot;
    RAISE EXCEPTION 'finalized snapshot deletion unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  BEGIN
    UPDATE viberacing_private.season_profile_totals
    SET weekly_token_total = weekly_token_total + 1
    WHERE season_start = v_rank_season
      AND trust_tier = 'community'
      AND profile_id = pg_temp.profile_uuid(1);
    RAISE EXCEPTION 'finalized derived total mutation unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  IF EXISTS (
    SELECT 1
    FROM viberacing_private.ranking_refresh_outbox
    WHERE season_start = v_rank_season
      AND trust_tier = 'community'
  ) THEN
    RAISE EXCEPTION 'finalized season retained dirty work';
  END IF;
END
$finalization_assertion$;

DO $grant_assertion$
BEGIN
  IF NOT pg_catalog.has_function_privilege(
    'viberacing_jobs',
    'viberacing_api.ensure_current_community_season()',
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'viberacing_jobs',
    'viberacing_api.refresh_next_dirty_community_season()',
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'viberacing_jobs',
    'viberacing_api.finalize_next_due_community_season()',
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'viberacing_web',
    'viberacing_api.read_current_leaderboard_page(integer)',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'viberacing_ingest',
    'viberacing_api.read_current_leaderboard_page(integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'snapshot capability grants are not least privileged';
  END IF;
END
$grant_assertion$;

COMMIT;
