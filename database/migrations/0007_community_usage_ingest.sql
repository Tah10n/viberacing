\set ON_ERROR_STOP on

-- Revision 0007: bounded Community usage persistence and procedure-only ingest capability.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

CREATE TABLE viberacing_private.device_nonces (
  device_key_id uuid NOT NULL
    REFERENCES viberacing_private.device_keys (device_key_id) ON DELETE CASCADE,
  nonce_digest bytea NOT NULL,
  received_at timestamptz(3) NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  expires_at timestamptz(3) NOT NULL,
  CONSTRAINT device_nonces_digest_length CHECK (
    pg_catalog.octet_length(nonce_digest) = 32
  ),
  CONSTRAINT device_nonces_expiry_order CHECK (expires_at > received_at),
  CONSTRAINT device_nonces_device_digest_unique UNIQUE (device_key_id, nonce_digest)
);

CREATE TABLE viberacing_private.usage_snapshots (
  usage_snapshot_id uuid PRIMARY KEY,
  device_key_id uuid NOT NULL,
  device_id varchar(26) NOT NULL,
  source_id varchar(26) NOT NULL,
  sync_id varchar(26) NOT NULL,
  observed_at timestamptz(3) NOT NULL,
  connector_version varchar(64) NOT NULL,
  codex_version varchar(64) NOT NULL,
  body_digest bytea NOT NULL,
  signature bytea NOT NULL,
  nonce_digest bytea NOT NULL,
  outcome varchar(11) NOT NULL,
  quarantine_reason varchar(32),
  entry_count smallint NOT NULL,
  received_at timestamptz(3) NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  retention_expires_at timestamptz(3) NOT NULL,
  CONSTRAINT usage_snapshots_device_binding_fk
    FOREIGN KEY (device_key_id, source_id, device_id)
    REFERENCES viberacing_private.device_keys (device_key_id, source_id, device_id)
    ON DELETE CASCADE,
  CONSTRAINT usage_snapshots_sync_id_format CHECK (
    sync_id ~ '^syn_[A-Za-z0-9_-]{22}$'
  ),
  CONSTRAINT usage_snapshots_device_id_format CHECK (
    device_id ~ '^dev_[A-Za-z0-9_-]{22}$'
  ),
  CONSTRAINT usage_snapshots_source_id_format CHECK (
    source_id ~ '^src_[A-Za-z0-9_-]{22}$'
  ),
  CONSTRAINT usage_snapshots_connector_version_format CHECK (
    connector_version ~ '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$'
  ),
  CONSTRAINT usage_snapshots_codex_version_format CHECK (
    codex_version ~ '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$'
  ),
  CONSTRAINT usage_snapshots_digest_lengths CHECK (
    pg_catalog.octet_length(body_digest) = 32
    AND pg_catalog.octet_length(signature) = 64
    AND pg_catalog.octet_length(nonce_digest) = 32
  ),
  CONSTRAINT usage_snapshots_outcome CHECK (outcome IN ('accepted', 'quarantined')),
  CONSTRAINT usage_snapshots_quarantine_reason CHECK (
    quarantine_reason IS NULL OR quarantine_reason IN ('decrease', 'source_state')
  ),
  CONSTRAINT usage_snapshots_outcome_shape CHECK (
    (outcome = 'accepted' AND quarantine_reason IS NULL)
    OR (outcome = 'quarantined' AND quarantine_reason IS NOT NULL)
  ),
  CONSTRAINT usage_snapshots_entry_count CHECK (entry_count BETWEEN 1 AND 31),
  CONSTRAINT usage_snapshots_retention_order CHECK (retention_expires_at > received_at),
  CONSTRAINT usage_snapshots_device_sync_unique UNIQUE (device_key_id, sync_id)
);

CREATE TABLE viberacing_private.usage_snapshot_entries (
  usage_snapshot_id uuid NOT NULL
    REFERENCES viberacing_private.usage_snapshots (usage_snapshot_id) ON DELETE CASCADE,
  codex_reported_date date NOT NULL,
  tokens bigint NOT NULL,
  CONSTRAINT usage_snapshot_entries_token_bounds CHECK (
    tokens BETWEEN 0 AND 9007199254740991
  ),
  CONSTRAINT usage_snapshot_entries_snapshot_date_unique UNIQUE (
    usage_snapshot_id,
    codex_reported_date
  )
);

CREATE TABLE viberacing_private.source_day_values (
  source_id varchar(26) NOT NULL
    REFERENCES viberacing_private.codex_sources (source_id) ON DELETE CASCADE,
  codex_reported_date date NOT NULL,
  tokens bigint NOT NULL,
  accepted_snapshot_id uuid
    REFERENCES viberacing_private.usage_snapshots (usage_snapshot_id) ON DELETE SET NULL,
  accepted_sync_id varchar(26) NOT NULL,
  accepted_device_id varchar(26) NOT NULL,
  first_accepted_at timestamptz(3) NOT NULL,
  last_accepted_at timestamptz(3) NOT NULL,
  CONSTRAINT source_day_values_token_bounds CHECK (
    tokens BETWEEN 0 AND 9007199254740991
  ),
  CONSTRAINT source_day_values_sync_id_format CHECK (
    accepted_sync_id ~ '^syn_[A-Za-z0-9_-]{22}$'
  ),
  CONSTRAINT source_day_values_device_id_format CHECK (
    accepted_device_id ~ '^dev_[A-Za-z0-9_-]{22}$'
  ),
  CONSTRAINT source_day_values_time_order CHECK (
    last_accepted_at >= first_accepted_at
  ),
  CONSTRAINT source_day_values_source_date_unique UNIQUE (source_id, codex_reported_date)
);

CREATE INDEX device_nonces_expiry_idx
  ON viberacing_private.device_nonces (expires_at);
CREATE INDEX usage_snapshots_retention_idx
  ON viberacing_private.usage_snapshots (retention_expires_at);
CREATE INDEX usage_snapshots_source_received_idx
  ON viberacing_private.usage_snapshots (source_id, received_at DESC);
CREATE INDEX source_day_values_date_idx
  ON viberacing_private.source_day_values (codex_reported_date, source_id);

CREATE FUNCTION viberacing_private.enforce_source_day_value_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.source_id IS DISTINCT FROM OLD.source_id
    OR NEW.codex_reported_date IS DISTINCT FROM OLD.codex_reported_date
    OR NEW.first_accepted_at IS DISTINCT FROM OLD.first_accepted_at
    OR NEW.tokens < OLD.tokens
    OR NEW.last_accepted_at < OLD.last_accepted_at
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'invalid source day value transition';
  END IF;

  IF NEW.accepted_snapshot_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.usage_snapshots AS snapshot_record
    JOIN viberacing_private.usage_snapshot_entries AS entry_record
      ON entry_record.usage_snapshot_id = snapshot_record.usage_snapshot_id
    WHERE snapshot_record.usage_snapshot_id = NEW.accepted_snapshot_id
      AND snapshot_record.source_id = NEW.source_id
      AND snapshot_record.sync_id = NEW.accepted_sync_id
      AND snapshot_record.device_id = NEW.accepted_device_id
      AND snapshot_record.outcome = 'accepted'
      AND entry_record.codex_reported_date = NEW.codex_reported_date
      AND entry_record.tokens = NEW.tokens
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'invalid source day value transition';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER source_day_values_enforce_transition
BEFORE INSERT OR UPDATE ON viberacing_private.source_day_values
FOR EACH ROW EXECUTE FUNCTION viberacing_private.enforce_source_day_value_transition();

ALTER TABLE viberacing_private.device_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.device_nonces FORCE ROW LEVEL SECURITY;
CREATE POLICY device_nonces_owner_all ON viberacing_private.device_nonces
  FOR ALL TO viberacing_owner USING (true) WITH CHECK (true);

ALTER TABLE viberacing_private.usage_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.usage_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY usage_snapshots_owner_all ON viberacing_private.usage_snapshots
  FOR ALL TO viberacing_owner USING (true) WITH CHECK (true);

ALTER TABLE viberacing_private.usage_snapshot_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.usage_snapshot_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY usage_snapshot_entries_owner_all ON viberacing_private.usage_snapshot_entries
  FOR ALL TO viberacing_owner USING (true) WITH CHECK (true);

ALTER TABLE viberacing_private.source_day_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.source_day_values FORCE ROW LEVEL SECURITY;
CREATE POLICY source_day_values_owner_all ON viberacing_private.source_day_values
  FOR ALL TO viberacing_owner USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE
  viberacing_private.device_nonces,
  viberacing_private.usage_snapshots,
  viberacing_private.usage_snapshot_entries,
  viberacing_private.source_day_values
FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

CREATE FUNCTION viberacing_api.read_device_verification_material(
  p_device_id text
)
RETURNS TABLE (
  device_key_id uuid,
  source_id text,
  public_key bytea
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF p_device_id IS NULL OR p_device_id !~ '^dev_[A-Za-z0-9_-]{22}$' THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  RETURN QUERY
  SELECT
    device_record.device_key_id,
    device_record.source_id::text,
    device_record.public_key
  FROM viberacing_private.device_keys AS device_record
  JOIN viberacing_private.codex_sources AS source_record
    ON source_record.source_id = device_record.source_id
  JOIN viberacing_private.profiles AS profile_record
    ON profile_record.profile_id = source_record.profile_id
  WHERE device_record.device_id = p_device_id
    AND device_record.state = 'active'
    AND source_record.state IN ('active', 'quarantined')
    AND profile_record.state IN ('active', 'hidden');
END
$function$;

CREATE FUNCTION viberacing_api.submit_community_sync(
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
  should_quarantine boolean;
  submitted_entry_count integer := pg_catalog.cardinality(p_codex_reported_dates);
  now_at timestamptz(3) := pg_catalog.statement_timestamp();
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

  SELECT locked_source_state = 'quarantined' OR EXISTS (
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
  WHEN data_exception OR integrity_constraint_violation THEN
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

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (7, 'community_usage_ingest');

COMMIT;
