\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824762001);

ALTER TABLE viberacing_private.device_keys
  ADD CONSTRAINT device_keys_verification_binding_unique
  UNIQUE (device_key_id, device_id, installation_id, agent_account_id);

CREATE TABLE viberacing_private.origin_nonces (
  nonce_digest bytea PRIMARY KEY,
  origin_key_id varchar(27) NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT origin_nonces_digest_exact
    CHECK (pg_catalog.octet_length(nonce_digest) = 32),
  CONSTRAINT origin_nonces_key_id_canonical
    CHECK (origin_key_id ~ '^edge_[A-Za-z0-9_-]{1,22}$'),
  CONSTRAINT origin_nonces_time_bounded CHECK (
    expires_at > consumed_at
    AND expires_at <= consumed_at + interval '65 seconds'
  )
);

CREATE INDEX origin_nonces_expiry_idx
  ON viberacing_private.origin_nonces (expires_at, nonce_digest);

CREATE TABLE viberacing_private.device_nonces (
  device_key_id varchar(26) NOT NULL
    REFERENCES viberacing_private.device_keys(device_key_id) ON DELETE CASCADE,
  nonce_digest bytea NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (device_key_id, nonce_digest),
  CONSTRAINT device_nonces_digest_exact
    CHECK (pg_catalog.octet_length(nonce_digest) = 32),
  CONSTRAINT device_nonces_time_bounded CHECK (
    expires_at > consumed_at
    AND expires_at <= consumed_at + interval '20 minutes'
  )
);

CREATE INDEX device_nonces_expiry_idx
  ON viberacing_private.device_nonces (expires_at, device_key_id, nonce_digest);

CREATE TABLE viberacing_private.usage_observations (
  observation_id varchar(26) PRIMARY KEY,
  device_key_id varchar(26) NOT NULL,
  device_id varchar(26) NOT NULL,
  installation_id varchar(26) NOT NULL,
  agent_account_id varchar(26) NOT NULL,
  sync_id varchar(26) NOT NULL,
  observed_at timestamptz NOT NULL,
  body_digest bytea NOT NULL,
  signature bytea NOT NULL,
  device_nonce_digest bytea NOT NULL,
  origin_nonce_digest bytea NOT NULL,
  reader_version varchar(64) NOT NULL,
  client_version varchar(64) NOT NULL,
  outcome varchar(12) NOT NULL,
  quarantine_reason varchar(40),
  entry_count integer NOT NULL,
  accepted_entry_count integer NOT NULL,
  season_starts date[] NOT NULL,
  received_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  retention_expires_at timestamptz NOT NULL,
  CONSTRAINT usage_observations_id_canonical
    CHECK (observation_id ~ '^obs_[A-Za-z0-9_-]{22}$'),
  CONSTRAINT usage_observations_device_binding_fk
    FOREIGN KEY (device_key_id, device_id, installation_id, agent_account_id)
    REFERENCES viberacing_private.device_keys(
      device_key_id,
      device_id,
      installation_id,
      agent_account_id
    ),
  CONSTRAINT usage_observations_sync_id_canonical
    CHECK (sync_id ~ '^syn_[A-Za-z0-9_-]{22}$'),
  CONSTRAINT usage_observations_digest_shape CHECK (
    pg_catalog.octet_length(body_digest) = 32
    AND pg_catalog.octet_length(signature) = 64
    AND pg_catalog.octet_length(device_nonce_digest) = 32
    AND pg_catalog.octet_length(origin_nonce_digest) = 32
  ),
  CONSTRAINT usage_observations_reader_version_canonical
    CHECK (reader_version ~ '^[a-z][a-z0-9_]{2,63}$'),
  CONSTRAINT usage_observations_client_version_canonical CHECK (
    client_version ~ '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$'
  ),
  CONSTRAINT usage_observations_outcome_closed
    CHECK (outcome IN ('accepted', 'duplicate', 'quarantined')),
  CONSTRAINT usage_observations_quarantine_reason_closed CHECK (
    quarantine_reason IS NULL
    OR quarantine_reason IN (
      'decrease',
      'date_out_of_range',
      'accounting_revision_mismatch',
      'account_state',
      'overlap_detected',
      'numeric_out_of_range',
      'season_closed',
      'anomaly_review'
    )
  ),
  CONSTRAINT usage_observations_outcome_shape CHECK (
    (outcome = 'accepted'
      AND quarantine_reason IS NULL
      AND accepted_entry_count BETWEEN 1 AND entry_count)
    OR (outcome = 'duplicate'
      AND quarantine_reason IS NULL
      AND accepted_entry_count = 0)
    OR (outcome = 'quarantined'
      AND quarantine_reason IS NOT NULL
      AND accepted_entry_count = 0)
  ),
  CONSTRAINT usage_observations_entry_count_bounded
    CHECK (entry_count BETWEEN 1 AND 31),
  CONSTRAINT usage_observations_season_count_bounded
    CHECK (pg_catalog.cardinality(season_starts) BETWEEN 1 AND 6),
  CONSTRAINT usage_observations_retention_bounded CHECK (
    retention_expires_at >= received_at + interval '10 days'
  ),
  CONSTRAINT usage_observations_device_sync_unique UNIQUE (device_key_id, sync_id)
);

CREATE INDEX usage_observations_account_received_idx
  ON viberacing_private.usage_observations (
    agent_account_id,
    received_at DESC,
    observation_id
  );

CREATE INDEX usage_observations_retention_idx
  ON viberacing_private.usage_observations (retention_expires_at, observation_id);

CREATE TABLE viberacing_private.usage_idempotency_records (
  device_key_id varchar(26) NOT NULL
    REFERENCES viberacing_private.device_keys(device_key_id) ON DELETE CASCADE,
  sync_id varchar(26) NOT NULL,
  device_id varchar(26) NOT NULL,
  agent_account_id varchar(26) NOT NULL,
  observation_id varchar(26) NOT NULL UNIQUE,
  body_digest bytea NOT NULL,
  signature bytea NOT NULL,
  device_nonce_digest bytea NOT NULL,
  semantic_digest bytea NOT NULL,
  observed_at timestamptz NOT NULL,
  reader_version varchar(64) NOT NULL,
  client_version varchar(64) NOT NULL,
  original_outcome varchar(12) NOT NULL,
  original_accepted_entry_count integer NOT NULL,
  season_starts date[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  retention_expires_at timestamptz NOT NULL,
  PRIMARY KEY (device_key_id, sync_id),
  CONSTRAINT usage_idempotency_sync_id_canonical
    CHECK (sync_id ~ '^syn_[A-Za-z0-9_-]{22}$'),
  CONSTRAINT usage_idempotency_digest_shape CHECK (
    pg_catalog.octet_length(body_digest) = 32
    AND pg_catalog.octet_length(signature) = 64
    AND pg_catalog.octet_length(device_nonce_digest) = 32
    AND pg_catalog.octet_length(semantic_digest) = 32
  ),
  CONSTRAINT usage_idempotency_outcome_closed
    CHECK (original_outcome IN ('accepted', 'duplicate', 'quarantined')),
  CONSTRAINT usage_idempotency_outcome_shape CHECK (
    (original_outcome = 'accepted' AND original_accepted_entry_count BETWEEN 1 AND 31)
    OR (original_outcome IN ('duplicate', 'quarantined')
      AND original_accepted_entry_count = 0)
  ),
  CONSTRAINT usage_idempotency_season_count_bounded
    CHECK (pg_catalog.cardinality(season_starts) BETWEEN 1 AND 6),
  CONSTRAINT usage_idempotency_retention_bounded CHECK (
    retention_expires_at >= created_at + interval '10 days'
  ),
  CONSTRAINT usage_idempotency_observation_fk
    FOREIGN KEY (observation_id)
    REFERENCES viberacing_private.usage_observations(observation_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX usage_idempotency_retention_idx
  ON viberacing_private.usage_idempotency_records (
    retention_expires_at,
    device_key_id,
    sync_id
  );

CREATE TABLE viberacing_private.agent_account_day_totals (
  agent_account_id varchar(26) NOT NULL
    REFERENCES viberacing_private.agent_accounts(agent_account_id) ON DELETE RESTRICT,
  usage_date date NOT NULL,
  cumulative_token_total numeric(30, 0) NOT NULL,
  accepted_observation_id varchar(26) NOT NULL
    REFERENCES viberacing_private.usage_observations(observation_id) ON DELETE RESTRICT,
  accepted_sync_id varchar(26) NOT NULL,
  accepted_device_id varchar(26) NOT NULL
    REFERENCES viberacing_private.device_keys(device_id) ON DELETE RESTRICT,
  first_accepted_at timestamptz NOT NULL,
  last_accepted_at timestamptz NOT NULL,
  PRIMARY KEY (agent_account_id, usage_date),
  CONSTRAINT agent_account_day_totals_nonnegative
    CHECK (cumulative_token_total >= 0),
  CONSTRAINT agent_account_day_totals_sync_id_canonical
    CHECK (accepted_sync_id ~ '^syn_[A-Za-z0-9_-]{22}$'),
  CONSTRAINT agent_account_day_totals_time_order
    CHECK (last_accepted_at >= first_accepted_at)
);

CREATE INDEX agent_account_day_totals_date_account_idx
  ON viberacing_private.agent_account_day_totals (usage_date, agent_account_id);

CREATE TABLE viberacing_private.ranking_refresh_outbox (
  season_start date NOT NULL,
  trust_tier varchar(12) NOT NULL,
  dirty_since timestamptz NOT NULL,
  last_observation_id varchar(26)
    REFERENCES viberacing_private.usage_observations(observation_id) ON DELETE SET NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  state varchar(8) NOT NULL DEFAULT 'pending',
  PRIMARY KEY (season_start, trust_tier),
  CONSTRAINT ranking_refresh_outbox_season_monday
    CHECK (extract(isodow FROM season_start) = 1),
  CONSTRAINT ranking_refresh_outbox_trust_tier_closed
    CHECK (trust_tier IN ('community', 'verified')),
  CONSTRAINT ranking_refresh_outbox_attempt_bounded
    CHECK (attempt_count BETWEEN 0 AND 100),
  CONSTRAINT ranking_refresh_outbox_state_closed
    CHECK (state IN ('pending', 'retry')),
  CONSTRAINT ranking_refresh_outbox_time_order
    CHECK (next_attempt_at >= dirty_since)
);

CREATE INDEX ranking_refresh_outbox_due_idx
  ON viberacing_private.ranking_refresh_outbox (
    next_attempt_at,
    season_start,
    trust_tier
  );

CREATE TABLE viberacing_private.ranking_events (
  event_id varchar(26) PRIMARY KEY,
  event_type varchar(32) NOT NULL,
  season_start date,
  profile_id uuid REFERENCES viberacing_private.profiles(profile_id) ON DELETE RESTRICT,
  agent_account_id varchar(26)
    REFERENCES viberacing_private.agent_accounts(agent_account_id) ON DELETE RESTRICT,
  observation_id varchar(26)
    REFERENCES viberacing_private.usage_observations(observation_id) ON DELETE RESTRICT,
  previous_value numeric(30, 0),
  new_value numeric(30, 0),
  reason_code varchar(40) NOT NULL,
  actor_class varchar(24) NOT NULL,
  authorized_by varchar(64),
  occurred_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  previous_event_digest bytea,
  event_digest bytea NOT NULL UNIQUE,
  CONSTRAINT ranking_events_id_canonical
    CHECK (event_id ~ '^evt_[A-Za-z0-9_-]{22}$'),
  CONSTRAINT ranking_events_type_closed CHECK (
    event_type IN (
      'observation_accepted',
      'observation_duplicate',
      'observation_quarantined',
      'observation_invalidated',
      'account_paused',
      'account_unlinked',
      'correction_applied',
      'appeal_opened',
      'appeal_resolved'
    )
  ),
  CONSTRAINT ranking_events_season_monday CHECK (
    season_start IS NULL OR extract(isodow FROM season_start) = 1
  ),
  CONSTRAINT ranking_events_values_nonnegative CHECK (
    (previous_value IS NULL OR previous_value >= 0)
    AND (new_value IS NULL OR new_value >= 0)
  ),
  CONSTRAINT ranking_events_reason_canonical
    CHECK (reason_code ~ '^[a-z][a-z0-9_]{1,39}$'),
  CONSTRAINT ranking_events_actor_closed
    CHECK (actor_class IN ('connector', 'jobs', 'admin', 'system')),
  CONSTRAINT ranking_events_authorized_by_bounded CHECK (
    authorized_by IS NULL
    OR (
      pg_catalog.length(authorized_by) BETWEEN 1 AND 64
      AND authorized_by !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT ranking_events_digest_shape CHECK (
    (previous_event_digest IS NULL OR pg_catalog.octet_length(previous_event_digest) = 32)
    AND pg_catalog.octet_length(event_digest) = 32
  )
);

CREATE INDEX ranking_events_account_chain_idx
  ON viberacing_private.ranking_events (
    agent_account_id,
    occurred_at DESC,
    event_id DESC
  );

CREATE UNIQUE INDEX ranking_events_one_successor_per_account_idx
  ON viberacing_private.ranking_events (agent_account_id, previous_event_digest)
  WHERE agent_account_id IS NOT NULL AND previous_event_digest IS NOT NULL;

CREATE FUNCTION viberacing_private.reject_usage_observation_update()
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

CREATE TRIGGER usage_observations_immutable
BEFORE UPDATE ON viberacing_private.usage_observations
FOR EACH ROW EXECUTE FUNCTION viberacing_private.reject_usage_observation_update();

CREATE FUNCTION viberacing_private.reject_usage_idempotency_update()
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

CREATE TRIGGER usage_idempotency_records_immutable
BEFORE UPDATE ON viberacing_private.usage_idempotency_records
FOR EACH ROW EXECUTE FUNCTION viberacing_private.reject_usage_idempotency_update();

CREATE FUNCTION viberacing_private.enforce_agent_account_day_total_update()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.agent_account_id <> OLD.agent_account_id
    OR NEW.usage_date <> OLD.usage_date
    OR NEW.cumulative_token_total <= OLD.cumulative_token_total
    OR NEW.first_accepted_at <> OLD.first_accepted_at
    OR NEW.last_accepted_at < OLD.last_accepted_at
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER agent_account_day_totals_monotonic
BEFORE UPDATE ON viberacing_private.agent_account_day_totals
FOR EACH ROW EXECUTE FUNCTION viberacing_private.enforce_agent_account_day_total_update();

CREATE FUNCTION viberacing_private.reject_ranking_event_update()
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

CREATE TRIGGER ranking_events_append_only
BEFORE UPDATE ON viberacing_private.ranking_events
FOR EACH ROW EXECUTE FUNCTION viberacing_private.reject_ranking_event_update();

CREATE FUNCTION viberacing_api.read_usage_device_verification_material(p_device_id text)
RETURNS TABLE (
  device_key_id text,
  device_id text,
  installation_id text,
  agent_account_id text,
  public_key bytea,
  provider_code text,
  accounting_revision integer,
  reader_version text,
  scope_kind text,
  maximum_backfill_days integer,
  identity_assurance text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT
    device.device_key_id::text,
    device.device_id::text,
    device.installation_id::text,
    device.agent_account_id::text,
    device.public_key,
    account.provider_code::text,
    account.accounting_revision,
    revision.reader_contract_version::text,
    account.scope_kind::text,
    revision.maximum_backfill_days,
    account.identity_assurance::text
  FROM viberacing_private.device_keys AS device
  JOIN viberacing_private.connector_installations AS installation
    ON installation.installation_id = device.installation_id
    AND installation.profile_id = device.profile_id
  JOIN viberacing_private.agent_accounts AS account
    ON account.agent_account_id = device.agent_account_id
    AND account.profile_id = device.profile_id
  JOIN viberacing_private.agent_providers AS provider
    ON provider.provider_code = account.provider_code
  JOIN viberacing_private.agent_accounting_revisions AS revision
    ON revision.provider_code = account.provider_code
    AND revision.accounting_revision = account.accounting_revision
    AND revision.scope_kind = account.scope_kind
  WHERE device.device_id = p_device_id
    AND device.state = 'active'
    AND installation.state = 'active'
    AND account.state = 'active'
    AND account.identity_assurance = 'community_local'
    AND provider.state = 'supported'
    AND revision.enabled_for_new_accounts
    AND revision.scope_kind = 'agent_account'
  LIMIT 1
$function$;

CREATE FUNCTION viberacing_api.submit_usage_sync(
  p_observation_id text,
  p_event_id text,
  p_origin_key_id text,
  p_origin_nonce_digest bytea,
  p_origin_expires_at timestamptz,
  p_device_key_id text,
  p_device_id text,
  p_agent_account_id text,
  p_sync_id text,
  p_observed_at timestamptz,
  p_client_version text,
  p_reader_version text,
  p_body_digest bytea,
  p_signature bytea,
  p_device_nonce_digest bytea,
  p_usage_dates date[],
  p_daily_token_totals text[]
)
RETURNS TABLE (
  outcome text,
  accepted_entries integer,
  recovery_action text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_accepted_entries integer := 0;
  v_current_date date;
  v_entry_count integer;
  v_event_digest bytea;
  v_event_season date;
  v_event_type text;
  v_existing_idempotency viberacing_private.usage_idempotency_records%ROWTYPE;
  v_existing_total numeric(30, 0);
  v_has_decrease boolean := false;
  v_index integer;
  v_material record;
  v_new_total numeric(30, 0);
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_outcome text;
  v_previous_event_digest bytea;
  v_reason_code text;
  v_retention_expires_at timestamptz;
  v_row_count integer;
  v_semantic_digest bytea;
  v_season_starts date[];
  v_single_new numeric(30, 0);
  v_single_previous numeric(30, 0);
  v_transaction_time timestamptz := pg_catalog.transaction_timestamp();
BEGIN
  v_entry_count := pg_catalog.cardinality(p_usage_dates);
  v_current_date := (v_now AT TIME ZONE 'UTC')::date;

  IF p_observation_id IS NULL
    OR p_event_id IS NULL
    OR p_origin_key_id IS NULL
    OR p_device_key_id IS NULL
    OR p_device_id IS NULL
    OR p_agent_account_id IS NULL
    OR p_sync_id IS NULL
    OR p_observed_at IS NULL
    OR p_client_version IS NULL
    OR p_reader_version IS NULL
    OR p_usage_dates IS NULL
    OR p_daily_token_totals IS NULL
    OR p_observation_id !~ '^obs_[A-Za-z0-9_-]{22}$'
    OR p_event_id !~ '^evt_[A-Za-z0-9_-]{22}$'
    OR p_origin_key_id !~ '^edge_[A-Za-z0-9_-]{1,22}$'
    OR p_device_key_id !~ '^key_[A-Za-z0-9_-]{22}$'
    OR p_device_id !~ '^dev_[A-Za-z0-9_-]{22}$'
    OR p_agent_account_id !~ '^acc_[A-Za-z0-9_-]{22}$'
    OR p_sync_id !~ '^syn_[A-Za-z0-9_-]{22}$'
    OR p_client_version !~
      '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$'
    OR pg_catalog.length(p_client_version) > 64
    OR p_reader_version !~ '^[a-z][a-z0-9_]{2,63}$'
    OR pg_catalog.octet_length(p_origin_nonce_digest) <> 32
    OR pg_catalog.octet_length(p_body_digest) <> 32
    OR pg_catalog.octet_length(p_signature) <> 64
    OR pg_catalog.octet_length(p_device_nonce_digest) <> 32
    OR p_origin_expires_at <= v_now
    OR p_origin_expires_at > v_now + interval '65 seconds'
    OR p_observed_at < v_now - interval '15 minutes'
    OR p_observed_at > v_now + interval '2 minutes'
    OR v_entry_count NOT BETWEEN 1 AND 31
    OR pg_catalog.cardinality(p_daily_token_totals) <> v_entry_count
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(p_usage_dates) AS usage_date(value)
      WHERE usage_date.value IS NULL
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(p_daily_token_totals) AS token_total(value)
      WHERE token_total.value IS NULL
        OR token_total.value !~ '^(0|[1-9][0-9]{0,29})$'
    )
    OR (
      SELECT pg_catalog.count(DISTINCT usage_date.value)
      FROM pg_catalog.unnest(p_usage_dates) AS usage_date(value)
    ) <> v_entry_count
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  v_semantic_digest := pg_catalog.sha256(
    pg_catalog.convert_to(
      'usage_sync_semantics_v1' || chr(10)
        || p_agent_account_id || chr(10)
        || pg_catalog.to_char(
          p_observed_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ) || chr(10)
        || p_client_version || chr(10)
        || p_reader_version || chr(10)
        || pg_catalog.array_to_string(p_usage_dates, ',') || chr(10)
        || pg_catalog.array_to_string(p_daily_token_totals, ','),
      'UTF8'
    )
  );
  SELECT pg_catalog.array_agg(season_start.value ORDER BY season_start.value)
  INTO v_season_starts
  FROM (
    SELECT DISTINCT
      usage_date.value
        - (extract(isodow FROM usage_date.value)::integer - 1) AS value
    FROM pg_catalog.unnest(p_usage_dates) AS usage_date(value)
  ) AS season_start;

  SELECT idempotency.*
  INTO v_existing_idempotency
  FROM viberacing_private.usage_idempotency_records AS idempotency
  WHERE idempotency.device_key_id = p_device_key_id
    AND idempotency.sync_id = p_sync_id
  FOR UPDATE;

  IF v_existing_idempotency.device_key_id IS NOT NULL THEN
    IF v_existing_idempotency.device_id <> p_device_id
      OR v_existing_idempotency.agent_account_id <> p_agent_account_id
      OR v_existing_idempotency.body_digest <> p_body_digest
      OR v_existing_idempotency.signature <> p_signature
      OR v_existing_idempotency.device_nonce_digest <> p_device_nonce_digest
      OR v_existing_idempotency.semantic_digest <> v_semantic_digest
      OR v_existing_idempotency.observed_at <> p_observed_at
      OR v_existing_idempotency.reader_version <> p_reader_version
      OR v_existing_idempotency.client_version <> p_client_version
    THEN
      PERFORM viberacing_private.operation_failed();
    END IF;

    PERFORM 1
    FROM viberacing_private.device_keys AS device
    JOIN viberacing_private.connector_installations AS installation
      ON installation.installation_id = device.installation_id
      AND installation.profile_id = device.profile_id
    JOIN viberacing_private.agent_accounts AS account
      ON account.agent_account_id = device.agent_account_id
      AND account.profile_id = device.profile_id
    WHERE device.device_key_id = p_device_key_id
      AND device.device_id = p_device_id
      AND device.agent_account_id = p_agent_account_id
      AND device.state = 'active'
      AND installation.state = 'active'
      AND account.state = 'active'
    FOR UPDATE OF device, installation, account;
    IF NOT FOUND THEN
      PERFORM viberacing_private.operation_failed();
    END IF;

    RETURN QUERY SELECT 'duplicate'::text, 0, NULL::text;
    RETURN;
  END IF;

  INSERT INTO viberacing_private.origin_nonces (
    nonce_digest,
    origin_key_id,
    expires_at
  )
  VALUES (
    p_origin_nonce_digest,
    p_origin_key_id,
    p_origin_expires_at
  );

  SELECT
    device.device_key_id,
    device.device_id,
    device.installation_id,
    device.agent_account_id,
    device.profile_id,
    account.provider_code,
    account.accounting_revision,
    account.scope_kind,
    account.identity_assurance,
    revision.reader_contract_version,
    revision.maximum_backfill_days
  INTO v_material
  FROM viberacing_private.device_keys AS device
  JOIN viberacing_private.connector_installations AS installation
    ON installation.installation_id = device.installation_id
    AND installation.profile_id = device.profile_id
  JOIN viberacing_private.agent_accounts AS account
    ON account.agent_account_id = device.agent_account_id
    AND account.profile_id = device.profile_id
  JOIN viberacing_private.agent_providers AS provider
    ON provider.provider_code = account.provider_code
  JOIN viberacing_private.agent_accounting_revisions AS revision
    ON revision.provider_code = account.provider_code
    AND revision.accounting_revision = account.accounting_revision
    AND revision.scope_kind = account.scope_kind
  WHERE device.device_key_id = p_device_key_id
    AND device.device_id = p_device_id
    AND device.agent_account_id = p_agent_account_id
    AND device.state = 'active'
    AND installation.state = 'active'
    AND account.state = 'active'
    AND account.identity_assurance = 'community_local'
    AND provider.state = 'supported'
    AND revision.enabled_for_new_accounts
    AND revision.reader_contract_version = p_reader_version
    AND revision.scope_kind = 'agent_account'
  FOR UPDATE OF device, installation, account, provider, revision;

  IF v_material.device_key_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  v_now := pg_catalog.clock_timestamp();
  v_current_date := (v_now AT TIME ZONE 'UTC')::date;
  IF p_origin_expires_at <= v_now
    OR p_observed_at < v_now - interval '15 minutes'
    OR p_observed_at > v_now + interval '2 minutes'
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  FOR v_index IN 1..v_entry_count LOOP
    IF p_usage_dates[v_index] > v_current_date
      OR p_usage_dates[v_index] <
        v_current_date - v_material.maximum_backfill_days
    THEN
      PERFORM viberacing_private.operation_failed();
    END IF;
  END LOOP;

  INSERT INTO viberacing_private.device_nonces (
    device_key_id,
    nonce_digest,
    expires_at
  )
  VALUES (
    p_device_key_id,
    p_device_nonce_digest,
    v_transaction_time + interval '20 minutes'
  );

  FOR v_index IN 1..v_entry_count LOOP
    v_new_total := p_daily_token_totals[v_index]::numeric(30, 0);
    SELECT day_total.cumulative_token_total
    INTO v_existing_total
    FROM viberacing_private.agent_account_day_totals AS day_total
    WHERE day_total.agent_account_id = p_agent_account_id
      AND day_total.usage_date = p_usage_dates[v_index];

    IF v_entry_count = 1 THEN
      v_single_previous := v_existing_total;
      v_single_new := v_new_total;
    END IF;

    IF FOUND AND v_new_total < v_existing_total THEN
      v_has_decrease := true;
    ELSIF NOT FOUND OR v_new_total > v_existing_total THEN
      v_accepted_entries := v_accepted_entries + 1;
    END IF;
  END LOOP;

  IF v_has_decrease THEN
    v_outcome := 'quarantined';
    v_reason_code := 'decrease';
    v_event_type := 'observation_quarantined';
    v_accepted_entries := 0;
  ELSIF v_accepted_entries = 0 THEN
    v_outcome := 'duplicate';
    v_reason_code := 'same_snapshot';
    v_event_type := 'observation_duplicate';
  ELSE
    v_outcome := 'accepted';
    v_reason_code := 'accepted_update';
    v_event_type := 'observation_accepted';
  END IF;

  v_retention_expires_at := v_now
    + pg_catalog.make_interval(days => v_material.maximum_backfill_days + 10);

  INSERT INTO viberacing_private.usage_idempotency_records (
    device_key_id,
    sync_id,
    device_id,
    agent_account_id,
    observation_id,
    body_digest,
    signature,
    device_nonce_digest,
    semantic_digest,
    observed_at,
    reader_version,
    client_version,
    original_outcome,
    original_accepted_entry_count,
    season_starts,
    retention_expires_at
  )
  VALUES (
    p_device_key_id,
    p_sync_id,
    p_device_id,
    p_agent_account_id,
    p_observation_id,
    p_body_digest,
    p_signature,
    p_device_nonce_digest,
    v_semantic_digest,
    p_observed_at,
    p_reader_version,
    p_client_version,
    v_outcome,
    v_accepted_entries,
    v_season_starts,
    v_retention_expires_at
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
    quarantine_reason,
    entry_count,
    accepted_entry_count,
    season_starts,
    retention_expires_at
  )
  VALUES (
    p_observation_id,
    p_device_key_id,
    p_device_id,
    v_material.installation_id,
    p_agent_account_id,
    p_sync_id,
    p_observed_at,
    p_body_digest,
    p_signature,
    p_device_nonce_digest,
    p_origin_nonce_digest,
    p_reader_version,
    p_client_version,
    v_outcome,
    CASE WHEN v_outcome = 'quarantined' THEN v_reason_code ELSE NULL END,
    v_entry_count,
    v_accepted_entries,
    v_season_starts,
    v_retention_expires_at
  );

  IF v_outcome = 'accepted' THEN
    v_accepted_entries := 0;
    FOR v_index IN 1..v_entry_count LOOP
      v_new_total := p_daily_token_totals[v_index]::numeric(30, 0);
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
      VALUES (
        p_agent_account_id,
        p_usage_dates[v_index],
        v_new_total,
        p_observation_id,
        p_sync_id,
        p_device_id,
        v_now,
        v_now
      )
      ON CONFLICT (agent_account_id, usage_date) DO UPDATE
      SET cumulative_token_total = EXCLUDED.cumulative_token_total,
          accepted_observation_id = EXCLUDED.accepted_observation_id,
          accepted_sync_id = EXCLUDED.accepted_sync_id,
          accepted_device_id = EXCLUDED.accepted_device_id,
          last_accepted_at = EXCLUDED.last_accepted_at
      WHERE agent_account_day_totals.cumulative_token_total
        < EXCLUDED.cumulative_token_total;
      GET DIAGNOSTICS v_row_count = ROW_COUNT;

      IF v_row_count = 1 THEN
        v_accepted_entries := v_accepted_entries + 1;
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
          p_usage_dates[v_index]
            - (extract(isodow FROM p_usage_dates[v_index])::integer - 1),
          'community',
          v_now,
          p_observation_id,
          0,
          v_now,
          'pending'
        )
        ON CONFLICT (season_start, trust_tier) DO UPDATE
        SET dirty_since = least(
              ranking_refresh_outbox.dirty_since,
              EXCLUDED.dirty_since
            ),
            last_observation_id = EXCLUDED.last_observation_id,
            attempt_count = 0,
            next_attempt_at = least(
              ranking_refresh_outbox.next_attempt_at,
              EXCLUDED.next_attempt_at
            ),
            state = 'pending';
      END IF;
    END LOOP;
  END IF;

  SELECT event.event_digest
  INTO v_previous_event_digest
  FROM viberacing_private.ranking_events AS event
  WHERE event.agent_account_id = p_agent_account_id
    AND NOT EXISTS (
      SELECT 1
      FROM viberacing_private.ranking_events AS successor
      WHERE successor.agent_account_id = p_agent_account_id
        AND successor.previous_event_digest = event.event_digest
    )
  ORDER BY event.occurred_at DESC, event.event_id DESC
  LIMIT 1;

  v_event_season := CASE
    WHEN v_entry_count = 1
    THEN p_usage_dates[1]
      - (extract(isodow FROM p_usage_dates[1])::integer - 1)
    ELSE NULL
  END;

  v_event_digest := pg_catalog.sha256(
    pg_catalog.convert_to(
      'ranking_event_v1' || chr(10)
        || p_event_id || chr(10)
        || v_event_type || chr(10)
        || coalesce(v_event_season::text, '-') || chr(10)
        || v_material.profile_id::text || chr(10)
        || p_agent_account_id || chr(10)
        || p_observation_id || chr(10)
        || coalesce(v_single_previous::text, '-') || chr(10)
        || coalesce(v_single_new::text, '-') || chr(10)
        || v_reason_code || chr(10)
        || 'connector' || chr(10)
        || p_device_key_id || chr(10)
        || pg_catalog.to_char(
          v_now AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ) || chr(10)
        || coalesce(
          pg_catalog.encode(v_previous_event_digest, 'hex'),
          '-'
        ),
      'UTF8'
    )
  );

  INSERT INTO viberacing_private.ranking_events (
    event_id,
    event_type,
    season_start,
    profile_id,
    agent_account_id,
    observation_id,
    previous_value,
    new_value,
    reason_code,
    actor_class,
    authorized_by,
    occurred_at,
    previous_event_digest,
    event_digest
  )
  VALUES (
    p_event_id,
    v_event_type,
    v_event_season,
    v_material.profile_id,
    p_agent_account_id,
    p_observation_id,
    CASE WHEN v_entry_count = 1 THEN v_single_previous ELSE NULL END,
    CASE WHEN v_entry_count = 1 THEN v_single_new ELSE NULL END,
    v_reason_code,
    'connector',
    p_device_key_id,
    v_now,
    v_previous_event_digest,
    v_event_digest
  );

  UPDATE viberacing_private.device_keys
  SET last_used_at = v_now
  WHERE device_key_id = p_device_key_id
    AND state = 'active';
  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.connector_installations
  SET last_seen_at = v_now
  WHERE installation_id = v_material.installation_id
    AND state = 'active';
  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  RETURN QUERY
  SELECT
    v_outcome,
    v_accepted_entries,
    CASE WHEN v_outcome = 'quarantined' THEN 'contact_support' ELSE NULL END::text;
EXCEPTION
  WHEN unique_violation OR check_violation OR foreign_key_violation
    OR invalid_text_representation OR numeric_value_out_of_range
  THEN
    PERFORM viberacing_private.operation_failed();
END
$function$;

ALTER TABLE viberacing_private.origin_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.origin_nonces FORCE ROW LEVEL SECURITY;
CREATE POLICY origin_nonces_owner_only ON viberacing_private.origin_nonces
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

ALTER TABLE viberacing_private.device_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.device_nonces FORCE ROW LEVEL SECURITY;
CREATE POLICY device_nonces_owner_only ON viberacing_private.device_nonces
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

ALTER TABLE viberacing_private.usage_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.usage_observations FORCE ROW LEVEL SECURITY;
CREATE POLICY usage_observations_owner_only
  ON viberacing_private.usage_observations
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

ALTER TABLE viberacing_private.usage_idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.usage_idempotency_records FORCE ROW LEVEL SECURITY;
CREATE POLICY usage_idempotency_records_owner_only
  ON viberacing_private.usage_idempotency_records
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

ALTER TABLE viberacing_private.agent_account_day_totals ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.agent_account_day_totals FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_account_day_totals_owner_only
  ON viberacing_private.agent_account_day_totals
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

ALTER TABLE viberacing_private.ranking_refresh_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.ranking_refresh_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY ranking_refresh_outbox_owner_only
  ON viberacing_private.ranking_refresh_outbox
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

ALTER TABLE viberacing_private.ranking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.ranking_events FORCE ROW LEVEL SECURITY;
CREATE POLICY ranking_events_owner_only ON viberacing_private.ranking_events
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

REVOKE ALL ON ALL TABLES IN SCHEMA viberacing_private FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA viberacing_private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA viberacing_private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA viberacing_api FROM PUBLIC;

GRANT EXECUTE ON FUNCTION viberacing_api.read_usage_device_verification_material(text)
  TO viberacing_ingest;
GRANT EXECUTE ON FUNCTION viberacing_api.submit_usage_sync(
  text,
  text,
  text,
  bytea,
  timestamptz,
  text,
  text,
  text,
  text,
  timestamptz,
  text,
  text,
  bytea,
  bytea,
  bytea,
  date[],
  text[]
) TO viberacing_ingest;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (4, 'usage_ingest_replay_and_idempotency');

COMMIT;
