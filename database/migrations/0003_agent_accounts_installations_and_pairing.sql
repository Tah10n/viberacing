\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824762001);

CREATE TABLE viberacing_private.agent_providers (
  provider_code varchar(24) PRIMARY KEY,
  display_name varchar(48) NOT NULL UNIQUE,
  state varchar(10) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  CONSTRAINT agent_providers_code_closed CHECK (
    provider_code IN ('codex', 'claude_code', 'opencode', 'qwen_code', 'cline', 'aider')
  ),
  CONSTRAINT agent_providers_state_closed CHECK (state IN ('supported', 'recognized', 'disabled')),
  CONSTRAINT agent_providers_display_name_bounded CHECK (
    pg_catalog.length(display_name) BETWEEN 1 AND 48
    AND display_name !~ '[[:cntrl:]]'
  )
);

INSERT INTO viberacing_private.agent_providers (provider_code, display_name, state)
VALUES
  ('codex', 'Codex', 'supported'),
  ('claude_code', 'Claude Code', 'recognized'),
  ('opencode', 'opencode', 'recognized'),
  ('qwen_code', 'Qwen Code', 'recognized'),
  ('cline', 'Cline', 'recognized'),
  ('aider', 'Aider', 'recognized');

CREATE TABLE viberacing_private.agent_accounting_revisions (
  provider_code varchar(24) NOT NULL
    REFERENCES viberacing_private.agent_providers(provider_code),
  accounting_revision integer NOT NULL,
  reader_contract_version varchar(64) NOT NULL,
  scope_kind varchar(32) NOT NULL,
  utc_date_semantics varchar(32) NOT NULL,
  maximum_backfill_days integer NOT NULL,
  minimum_connector_version varchar(32) NOT NULL,
  enabled_for_new_accounts boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  PRIMARY KEY (provider_code, accounting_revision),
  CONSTRAINT agent_accounting_revisions_revision_positive CHECK (accounting_revision > 0),
  CONSTRAINT agent_accounting_revisions_reader_canonical
    CHECK (reader_contract_version ~ '^[a-z][a-z0-9_]{2,63}$'),
  CONSTRAINT agent_accounting_revisions_scope_closed CHECK (
    scope_kind IN (
      'agent_account',
      'provider_account_aggregate',
      'workspace_aggregate',
      'subscription_aggregate'
    )
  ),
  CONSTRAINT agent_accounting_revisions_utc_semantics_closed CHECK (
    utc_date_semantics IN ('provider_utc_date', 'utc_timestamp')
  ),
  CONSTRAINT agent_accounting_revisions_backfill_bounded
    CHECK (maximum_backfill_days BETWEEN 1 AND 90),
  CONSTRAINT agent_accounting_revisions_connector_version_canonical CHECK (
    minimum_connector_version ~ '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$'
  ),
  CONSTRAINT agent_accounting_revisions_competitive_scope CHECK (
    NOT enabled_for_new_accounts OR scope_kind = 'agent_account'
  ),
  CONSTRAINT agent_accounting_revisions_provider_scope_unique
    UNIQUE (provider_code, accounting_revision, scope_kind)
);

-- Codex is the only supported reader in this bootstrap. Its exact 0.144.5 candidate parser,
-- portable boundary, batch pairing, and first-sync path are covered by repository-owned evidence.
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
  'codex',
  1,
  'codex_app_server_0_144_5_v1',
  'agent_account',
  'provider_utc_date',
  35,
  '0.0.0',
  true
);

CREATE TABLE viberacing_private.agent_accounts (
  agent_account_id varchar(26) PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES viberacing_private.profiles(profile_id) ON DELETE CASCADE,
  provider_code varchar(24) NOT NULL,
  accounting_revision integer NOT NULL,
  scope_kind varchar(32) NOT NULL,
  fingerprint_kind varchar(20) NOT NULL,
  account_fingerprint_digest bytea,
  private_label varchar(64) NOT NULL,
  identity_assurance varchar(24) NOT NULL,
  state varchar(12) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  state_changed_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  quarantined_at timestamptz,
  unlinked_at timestamptz,
  CONSTRAINT agent_accounts_id_canonical
    CHECK (agent_account_id ~ '^acc_[A-Za-z0-9_-]{22}$'),
  CONSTRAINT agent_accounts_revision_scope_fk
    FOREIGN KEY (provider_code, accounting_revision, scope_kind)
    REFERENCES viberacing_private.agent_accounting_revisions(
      provider_code,
      accounting_revision,
      scope_kind
    ),
  CONSTRAINT agent_accounts_scope_competitive CHECK (scope_kind = 'agent_account'),
  CONSTRAINT agent_accounts_fingerprint_kind_closed CHECK (
    fingerprint_kind IN ('stable_opaque', 'provider_verified', 'unavailable')
  ),
  CONSTRAINT agent_accounts_fingerprint_shape CHECK (
    (fingerprint_kind = 'unavailable' AND account_fingerprint_digest IS NULL)
    OR (
      fingerprint_kind IN ('stable_opaque', 'provider_verified')
      AND pg_catalog.octet_length(account_fingerprint_digest) = 32
    )
  ),
  CONSTRAINT agent_accounts_label_bounded CHECK (
    pg_catalog.length(private_label) BETWEEN 1 AND 64
    AND private_label !~ '[[:cntrl:]]'
  ),
  CONSTRAINT agent_accounts_identity_assurance_closed CHECK (
    identity_assurance IN ('community_local', 'provider_verified')
  ),
  CONSTRAINT agent_accounts_identity_shape CHECK (
    (identity_assurance = 'provider_verified' AND fingerprint_kind = 'provider_verified')
    OR (identity_assurance = 'community_local' AND fingerprint_kind <> 'provider_verified')
  ),
  CONSTRAINT agent_accounts_state_closed CHECK (
    state IN ('active', 'paused', 'quarantined', 'unlinked')
  ),
  CONSTRAINT agent_accounts_state_time_order CHECK (
    state_changed_at >= created_at
    AND (quarantined_at IS NULL OR quarantined_at >= created_at)
    AND (unlinked_at IS NULL OR unlinked_at >= created_at)
  ),
  CONSTRAINT agent_accounts_terminal_shape CHECK (
    (state = 'quarantined' AND quarantined_at IS NOT NULL AND unlinked_at IS NULL)
    OR (state = 'unlinked' AND unlinked_at IS NOT NULL)
    OR (state IN ('active', 'paused') AND quarantined_at IS NULL AND unlinked_at IS NULL)
  ),
  CONSTRAINT agent_accounts_profile_id_unique UNIQUE (profile_id, agent_account_id)
);

CREATE UNIQUE INDEX agent_accounts_local_fingerprint_dedup_idx
  ON viberacing_private.agent_accounts (
    profile_id,
    provider_code,
    account_fingerprint_digest
  )
  WHERE fingerprint_kind = 'stable_opaque' AND state <> 'unlinked';

CREATE UNIQUE INDEX agent_accounts_verified_fingerprint_global_idx
  ON viberacing_private.agent_accounts (provider_code, account_fingerprint_digest)
  WHERE fingerprint_kind = 'provider_verified' AND state <> 'unlinked';

CREATE INDEX agent_accounts_profile_provider_idx
  ON viberacing_private.agent_accounts (profile_id, provider_code, created_at);

CREATE TABLE viberacing_private.connector_installations (
  installation_id varchar(26) PRIMARY KEY,
  profile_id uuid REFERENCES viberacing_private.profiles(profile_id) ON DELETE CASCADE,
  installation_public_key bytea NOT NULL UNIQUE,
  label varchar(64) NOT NULL,
  connector_version varchar(32) NOT NULL,
  os_family varchar(16) NOT NULL,
  architecture varchar(16) NOT NULL,
  state varchar(8) NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  activated_at timestamptz,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  CONSTRAINT connector_installations_id_canonical
    CHECK (installation_id ~ '^ins_[A-Za-z0-9_-]{22}$'),
  CONSTRAINT connector_installations_public_key_exact
    CHECK (pg_catalog.octet_length(installation_public_key) = 32),
  CONSTRAINT connector_installations_label_bounded CHECK (
    pg_catalog.length(label) BETWEEN 1 AND 64
    AND label !~ '[[:cntrl:]]'
  ),
  CONSTRAINT connector_installations_version_canonical CHECK (
    connector_version ~ '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$'
  ),
  CONSTRAINT connector_installations_platform_closed CHECK (
    os_family IN ('windows', 'macos', 'linux')
    AND architecture IN ('x86_64', 'aarch64')
  ),
  CONSTRAINT connector_installations_state_closed CHECK (state IN ('pending', 'active', 'revoked')),
  CONSTRAINT connector_installations_lifecycle_shape CHECK (
    (state = 'pending'
      AND activated_at IS NULL
      AND revoked_at IS NULL)
    OR (state = 'active'
      AND profile_id IS NOT NULL
      AND activated_at IS NOT NULL
      AND revoked_at IS NULL)
    OR (state = 'revoked'
      AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT connector_installations_time_order CHECK (
    (activated_at IS NULL OR activated_at >= created_at)
    AND (revoked_at IS NULL OR revoked_at >= created_at)
    AND (last_seen_at IS NULL OR last_seen_at >= created_at)
  ),
  CONSTRAINT connector_installations_profile_id_unique UNIQUE (profile_id, installation_id)
);

CREATE INDEX connector_installations_profile_state_idx
  ON viberacing_private.connector_installations (profile_id, state, created_at);

CREATE TABLE viberacing_private.device_keys (
  device_key_id varchar(26) PRIMARY KEY,
  device_id varchar(26) NOT NULL UNIQUE,
  profile_id uuid NOT NULL,
  installation_id varchar(26) NOT NULL,
  agent_account_id varchar(26) NOT NULL,
  public_key bytea NOT NULL UNIQUE,
  state varchar(8) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  activated_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  revoked_at timestamptz,
  last_used_at timestamptz,
  CONSTRAINT device_keys_key_id_canonical
    CHECK (device_key_id ~ '^key_[A-Za-z0-9_-]{22}$'),
  CONSTRAINT device_keys_device_id_canonical
    CHECK (device_id ~ '^dev_[A-Za-z0-9_-]{22}$'),
  CONSTRAINT device_keys_installation_profile_fk
    FOREIGN KEY (profile_id, installation_id)
    REFERENCES viberacing_private.connector_installations(profile_id, installation_id)
    ON DELETE CASCADE,
  CONSTRAINT device_keys_account_profile_fk
    FOREIGN KEY (profile_id, agent_account_id)
    REFERENCES viberacing_private.agent_accounts(profile_id, agent_account_id)
    ON DELETE CASCADE,
  CONSTRAINT device_keys_public_key_exact CHECK (pg_catalog.octet_length(public_key) = 32),
  CONSTRAINT device_keys_state_closed CHECK (state IN ('active', 'revoked')),
  CONSTRAINT device_keys_lifecycle_shape CHECK (
    (state = 'active' AND revoked_at IS NULL)
    OR (state = 'revoked' AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT device_keys_time_order CHECK (
    activated_at >= created_at
    AND (revoked_at IS NULL OR revoked_at >= activated_at)
    AND (last_used_at IS NULL OR last_used_at >= activated_at)
  ),
  CONSTRAINT device_keys_installation_account_unique
    UNIQUE (installation_id, agent_account_id)
);

CREATE INDEX device_keys_account_state_idx
  ON viberacing_private.device_keys (agent_account_id, state, activated_at);

CREATE TABLE viberacing_private.pairing_transactions (
  pairing_id varchar(27) PRIMARY KEY,
  installation_id varchar(26) NOT NULL
    REFERENCES viberacing_private.connector_installations(installation_id) ON DELETE CASCADE,
  profile_id uuid REFERENCES viberacing_private.profiles(profile_id) ON DELETE CASCADE,
  manifest_digest bytea NOT NULL,
  start_proof_digest bytea NOT NULL UNIQUE,
  poll_verifier_digest bytea NOT NULL UNIQUE,
  user_code_verifier_digest bytea NOT NULL UNIQUE,
  possession_challenge bytea NOT NULL,
  state varchar(10) NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  expires_at timestamptz NOT NULL,
  approved_at timestamptz,
  activated_at timestamptz,
  approved_by_session_id uuid,
  approved_by_passkey_id uuid,
  CONSTRAINT pairing_transactions_id_canonical
    CHECK (pairing_id ~ '^pair_[A-Za-z0-9_-]{22}$'),
  CONSTRAINT pairing_transactions_digest_shape CHECK (
    pg_catalog.octet_length(manifest_digest) = 32
    AND pg_catalog.octet_length(start_proof_digest) = 32
    AND pg_catalog.octet_length(poll_verifier_digest) = 32
    AND pg_catalog.octet_length(user_code_verifier_digest) = 32
    AND pg_catalog.octet_length(possession_challenge) = 32
  ),
  CONSTRAINT pairing_transactions_state_closed CHECK (
    state IN ('pending', 'approved', 'activated', 'rejected', 'expired')
  ),
  CONSTRAINT pairing_transactions_time_order CHECK (
    expires_at > created_at
    AND expires_at <= created_at + interval '10 minutes'
    AND (approved_at IS NULL OR approved_at >= created_at)
    AND (activated_at IS NULL OR activated_at >= approved_at)
  ),
  CONSTRAINT pairing_transactions_lifecycle_shape CHECK (
    (state = 'pending'
      AND profile_id IS NULL
      AND approved_at IS NULL
      AND activated_at IS NULL
      AND approved_by_session_id IS NULL
      AND approved_by_passkey_id IS NULL)
    OR (state = 'approved'
      AND profile_id IS NOT NULL
      AND approved_at IS NOT NULL
      AND activated_at IS NULL
      AND approved_by_session_id IS NOT NULL
      AND approved_by_passkey_id IS NOT NULL)
    OR (state = 'activated'
      AND profile_id IS NOT NULL
      AND approved_at IS NOT NULL
      AND activated_at IS NOT NULL
      AND approved_by_session_id IS NOT NULL
      AND approved_by_passkey_id IS NOT NULL)
    OR (state IN ('rejected', 'expired') AND activated_at IS NULL)
  ),
  CONSTRAINT pairing_transactions_approval_session_fk
    FOREIGN KEY (approved_by_session_id, profile_id)
    REFERENCES viberacing_private.sessions(session_id, profile_id),
  CONSTRAINT pairing_transactions_approval_passkey_fk
    FOREIGN KEY (profile_id, approved_by_passkey_id)
    REFERENCES viberacing_private.passkeys(profile_id, passkey_id)
);

CREATE INDEX pairing_transactions_pending_expiry_idx
  ON viberacing_private.pairing_transactions (expires_at, pairing_id)
  WHERE state IN ('pending', 'approved');

CREATE UNIQUE INDEX pairing_transactions_one_open_batch_per_installation_idx
  ON viberacing_private.pairing_transactions (installation_id)
  WHERE state IN ('pending', 'approved');

CREATE TABLE viberacing_private.pairing_code_attempt_windows (
  session_id uuid PRIMARY KEY REFERENCES viberacing_private.sessions(session_id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT pairing_code_attempt_windows_count_bounded CHECK (attempt_count BETWEEN 1 AND 10),
  CONSTRAINT pairing_code_attempt_windows_time_order CHECK (
    updated_at >= window_started_at
    AND updated_at <= window_started_at + interval '15 minutes'
  )
);

CREATE TABLE viberacing_private.pairing_request_windows (
  operation varchar(5) NOT NULL,
  bucket smallint NOT NULL,
  window_started_at timestamptz(3) NOT NULL,
  attempt_count integer NOT NULL,
  CONSTRAINT pairing_request_windows_operation CHECK (operation IN ('start', 'poll')),
  CONSTRAINT pairing_request_windows_bucket CHECK (bucket BETWEEN -1 AND 63),
  CONSTRAINT pairing_request_windows_state_shape CHECK (
    (
      attempt_count = 0
      AND window_started_at = TIMESTAMPTZ '1970-01-01 00:00:00+00'
    )
    OR (
      attempt_count BETWEEN 1 AND 1000001
      AND window_started_at > TIMESTAMPTZ '1970-01-01 00:00:00+00'
    )
  ),
  CONSTRAINT pairing_request_windows_identity PRIMARY KEY (operation, bucket)
);

INSERT INTO viberacing_private.pairing_request_windows (
  operation,
  bucket,
  window_started_at,
  attempt_count
)
SELECT
  operation_record.operation,
  bucket_record.bucket,
  TIMESTAMPTZ '1970-01-01 00:00:00+00',
  0
FROM (
  VALUES ('poll'::varchar(5)), ('start'::varchar(5))
) AS operation_record(operation)
CROSS JOIN pg_catalog.generate_series(-1, 63) AS bucket_record(bucket);

CREATE TABLE viberacing_private.pairing_candidates (
  pairing_id varchar(27) NOT NULL
    REFERENCES viberacing_private.pairing_transactions(pairing_id) ON DELETE CASCADE,
  candidate_id varchar(27) NOT NULL,
  provider_code varchar(24) NOT NULL,
  reader_version varchar(64) NOT NULL,
  accounting_revision integer NOT NULL,
  scope_kind varchar(32) NOT NULL,
  fingerprint_kind varchar(20) NOT NULL,
  fingerprint_digest bytea,
  proposed_sync_public_key bytea NOT NULL UNIQUE,
  safe_local_display_label varchar(64) NOT NULL,
  preview_current_week_token_total varchar(60) NOT NULL,
  preview_last_usage_date date,
  preview_status varchar(24) NOT NULL,
  decision varchar(16) NOT NULL DEFAULT 'pending',
  target_agent_account_id varchar(26),
  approved_device_key_id varchar(26),
  approved_device_id varchar(26),
  PRIMARY KEY (pairing_id, candidate_id),
  CONSTRAINT pairing_candidates_id_canonical
    CHECK (candidate_id ~ '^cand_[A-Za-z0-9_-]{22}$'),
  CONSTRAINT pairing_candidates_revision_scope_fk
    FOREIGN KEY (provider_code, accounting_revision, scope_kind)
    REFERENCES viberacing_private.agent_accounting_revisions(
      provider_code,
      accounting_revision,
      scope_kind
    ),
  CONSTRAINT pairing_candidates_reader_canonical
    CHECK (reader_version ~ '^[a-z][a-z0-9_]{2,63}$'),
  CONSTRAINT pairing_candidates_scope_competitive CHECK (scope_kind = 'agent_account'),
  CONSTRAINT pairing_candidates_fingerprint_kind_closed CHECK (
    fingerprint_kind IN ('stable_opaque', 'provider_verified', 'unavailable')
  ),
  CONSTRAINT pairing_candidates_fingerprint_shape CHECK (
    (fingerprint_kind = 'unavailable' AND fingerprint_digest IS NULL)
    OR (
      fingerprint_kind IN ('stable_opaque', 'provider_verified')
      AND pg_catalog.octet_length(fingerprint_digest) = 32
    )
  ),
  CONSTRAINT pairing_candidates_public_key_exact
    CHECK (pg_catalog.octet_length(proposed_sync_public_key) = 32),
  CONSTRAINT pairing_candidates_target_account_fk
    FOREIGN KEY (target_agent_account_id)
    REFERENCES viberacing_private.agent_accounts(agent_account_id),
  CONSTRAINT pairing_candidates_label_bounded CHECK (
    pg_catalog.length(safe_local_display_label) BETWEEN 1 AND 64
    AND safe_local_display_label !~ '[[:cntrl:]]'
  ),
  CONSTRAINT pairing_candidates_preview_total_canonical CHECK (
    preview_current_week_token_total ~ '^(0|[1-9][0-9]{0,59})$'
  ),
  CONSTRAINT pairing_candidates_preview_status_closed CHECK (
    preview_status IN (
      'ready',
      'incomplete_period',
      'reader_error',
      'unavailable',
      'unsupported_scope',
      'unsupported_version'
    )
  ),
  CONSTRAINT pairing_candidates_decision_closed CHECK (
    decision IN ('pending', 'create', 'attach_existing', 'skip')
  ),
  CONSTRAINT pairing_candidates_decision_shape CHECK (
    (decision = 'pending'
      AND target_agent_account_id IS NULL
      AND approved_device_key_id IS NULL
      AND approved_device_id IS NULL)
    OR (decision = 'skip'
      AND target_agent_account_id IS NULL
      AND approved_device_key_id IS NULL
      AND approved_device_id IS NULL)
    OR (decision IN ('create', 'attach_existing')
      AND target_agent_account_id IS NOT NULL
      AND approved_device_key_id ~ '^key_[A-Za-z0-9_-]{22}$'
      AND approved_device_id ~ '^dev_[A-Za-z0-9_-]{22}$')
  )
);

CREATE UNIQUE INDEX pairing_candidates_device_key_id_unique_idx
  ON viberacing_private.pairing_candidates (approved_device_key_id)
  WHERE approved_device_key_id IS NOT NULL;

CREATE UNIQUE INDEX pairing_candidates_device_id_unique_idx
  ON viberacing_private.pairing_candidates (approved_device_id)
  WHERE approved_device_id IS NOT NULL;

CREATE FUNCTION viberacing_private.enforce_account_update()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.agent_account_id <> OLD.agent_account_id
    OR NEW.profile_id <> OLD.profile_id
    OR NEW.provider_code <> OLD.provider_code
    OR NEW.accounting_revision <> OLD.accounting_revision
    OR NEW.scope_kind <> OLD.scope_kind
    OR NEW.fingerprint_kind <> OLD.fingerprint_kind
    OR NEW.account_fingerprint_digest IS DISTINCT FROM OLD.account_fingerprint_digest
    OR NEW.identity_assurance <> OLD.identity_assurance
    OR NEW.created_at <> OLD.created_at
    OR OLD.state = 'unlinked'
    OR (OLD.state = 'active' AND NEW.state NOT IN ('active', 'paused', 'quarantined', 'unlinked'))
    OR (OLD.state = 'paused' AND NEW.state NOT IN ('paused', 'active', 'unlinked'))
    OR (OLD.state = 'quarantined' AND NEW.state NOT IN ('quarantined', 'unlinked'))
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state THEN
    NEW.state_changed_at := pg_catalog.clock_timestamp();
    IF NEW.state = 'quarantined' THEN
      NEW.quarantined_at := NEW.state_changed_at;
    ELSIF NEW.state = 'unlinked' THEN
      NEW.unlinked_at := NEW.state_changed_at;
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER agent_accounts_enforce_update
BEFORE UPDATE ON viberacing_private.agent_accounts
FOR EACH ROW EXECUTE FUNCTION viberacing_private.enforce_account_update();

CREATE FUNCTION viberacing_private.enforce_installation_update()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.installation_id <> OLD.installation_id
    OR NEW.installation_public_key <> OLD.installation_public_key
    OR NEW.created_at <> OLD.created_at
    OR (OLD.profile_id IS NOT NULL AND NEW.profile_id IS DISTINCT FROM OLD.profile_id)
    OR OLD.state = 'revoked'
    OR (OLD.state = 'pending' AND NEW.state NOT IN ('pending', 'active', 'revoked'))
    OR (OLD.state = 'active' AND NEW.state NOT IN ('active', 'revoked'))
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER connector_installations_enforce_update
BEFORE UPDATE ON viberacing_private.connector_installations
FOR EACH ROW EXECUTE FUNCTION viberacing_private.enforce_installation_update();

CREATE FUNCTION viberacing_private.enforce_device_key_update()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.device_key_id <> OLD.device_key_id
    OR NEW.device_id <> OLD.device_id
    OR NEW.profile_id <> OLD.profile_id
    OR NEW.installation_id <> OLD.installation_id
    OR NEW.agent_account_id <> OLD.agent_account_id
    OR NEW.public_key <> OLD.public_key
    OR NEW.created_at <> OLD.created_at
    OR NEW.activated_at <> OLD.activated_at
    OR OLD.state = 'revoked'
    OR (OLD.state = 'active' AND NEW.state NOT IN ('active', 'revoked'))
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER device_keys_enforce_update
BEFORE UPDATE ON viberacing_private.device_keys
FOR EACH ROW EXECUTE FUNCTION viberacing_private.enforce_device_key_update();

CREATE FUNCTION viberacing_private.enforce_pairing_update()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.pairing_id <> OLD.pairing_id
    OR NEW.installation_id <> OLD.installation_id
    OR NEW.manifest_digest <> OLD.manifest_digest
    OR NEW.start_proof_digest <> OLD.start_proof_digest
    OR NEW.poll_verifier_digest <> OLD.poll_verifier_digest
    OR NEW.user_code_verifier_digest <> OLD.user_code_verifier_digest
    OR NEW.possession_challenge <> OLD.possession_challenge
    OR NEW.created_at <> OLD.created_at
    OR NEW.expires_at <> OLD.expires_at
    OR (OLD.profile_id IS NOT NULL AND NEW.profile_id IS DISTINCT FROM OLD.profile_id)
    OR OLD.state IN ('activated', 'rejected', 'expired')
    OR (OLD.state = 'pending' AND NEW.state NOT IN ('pending', 'approved', 'rejected', 'expired'))
    OR (OLD.state = 'approved' AND NEW.state NOT IN ('approved', 'activated', 'expired'))
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER pairing_transactions_enforce_update
BEFORE UPDATE ON viberacing_private.pairing_transactions
FOR EACH ROW EXECUTE FUNCTION viberacing_private.enforce_pairing_update();

CREATE FUNCTION viberacing_private.enforce_pairing_candidate_update()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.pairing_id <> OLD.pairing_id
    OR NEW.candidate_id <> OLD.candidate_id
    OR NEW.provider_code <> OLD.provider_code
    OR NEW.reader_version <> OLD.reader_version
    OR NEW.accounting_revision <> OLD.accounting_revision
    OR NEW.scope_kind <> OLD.scope_kind
    OR NEW.fingerprint_kind <> OLD.fingerprint_kind
    OR NEW.fingerprint_digest IS DISTINCT FROM OLD.fingerprint_digest
    OR NEW.proposed_sync_public_key <> OLD.proposed_sync_public_key
    OR NEW.safe_local_display_label <> OLD.safe_local_display_label
    OR NEW.preview_current_week_token_total <> OLD.preview_current_week_token_total
    OR NEW.preview_last_usage_date IS DISTINCT FROM OLD.preview_last_usage_date
    OR NEW.preview_status <> OLD.preview_status
    OR OLD.decision <> 'pending'
    OR NEW.decision = 'pending'
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER pairing_candidates_enforce_update
BEFORE UPDATE ON viberacing_private.pairing_candidates
FOR EACH ROW EXECUTE FUNCTION viberacing_private.enforce_pairing_candidate_update();

CREATE FUNCTION viberacing_private.enforce_accounting_revision_update()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM viberacing_private.agent_accounts AS account
    WHERE account.provider_code = OLD.provider_code
      AND account.accounting_revision = OLD.accounting_revision
  ) AND (
    NEW.provider_code <> OLD.provider_code
    OR NEW.accounting_revision <> OLD.accounting_revision
    OR NEW.reader_contract_version <> OLD.reader_contract_version
    OR NEW.scope_kind <> OLD.scope_kind
    OR NEW.utc_date_semantics <> OLD.utc_date_semantics
    OR NEW.maximum_backfill_days <> OLD.maximum_backfill_days
    OR NEW.minimum_connector_version <> OLD.minimum_connector_version
    OR NEW.created_at <> OLD.created_at
  ) THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER agent_accounting_revisions_enforce_update
BEFORE UPDATE ON viberacing_private.agent_accounting_revisions
FOR EACH ROW EXECUTE FUNCTION viberacing_private.enforce_accounting_revision_update();

CREATE FUNCTION viberacing_api.admit_pairing_transport_request(
  p_operation text,
  p_client_identity_digest bytea,
  p_global_limit integer,
  p_bucket_limit integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '5s'
AS $function$
DECLARE
  now_at timestamptz(3) := pg_catalog.statement_timestamp();
  client_bucket smallint;
  global_allowed boolean;
  bucket_allowed boolean;
BEGIN
  IF p_operation IS NULL
    OR p_operation NOT IN ('start', 'poll')
    OR pg_catalog.octet_length(p_client_identity_digest) IS DISTINCT FROM 32
    OR p_global_limit IS NULL
    OR p_global_limit NOT BETWEEN 1 AND 1000000
    OR p_bucket_limit IS NULL
    OR p_bucket_limit NOT BETWEEN 1 AND p_global_limit
    OR p_window_seconds IS NULL
    OR p_window_seconds NOT BETWEEN 1 AND 3600 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  client_bucket := (pg_catalog.get_byte(p_client_identity_digest, 0) % 64)::smallint;

  -- Every caller takes the operation-global row before its fixed client bucket. The two-row
  -- deterministic order prevents deadlocks and counts saturate one above the accepted maximum.
  UPDATE viberacing_private.pairing_request_windows AS window_record
  SET
    window_started_at = CASE
      WHEN window_record.window_started_at
        + pg_catalog.make_interval(secs => p_window_seconds) <= now_at
        THEN now_at
      ELSE window_record.window_started_at
    END,
    attempt_count = CASE
      WHEN window_record.window_started_at
        + pg_catalog.make_interval(secs => p_window_seconds) <= now_at
        THEN 1
      ELSE LEAST(window_record.attempt_count + 1, 1000001)
    END
  WHERE window_record.operation = p_operation
    AND window_record.bucket = -1
  RETURNING window_record.attempt_count <= p_global_limit
  INTO global_allowed;

  UPDATE viberacing_private.pairing_request_windows AS window_record
  SET
    window_started_at = CASE
      WHEN window_record.window_started_at
        + pg_catalog.make_interval(secs => p_window_seconds) <= now_at
        THEN now_at
      ELSE window_record.window_started_at
    END,
    attempt_count = CASE
      WHEN window_record.window_started_at
        + pg_catalog.make_interval(secs => p_window_seconds) <= now_at
        THEN 1
      ELSE LEAST(window_record.attempt_count + 1, 1000001)
    END
  WHERE window_record.operation = p_operation
    AND window_record.bucket = client_bucket
  RETURNING window_record.attempt_count <= p_bucket_limit
  INTO bucket_allowed;

  IF global_allowed IS NULL OR bucket_allowed IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  RETURN global_allowed AND bucket_allowed;
EXCEPTION
  WHEN data_exception OR integrity_constraint_violation OR lock_not_available THEN
    PERFORM viberacing_private.operation_failed();
    RETURN false;
END
$function$;

CREATE FUNCTION viberacing_api.start_pairing_batch(
  p_pairing_id text,
  p_installation_id text,
  p_installation_public_key bytea,
  p_installation_label text,
  p_connector_version text,
  p_os_family text,
  p_architecture text,
  p_manifest_digest bytea,
  p_start_proof_digest bytea,
  p_poll_verifier_digest bytea,
  p_user_code_verifier_digest bytea,
  p_possession_challenge bytea,
  p_expires_at timestamptz,
  p_candidates jsonb
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_candidate jsonb;
  v_fingerprint bytea;
  v_installation viberacing_private.connector_installations%ROWTYPE;
  v_key bytea;
  v_key_count integer;
  v_revision integer;
BEGIN
  IF p_pairing_id IS NULL
    OR p_installation_id IS NULL
    OR p_candidates IS NULL
    OR p_manifest_digest IS NULL
    OR p_start_proof_digest IS NULL
    OR p_poll_verifier_digest IS NULL
    OR p_user_code_verifier_digest IS NULL
    OR p_possession_challenge IS NULL
    OR p_pairing_id !~ '^pair_[A-Za-z0-9_-]{22}$'
    OR p_installation_id !~ '^ins_[A-Za-z0-9_-]{22}$'
    OR pg_catalog.octet_length(p_installation_public_key) <> 32
    OR pg_catalog.octet_length(p_manifest_digest) <> 32
    OR pg_catalog.octet_length(p_start_proof_digest) <> 32
    OR pg_catalog.octet_length(p_poll_verifier_digest) <> 32
    OR pg_catalog.octet_length(p_user_code_verifier_digest) <> 32
    OR pg_catalog.octet_length(p_possession_challenge) <> 32
    OR p_expires_at <= pg_catalog.transaction_timestamp()
    OR p_expires_at > pg_catalog.transaction_timestamp() + interval '10 minutes'
    OR pg_catalog.jsonb_typeof(p_candidates) <> 'array'
    OR pg_catalog.jsonb_array_length(p_candidates) NOT BETWEEN 1 AND 16
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  INSERT INTO viberacing_private.connector_installations (
    installation_id,
    installation_public_key,
    label,
    connector_version,
    os_family,
    architecture
  )
  VALUES (
    p_installation_id,
    p_installation_public_key,
    p_installation_label,
    p_connector_version,
    p_os_family,
    p_architecture
  )
  ON CONFLICT (installation_id) DO NOTHING;

  SELECT installation.*
  INTO v_installation
  FROM viberacing_private.connector_installations AS installation
  WHERE installation.installation_id = p_installation_id
  FOR UPDATE;

  IF v_installation.installation_id IS NULL
    OR v_installation.installation_public_key <> p_installation_public_key
    OR v_installation.label <> p_installation_label
    OR v_installation.connector_version <> p_connector_version
    OR v_installation.os_family <> p_os_family
    OR v_installation.architecture <> p_architecture
    OR v_installation.state = 'revoked'
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.pairing_transactions
  SET state = 'expired'
  WHERE installation_id = p_installation_id
    AND state IN ('pending', 'approved')
    AND expires_at <= pg_catalog.transaction_timestamp();

  INSERT INTO viberacing_private.pairing_transactions (
    pairing_id,
    installation_id,
    manifest_digest,
    start_proof_digest,
    poll_verifier_digest,
    user_code_verifier_digest,
    possession_challenge,
    expires_at
  )
  VALUES (
    p_pairing_id,
    p_installation_id,
    p_manifest_digest,
    p_start_proof_digest,
    p_poll_verifier_digest,
    p_user_code_verifier_digest,
    p_possession_challenge,
    p_expires_at
  );

  FOR v_candidate IN SELECT value FROM pg_catalog.jsonb_array_elements(p_candidates)
  LOOP
    IF pg_catalog.jsonb_typeof(v_candidate) <> 'object' THEN
      PERFORM viberacing_private.operation_failed();
    END IF;
    SELECT pg_catalog.count(*)::integer
    INTO v_key_count
    FROM pg_catalog.jsonb_object_keys(v_candidate);

    IF v_key_count <> 10
      OR NOT v_candidate ?& ARRAY[
        'candidateId',
        'provider',
        'readerVersion',
        'accountingRevision',
        'scopeKind',
        'fingerprintKind',
        'fingerprintDigest',
        'syncPublicKey',
        'displayLabel',
        'preview'
      ]
      OR pg_catalog.jsonb_typeof(v_candidate -> 'candidateId') <> 'string'
      OR pg_catalog.jsonb_typeof(v_candidate -> 'provider') <> 'string'
      OR pg_catalog.jsonb_typeof(v_candidate -> 'readerVersion') <> 'string'
      OR pg_catalog.jsonb_typeof(v_candidate -> 'scopeKind') <> 'string'
      OR pg_catalog.jsonb_typeof(v_candidate -> 'fingerprintKind') <> 'string'
      OR pg_catalog.jsonb_typeof(v_candidate -> 'syncPublicKey') <> 'string'
      OR pg_catalog.jsonb_typeof(v_candidate -> 'displayLabel') <> 'string'
      OR pg_catalog.jsonb_typeof(v_candidate -> 'preview') <> 'object'
      OR (v_candidate ->> 'candidateId') !~ '^cand_[A-Za-z0-9_-]{22}$'
      OR (v_candidate ->> 'provider') NOT IN (
        'codex',
        'claude_code',
        'opencode',
        'qwen_code',
        'cline',
        'aider'
      )
      OR (v_candidate ->> 'readerVersion') !~ '^[a-z][a-z0-9_]{2,63}$'
      OR pg_catalog.jsonb_typeof(v_candidate -> 'accountingRevision') <> 'number'
      OR (v_candidate ->> 'accountingRevision') !~ '^[1-9][0-9]{0,5}$'
      OR (v_candidate ->> 'scopeKind') <> 'agent_account'
      OR (v_candidate ->> 'fingerprintKind') NOT IN (
        'stable_opaque',
        'unavailable'
      )
      OR (v_candidate ->> 'syncPublicKey') !~ '^[a-f0-9]{64}$'
      OR pg_catalog.length(v_candidate ->> 'displayLabel') NOT BETWEEN 1 AND 64
      OR (v_candidate ->> 'displayLabel') ~ '[[:cntrl:]]'
      OR (
        SELECT pg_catalog.count(*)
        FROM pg_catalog.jsonb_object_keys(v_candidate -> 'preview')
      ) <> 3
      OR NOT (v_candidate -> 'preview') ?& ARRAY[
        'currentWeekTokenTotal',
        'lastUsageDate',
        'status'
      ]
      OR pg_catalog.jsonb_typeof(
        v_candidate -> 'preview' -> 'currentWeekTokenTotal'
      ) <> 'string'
      OR (v_candidate -> 'preview' ->> 'currentWeekTokenTotal')
        !~ '^(0|[1-9][0-9]{0,59})$'
      OR pg_catalog.jsonb_typeof(v_candidate -> 'preview' -> 'status') <> 'string'
      OR (v_candidate -> 'preview' ->> 'status') NOT IN (
        'ready',
        'incomplete_period',
        'reader_error',
        'unavailable',
        'unsupported_scope',
        'unsupported_version'
      )
      OR (
        pg_catalog.jsonb_typeof(v_candidate -> 'preview' -> 'lastUsageDate')
          NOT IN ('string', 'null')
      )
      OR (
        pg_catalog.jsonb_typeof(v_candidate -> 'preview' -> 'lastUsageDate') = 'string'
        AND (v_candidate -> 'preview' ->> 'lastUsageDate')
          !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
      )
    THEN
      PERFORM viberacing_private.operation_failed();
    END IF;

    v_revision := (v_candidate ->> 'accountingRevision')::integer;
    v_key := pg_catalog.decode(v_candidate ->> 'syncPublicKey', 'hex');
    IF (v_candidate ->> 'fingerprintKind') = 'unavailable' THEN
      IF pg_catalog.jsonb_typeof(v_candidate -> 'fingerprintDigest') <> 'null' THEN
        PERFORM viberacing_private.operation_failed();
      END IF;
      v_fingerprint := NULL;
    ELSE
      IF (v_candidate ->> 'fingerprintDigest') !~ '^[a-f0-9]{64}$' THEN
        PERFORM viberacing_private.operation_failed();
      END IF;
      v_fingerprint := pg_catalog.decode(v_candidate ->> 'fingerprintDigest', 'hex');
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM viberacing_private.agent_providers AS provider
      JOIN viberacing_private.agent_accounting_revisions AS revision
        ON revision.provider_code = provider.provider_code
      WHERE provider.provider_code = v_candidate ->> 'provider'
        AND provider.state = 'supported'
        AND revision.accounting_revision = v_revision
        AND revision.reader_contract_version = v_candidate ->> 'readerVersion'
        AND revision.scope_kind = 'agent_account'
        AND revision.enabled_for_new_accounts
    ) THEN
      PERFORM viberacing_private.operation_failed();
    END IF;

    INSERT INTO viberacing_private.pairing_candidates (
      pairing_id,
      candidate_id,
      provider_code,
      reader_version,
      accounting_revision,
      scope_kind,
      fingerprint_kind,
      fingerprint_digest,
      proposed_sync_public_key,
      safe_local_display_label,
      preview_current_week_token_total,
      preview_last_usage_date,
      preview_status
    )
    VALUES (
      p_pairing_id,
      v_candidate ->> 'candidateId',
      v_candidate ->> 'provider',
      v_candidate ->> 'readerVersion',
      v_revision,
      v_candidate ->> 'scopeKind',
      v_candidate ->> 'fingerprintKind',
      v_fingerprint,
      v_key,
      v_candidate ->> 'displayLabel',
      v_candidate -> 'preview' ->> 'currentWeekTokenTotal',
      CASE
        WHEN pg_catalog.jsonb_typeof(v_candidate -> 'preview' -> 'lastUsageDate') = 'null'
        THEN NULL
        ELSE (v_candidate -> 'preview' ->> 'lastUsageDate')::date
      END,
      v_candidate -> 'preview' ->> 'status'
    );
  END LOOP;

  RETURN p_pairing_id;
EXCEPTION
  WHEN unique_violation OR check_violation OR foreign_key_violation
    OR invalid_text_representation OR numeric_value_out_of_range
  THEN
    PERFORM viberacing_private.operation_failed();
END
$function$;

CREATE FUNCTION viberacing_api.read_pairing_batch_for_approval(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_pairing_id text
)
RETURNS TABLE (
  pairing_id text,
  installation_label text,
  connector_version text,
  os_family text,
  architecture text,
  installation_public_key bytea,
  manifest_digest bytea,
  expires_at timestamptz,
  candidate_id text,
  provider_code text,
  reader_version text,
  accounting_revision integer,
  fingerprint_kind text,
  fingerprint_digest bytea,
  safe_local_display_label text,
  preview_current_week_token_total text,
  preview_last_usage_date date,
  preview_status text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_profile_id uuid;
BEGIN
  v_profile_id := viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest
  );

  RETURN QUERY
  SELECT
    pairing.pairing_id::text,
    installation.label::text,
    installation.connector_version::text,
    installation.os_family::text,
    installation.architecture::text,
    installation.installation_public_key,
    pairing.manifest_digest,
    pairing.expires_at,
    candidate.candidate_id::text,
    candidate.provider_code::text,
    candidate.reader_version::text,
    candidate.accounting_revision,
    candidate.fingerprint_kind::text,
    candidate.fingerprint_digest,
    candidate.safe_local_display_label::text,
    candidate.preview_current_week_token_total::text,
    candidate.preview_last_usage_date,
    candidate.preview_status::text
  FROM viberacing_private.pairing_transactions AS pairing
  JOIN viberacing_private.connector_installations AS installation
    ON installation.installation_id = pairing.installation_id
  JOIN viberacing_private.pairing_candidates AS candidate
    ON candidate.pairing_id = pairing.pairing_id
  JOIN viberacing_private.profiles AS profile
    ON profile.profile_id = v_profile_id
  WHERE pairing.pairing_id = p_pairing_id
    AND pairing.state = 'pending'
    AND pairing.expires_at > pg_catalog.transaction_timestamp()
    AND profile.state = 'active'
  ORDER BY candidate.candidate_id;

  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
END
$function$;

CREATE FUNCTION viberacing_api.read_agent_accounts_for_pairing(
  p_session_id uuid,
  p_session_verifier_digest bytea
)
RETURNS TABLE (
  agent_account_id text,
  provider_code text,
  accounting_revision integer,
  scope_kind text,
  fingerprint_kind text,
  fingerprint_digest bytea,
  private_label text,
  account_state text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_profile_id uuid;
BEGIN
  v_profile_id := viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest
  );
  RETURN QUERY
  SELECT
    account.agent_account_id::text,
    account.provider_code::text,
    account.accounting_revision,
    account.scope_kind::text,
    account.fingerprint_kind::text,
    account.account_fingerprint_digest,
    account.private_label::text,
    account.state::text
  FROM viberacing_private.agent_accounts AS account
  WHERE account.profile_id = v_profile_id
    AND account.state IN ('active', 'paused')
  ORDER BY account.provider_code, account.created_at, account.agent_account_id
  LIMIT 128;
END
$function$;

CREATE FUNCTION viberacing_api.read_pairing_batch_by_code(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_primary_code_digest bytea,
  p_previous_code_digest bytea DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_pairing_id text;
  v_now timestamptz := pg_catalog.transaction_timestamp();
BEGIN
  PERFORM viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest
  );
  IF pg_catalog.octet_length(p_primary_code_digest) <> 32
    OR (
      p_previous_code_digest IS NOT NULL
      AND pg_catalog.octet_length(p_previous_code_digest) <> 32
    )
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  INSERT INTO viberacing_private.pairing_code_attempt_windows (
    session_id,
    window_started_at,
    attempt_count,
    updated_at
  )
  VALUES (p_session_id, v_now, 1, v_now)
  ON CONFLICT (session_id) DO UPDATE
  SET window_started_at = CASE
        WHEN pairing_code_attempt_windows.window_started_at <= v_now - interval '15 minutes'
        THEN v_now
        ELSE pairing_code_attempt_windows.window_started_at
      END,
      attempt_count = CASE
        WHEN pairing_code_attempt_windows.window_started_at <= v_now - interval '15 minutes'
        THEN 1
        ELSE pairing_code_attempt_windows.attempt_count + 1
      END,
      updated_at = v_now
  WHERE pairing_code_attempt_windows.window_started_at <= v_now - interval '15 minutes'
    OR pairing_code_attempt_windows.attempt_count < 10;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT pairing.pairing_id
  INTO v_pairing_id
  FROM viberacing_private.pairing_transactions AS pairing
  WHERE pairing.state = 'pending'
    AND pairing.expires_at > v_now
    AND pairing.user_code_verifier_digest IN (
      p_primary_code_digest,
      p_previous_code_digest
    )
  FOR UPDATE;

  RETURN v_pairing_id;
END
$function$;

CREATE FUNCTION viberacing_api.approve_pairing_batch(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_pairing_id text,
  p_manifest_digest bytea,
  p_context_digest bytea,
  p_challenge_id uuid,
  p_verified_passkey_id uuid,
  p_new_sign_count bigint,
  p_backup_state boolean,
  p_decisions jsonb
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_created_account_id text;
  v_decision jsonb;
  v_decision_count integer;
  v_key_count integer;
  v_pairing viberacing_private.pairing_transactions%ROWTYPE;
  v_candidate viberacing_private.pairing_candidates%ROWTYPE;
  v_profile_id uuid;
  v_target_account_id text;
BEGIN
  IF p_decisions IS NULL
    OR p_manifest_digest IS NULL
    OR p_context_digest IS NULL
    OR pg_catalog.jsonb_typeof(p_decisions) <> 'array'
    OR pg_catalog.jsonb_array_length(p_decisions) NOT BETWEEN 1 AND 16
    OR pg_catalog.octet_length(p_manifest_digest) <> 32
    OR pg_catalog.octet_length(p_context_digest) <> 32
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT pairing.*
  INTO v_pairing
  FROM viberacing_private.pairing_transactions AS pairing
  WHERE pairing.pairing_id = p_pairing_id
  FOR UPDATE;

  IF v_pairing.pairing_id IS NULL
    OR v_pairing.state <> 'pending'
    OR v_pairing.expires_at <= pg_catalog.transaction_timestamp()
    OR v_pairing.manifest_digest <> p_manifest_digest
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  v_profile_id := viberacing_api.consume_auth_challenge(
    p_session_id,
    p_session_verifier_digest,
    p_challenge_id,
    'pairing_batch_approval',
    p_context_digest,
    p_verified_passkey_id,
    p_new_sign_count,
    p_backup_state
  );

  SELECT pg_catalog.count(*)::integer
  INTO v_decision_count
  FROM viberacing_private.pairing_candidates
  WHERE pairing_id = p_pairing_id;
  IF v_decision_count <> pg_catalog.jsonb_array_length(p_decisions) THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  FOR v_decision IN SELECT value FROM pg_catalog.jsonb_array_elements(p_decisions)
  LOOP
    IF pg_catalog.jsonb_typeof(v_decision) <> 'object' THEN
      PERFORM viberacing_private.operation_failed();
    END IF;
    SELECT pg_catalog.count(*)::integer
    INTO v_key_count
    FROM pg_catalog.jsonb_object_keys(v_decision);
    IF v_key_count <> 7
      OR NOT v_decision ?& ARRAY[
        'candidateId',
        'decision',
        'targetAgentAccountId',
        'newAgentAccountId',
        'deviceKeyId',
        'deviceId',
        'privateLabel'
      ]
      OR pg_catalog.jsonb_typeof(v_decision -> 'candidateId') <> 'string'
      OR pg_catalog.jsonb_typeof(v_decision -> 'decision') <> 'string'
      OR (v_decision ->> 'candidateId') !~ '^cand_[A-Za-z0-9_-]{22}$'
      OR (v_decision ->> 'decision') NOT IN ('create', 'attach_existing', 'skip')
    THEN
      PERFORM viberacing_private.operation_failed();
    END IF;

    SELECT candidate.*
    INTO v_candidate
    FROM viberacing_private.pairing_candidates AS candidate
    WHERE candidate.pairing_id = p_pairing_id
      AND candidate.candidate_id = v_decision ->> 'candidateId'
      AND candidate.decision = 'pending'
    FOR UPDATE;
    IF v_candidate.candidate_id IS NULL THEN
      PERFORM viberacing_private.operation_failed();
    END IF;

    IF (v_decision ->> 'decision') = 'skip' THEN
      IF pg_catalog.jsonb_typeof(v_decision -> 'targetAgentAccountId') <> 'null'
        OR pg_catalog.jsonb_typeof(v_decision -> 'newAgentAccountId') <> 'null'
        OR pg_catalog.jsonb_typeof(v_decision -> 'deviceKeyId') <> 'null'
        OR pg_catalog.jsonb_typeof(v_decision -> 'deviceId') <> 'null'
        OR pg_catalog.jsonb_typeof(v_decision -> 'privateLabel') <> 'null'
      THEN
        PERFORM viberacing_private.operation_failed();
      END IF;
      UPDATE viberacing_private.pairing_candidates
      SET decision = 'skip'
      WHERE pairing_id = p_pairing_id
        AND candidate_id = v_candidate.candidate_id;
      CONTINUE;
    END IF;

    IF (v_decision ->> 'deviceKeyId') !~ '^key_[A-Za-z0-9_-]{22}$'
      OR (v_decision ->> 'deviceId') !~ '^dev_[A-Za-z0-9_-]{22}$'
      OR pg_catalog.jsonb_typeof(v_decision -> 'deviceKeyId') <> 'string'
      OR pg_catalog.jsonb_typeof(v_decision -> 'deviceId') <> 'string'
    THEN
      PERFORM viberacing_private.operation_failed();
    END IF;

    IF (v_decision ->> 'decision') = 'create' THEN
      IF pg_catalog.jsonb_typeof(v_decision -> 'targetAgentAccountId') <> 'null'
        OR (v_decision ->> 'newAgentAccountId') !~ '^acc_[A-Za-z0-9_-]{22}$'
        OR pg_catalog.jsonb_typeof(v_decision -> 'newAgentAccountId') <> 'string'
        OR pg_catalog.jsonb_typeof(v_decision -> 'privateLabel') <> 'string'
        OR pg_catalog.length(v_decision ->> 'privateLabel') NOT BETWEEN 1 AND 64
        OR (v_decision ->> 'privateLabel') ~ '[[:cntrl:]]'
      THEN
        PERFORM viberacing_private.operation_failed();
      END IF;
      v_created_account_id := v_decision ->> 'newAgentAccountId';

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
      SELECT
        v_created_account_id,
        v_profile_id,
        v_candidate.provider_code,
        v_candidate.accounting_revision,
        v_candidate.scope_kind,
        v_candidate.fingerprint_kind,
        v_candidate.fingerprint_digest,
        v_decision ->> 'privateLabel',
        CASE
          WHEN v_candidate.fingerprint_kind = 'provider_verified'
          THEN 'provider_verified'
          ELSE 'community_local'
        END
      FROM viberacing_private.agent_providers AS provider
      JOIN viberacing_private.agent_accounting_revisions AS revision
        ON revision.provider_code = provider.provider_code
      WHERE provider.provider_code = v_candidate.provider_code
        AND provider.state = 'supported'
        AND revision.accounting_revision = v_candidate.accounting_revision
        AND revision.scope_kind = v_candidate.scope_kind
        AND revision.reader_contract_version = v_candidate.reader_version
        AND revision.enabled_for_new_accounts;
      IF NOT FOUND THEN
        PERFORM viberacing_private.operation_failed();
      END IF;
      v_target_account_id := v_created_account_id;
    ELSE
      IF pg_catalog.jsonb_typeof(v_decision -> 'newAgentAccountId') <> 'null'
        OR pg_catalog.jsonb_typeof(v_decision -> 'privateLabel') <> 'null'
        OR pg_catalog.jsonb_typeof(v_decision -> 'targetAgentAccountId') <> 'string'
        OR (v_decision ->> 'targetAgentAccountId') !~ '^acc_[A-Za-z0-9_-]{22}$'
      THEN
        PERFORM viberacing_private.operation_failed();
      END IF;
      v_target_account_id := v_decision ->> 'targetAgentAccountId';
      IF NOT EXISTS (
        SELECT 1
        FROM viberacing_private.agent_accounts AS account
        WHERE account.agent_account_id = v_target_account_id
          AND account.profile_id = v_profile_id
          AND account.provider_code = v_candidate.provider_code
          AND account.accounting_revision = v_candidate.accounting_revision
          AND account.scope_kind = v_candidate.scope_kind
          AND account.state IN ('active', 'paused')
          AND (
            v_candidate.fingerprint_kind = 'unavailable'
            OR (
              account.fingerprint_kind = v_candidate.fingerprint_kind
              AND account.account_fingerprint_digest = v_candidate.fingerprint_digest
            )
          )
      ) THEN
        PERFORM viberacing_private.operation_failed();
      END IF;
    END IF;

    UPDATE viberacing_private.pairing_candidates
    SET decision = v_decision ->> 'decision',
        target_agent_account_id = v_target_account_id,
        approved_device_key_id = v_decision ->> 'deviceKeyId',
        approved_device_id = v_decision ->> 'deviceId'
    WHERE pairing_id = p_pairing_id
      AND candidate_id = v_candidate.candidate_id;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM viberacing_private.pairing_candidates
    WHERE pairing_id = p_pairing_id
      AND decision = 'pending'
  ) THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.connector_installations
  SET profile_id = v_profile_id
  WHERE installation_id = v_pairing.installation_id
    AND state = 'pending'
    AND profile_id IS NULL;
  IF NOT FOUND AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.connector_installations AS installation
    WHERE installation.installation_id = v_pairing.installation_id
      AND installation.profile_id = v_profile_id
      AND installation.state = 'active'
  ) THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.pairing_transactions
  SET profile_id = v_profile_id,
      state = 'approved',
      approved_at = pg_catalog.transaction_timestamp(),
      approved_by_session_id = p_session_id,
      approved_by_passkey_id = p_verified_passkey_id
  WHERE pairing_id = p_pairing_id
    AND state = 'pending';
  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  RETURN (
    SELECT pg_catalog.count(*)::integer
    FROM viberacing_private.pairing_candidates
    WHERE pairing_id = p_pairing_id
      AND decision <> 'skip'
  );
EXCEPTION
  WHEN unique_violation OR check_violation OR foreign_key_violation
    OR invalid_text_representation OR numeric_value_out_of_range
  THEN
    PERFORM viberacing_private.operation_failed();
END
$function$;

CREATE FUNCTION viberacing_api.read_pairing_possession_material(
  p_pairing_id text,
  p_poll_verifier_digest bytea
)
RETURNS TABLE (
  installation_public_key bytea,
  possession_challenge bytea,
  manifest_digest bytea,
  pairing_state text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT
    installation.installation_public_key,
    pairing.possession_challenge,
    pairing.manifest_digest,
    pairing.state::text
  FROM viberacing_private.pairing_transactions AS pairing
  JOIN viberacing_private.connector_installations AS installation
    ON installation.installation_id = pairing.installation_id
  WHERE pairing.pairing_id = p_pairing_id
    AND pairing.poll_verifier_digest = p_poll_verifier_digest
    AND pairing.state IN ('pending', 'approved', 'activated', 'rejected', 'expired')
  LIMIT 1
$function$;

CREATE FUNCTION viberacing_api.activate_pairing_batch(
  p_pairing_id text,
  p_poll_verifier_digest bytea
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_pairing viberacing_private.pairing_transactions%ROWTYPE;
  v_expected_count integer;
  v_inserted_count integer;
BEGIN
  SELECT pairing.*
  INTO v_pairing
  FROM viberacing_private.pairing_transactions AS pairing
  WHERE pairing.pairing_id = p_pairing_id
    AND pairing.poll_verifier_digest = p_poll_verifier_digest
  FOR UPDATE;

  IF v_pairing.pairing_id IS NULL
    OR v_pairing.state NOT IN ('approved', 'activated')
    OR v_pairing.expires_at <= pg_catalog.transaction_timestamp()
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO v_expected_count
  FROM viberacing_private.pairing_candidates
  WHERE pairing_id = p_pairing_id
    AND decision IN ('create', 'attach_existing');

  IF v_pairing.state = 'activated' THEN
    RETURN v_expected_count;
  END IF;

  INSERT INTO viberacing_private.device_keys (
    device_key_id,
    device_id,
    profile_id,
    installation_id,
    agent_account_id,
    public_key
  )
  SELECT
    candidate.approved_device_key_id,
    candidate.approved_device_id,
    v_pairing.profile_id,
    v_pairing.installation_id,
    candidate.target_agent_account_id,
    candidate.proposed_sync_public_key
  FROM viberacing_private.pairing_candidates AS candidate
  WHERE candidate.pairing_id = p_pairing_id
    AND candidate.decision IN ('create', 'attach_existing');
  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  IF v_inserted_count <> v_expected_count THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.connector_installations
  SET state = 'active',
      activated_at = pg_catalog.transaction_timestamp(),
      last_seen_at = pg_catalog.transaction_timestamp()
  WHERE installation_id = v_pairing.installation_id
    AND profile_id = v_pairing.profile_id
    AND state = 'pending';
  IF NOT FOUND AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.connector_installations AS installation
    WHERE installation.installation_id = v_pairing.installation_id
      AND installation.profile_id = v_pairing.profile_id
      AND installation.state = 'active'
  ) THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.connector_installations
  SET last_seen_at = pg_catalog.transaction_timestamp()
  WHERE installation_id = v_pairing.installation_id
    AND profile_id = v_pairing.profile_id
    AND state = 'active';

  UPDATE viberacing_private.pairing_transactions
  SET state = 'activated',
      activated_at = pg_catalog.transaction_timestamp()
  WHERE pairing_id = p_pairing_id
    AND state = 'approved';
  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  RETURN v_inserted_count;
END
$function$;

CREATE FUNCTION viberacing_api.poll_pairing_batch(
  p_pairing_id text,
  p_poll_verifier_digest bytea
)
RETURNS TABLE (
  pairing_state text,
  candidate_id text,
  activation_state text,
  agent_account_id text,
  device_id text,
  device_key_id text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT
    CASE
      WHEN pairing.expires_at <= pg_catalog.transaction_timestamp()
        AND pairing.state IN ('pending', 'approved')
      THEN 'expired'
      ELSE pairing.state
    END::text,
    CASE
      WHEN candidate.candidate_id IS NULL THEN NULL
      ELSE candidate.candidate_id::text
    END,
    CASE
      WHEN candidate.decision = 'skip' THEN 'skipped'
      WHEN pairing.state = 'activated'
        AND candidate.decision IN ('create', 'attach_existing')
      THEN 'active'
      ELSE 'pending'
    END::text,
    CASE
      WHEN pairing.state = 'activated' THEN candidate.target_agent_account_id::text
      ELSE NULL
    END,
    CASE
      WHEN pairing.state = 'activated' THEN candidate.approved_device_id::text
      ELSE NULL
    END,
    CASE
      WHEN pairing.state = 'activated' THEN candidate.approved_device_key_id::text
      ELSE NULL
    END
  FROM viberacing_private.pairing_transactions AS pairing
  LEFT JOIN viberacing_private.pairing_candidates AS candidate
    ON candidate.pairing_id = pairing.pairing_id
  WHERE pairing.pairing_id = p_pairing_id
    AND pairing.poll_verifier_digest = p_poll_verifier_digest
  ORDER BY candidate.candidate_id
$function$;

CREATE FUNCTION viberacing_api.pause_agent_account(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_agent_account_id text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_profile_id uuid;
BEGIN
  v_profile_id := viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest
  );
  UPDATE viberacing_private.agent_accounts
  SET state = 'paused'
  WHERE agent_account_id = p_agent_account_id
    AND profile_id = v_profile_id
    AND state = 'active';
  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
END
$function$;

CREATE FUNCTION viberacing_api.reactivate_agent_account(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_challenge_id uuid,
  p_context_digest bytea,
  p_verified_passkey_id uuid,
  p_new_sign_count bigint,
  p_backup_state boolean,
  p_agent_account_id text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_profile_id uuid;
BEGIN
  v_profile_id := viberacing_api.consume_auth_challenge(
    p_session_id,
    p_session_verifier_digest,
    p_challenge_id,
    'account_reactivate',
    p_context_digest,
    p_verified_passkey_id,
    p_new_sign_count,
    p_backup_state
  );
  UPDATE viberacing_private.agent_accounts
  SET state = 'active'
  WHERE agent_account_id = p_agent_account_id
    AND profile_id = v_profile_id
    AND state = 'paused';
  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
END
$function$;

CREATE FUNCTION viberacing_api.unlink_agent_account(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_challenge_id uuid,
  p_context_digest bytea,
  p_verified_passkey_id uuid,
  p_new_sign_count bigint,
  p_backup_state boolean,
  p_agent_account_id text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_profile_id uuid;
BEGIN
  v_profile_id := viberacing_api.consume_auth_challenge(
    p_session_id,
    p_session_verifier_digest,
    p_challenge_id,
    'account_unlink',
    p_context_digest,
    p_verified_passkey_id,
    p_new_sign_count,
    p_backup_state
  );
  UPDATE viberacing_private.agent_accounts
  SET state = 'unlinked'
  WHERE agent_account_id = p_agent_account_id
    AND profile_id = v_profile_id
    AND state IN ('active', 'paused', 'quarantined');
  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
  UPDATE viberacing_private.device_keys
  SET state = 'revoked',
      revoked_at = pg_catalog.transaction_timestamp()
  WHERE agent_account_id = p_agent_account_id
    AND profile_id = v_profile_id
    AND state = 'active';
END
$function$;

CREATE FUNCTION viberacing_api.revoke_device_key(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_challenge_id uuid,
  p_context_digest bytea,
  p_verified_passkey_id uuid,
  p_new_sign_count bigint,
  p_backup_state boolean,
  p_device_id text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_profile_id uuid;
BEGIN
  v_profile_id := viberacing_api.consume_auth_challenge(
    p_session_id,
    p_session_verifier_digest,
    p_challenge_id,
    'device_revoke',
    p_context_digest,
    p_verified_passkey_id,
    p_new_sign_count,
    p_backup_state
  );
  UPDATE viberacing_private.device_keys
  SET state = 'revoked',
      revoked_at = pg_catalog.transaction_timestamp()
  WHERE device_id = p_device_id
    AND profile_id = v_profile_id
    AND state = 'active';
  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
END
$function$;

CREATE FUNCTION viberacing_api.revoke_connector_installation(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_challenge_id uuid,
  p_context_digest bytea,
  p_verified_passkey_id uuid,
  p_new_sign_count bigint,
  p_backup_state boolean,
  p_installation_id text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_profile_id uuid;
  v_revoked_count integer;
BEGIN
  v_profile_id := viberacing_api.consume_auth_challenge(
    p_session_id,
    p_session_verifier_digest,
    p_challenge_id,
    'installation_revoke',
    p_context_digest,
    p_verified_passkey_id,
    p_new_sign_count,
    p_backup_state
  );
  UPDATE viberacing_private.connector_installations
  SET state = 'revoked',
      revoked_at = pg_catalog.transaction_timestamp()
  WHERE installation_id = p_installation_id
    AND profile_id = v_profile_id
    AND state = 'active';
  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
  UPDATE viberacing_private.device_keys
  SET state = 'revoked',
      revoked_at = pg_catalog.transaction_timestamp()
  WHERE installation_id = p_installation_id
    AND profile_id = v_profile_id
    AND state = 'active';
  GET DIAGNOSTICS v_revoked_count = ROW_COUNT;
  RETURN v_revoked_count;
END
$function$;

CREATE FUNCTION viberacing_private.revoke_profile_agent_authority()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.state = 'deletion_pending' AND OLD.state <> 'deletion_pending' THEN
    UPDATE viberacing_private.agent_accounts
    SET state = 'unlinked'
    WHERE profile_id = NEW.profile_id
      AND state <> 'unlinked';
    UPDATE viberacing_private.device_keys
    SET state = 'revoked',
        revoked_at = pg_catalog.transaction_timestamp()
    WHERE profile_id = NEW.profile_id
      AND state = 'active';
    UPDATE viberacing_private.connector_installations
    SET state = 'revoked',
        revoked_at = pg_catalog.transaction_timestamp()
    WHERE profile_id = NEW.profile_id
      AND state <> 'revoked';
    UPDATE viberacing_private.pairing_transactions
    SET state = CASE WHEN state = 'pending' THEN 'rejected' ELSE 'expired' END
    WHERE profile_id = NEW.profile_id
      AND state IN ('pending', 'approved');
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER profiles_revoke_agent_authority
AFTER UPDATE OF state ON viberacing_private.profiles
FOR EACH ROW EXECUTE FUNCTION viberacing_private.revoke_profile_agent_authority();

ALTER TABLE viberacing_private.agent_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.agent_providers FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_providers_owner_only ON viberacing_private.agent_providers
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

ALTER TABLE viberacing_private.agent_accounting_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.agent_accounting_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_accounting_revisions_owner_only
  ON viberacing_private.agent_accounting_revisions
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

ALTER TABLE viberacing_private.agent_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.agent_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_accounts_owner_only ON viberacing_private.agent_accounts
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

ALTER TABLE viberacing_private.connector_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.connector_installations FORCE ROW LEVEL SECURITY;
CREATE POLICY connector_installations_owner_only
  ON viberacing_private.connector_installations
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

ALTER TABLE viberacing_private.device_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.device_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY device_keys_owner_only ON viberacing_private.device_keys
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

ALTER TABLE viberacing_private.pairing_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.pairing_transactions FORCE ROW LEVEL SECURITY;
CREATE POLICY pairing_transactions_owner_only
  ON viberacing_private.pairing_transactions
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

ALTER TABLE viberacing_private.pairing_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.pairing_candidates FORCE ROW LEVEL SECURITY;
CREATE POLICY pairing_candidates_owner_only ON viberacing_private.pairing_candidates
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

ALTER TABLE viberacing_private.pairing_code_attempt_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.pairing_code_attempt_windows FORCE ROW LEVEL SECURITY;
CREATE POLICY pairing_code_attempt_windows_owner_only
  ON viberacing_private.pairing_code_attempt_windows
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

ALTER TABLE viberacing_private.pairing_request_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.pairing_request_windows FORCE ROW LEVEL SECURITY;
CREATE POLICY pairing_request_windows_owner_only
  ON viberacing_private.pairing_request_windows
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

REVOKE ALL ON ALL TABLES IN SCHEMA viberacing_private FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA viberacing_private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA viberacing_private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA viberacing_api FROM PUBLIC;

GRANT EXECUTE ON FUNCTION viberacing_api.admit_pairing_transport_request(
  text, bytea, integer, integer, integer
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.start_pairing_batch(
  text, text, bytea, text, text, text, text, bytea, bytea, bytea, bytea, bytea, timestamptz, jsonb
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.read_pairing_batch_for_approval(uuid, bytea, text)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.read_agent_accounts_for_pairing(uuid, bytea)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.read_pairing_batch_by_code(uuid, bytea, bytea, bytea)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.approve_pairing_batch(
  uuid, bytea, text, bytea, bytea, uuid, uuid, bigint, boolean, jsonb
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.read_pairing_possession_material(text, bytea)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.activate_pairing_batch(text, bytea)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.poll_pairing_batch(text, bytea)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.pause_agent_account(uuid, bytea, text)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.reactivate_agent_account(
  uuid, bytea, uuid, bytea, uuid, bigint, boolean, text
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.unlink_agent_account(
  uuid, bytea, uuid, bytea, uuid, bigint, boolean, text
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.revoke_device_key(
  uuid, bytea, uuid, bytea, uuid, bigint, boolean, text
)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.revoke_connector_installation(
  uuid, bytea, uuid, bytea, uuid, bigint, boolean, text
) TO viberacing_web;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (3, 'agent_accounts_installations_and_pairing');

COMMIT;
