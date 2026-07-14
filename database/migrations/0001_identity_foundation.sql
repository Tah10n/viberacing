\set ON_ERROR_STOP on

-- Revision 0001: private identity/source persistence and capability-deny baseline.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

CREATE SCHEMA viberacing_private AUTHORIZATION viberacing_owner;
CREATE SCHEMA viberacing_api AUTHORIZATION viberacing_owner;

REVOKE ALL ON SCHEMA viberacing_private FROM PUBLIC;
REVOKE ALL ON SCHEMA viberacing_api FROM PUBLIC;
GRANT USAGE ON SCHEMA viberacing_api
  TO viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

ALTER DEFAULT PRIVILEGES FOR ROLE viberacing_owner IN SCHEMA viberacing_private
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE viberacing_owner IN SCHEMA viberacing_private
  REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE viberacing_owner IN SCHEMA viberacing_private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE viberacing_owner IN SCHEMA viberacing_api
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE viberacing_owner IN SCHEMA viberacing_api
  REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE viberacing_owner IN SCHEMA viberacing_api
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE viberacing_private.schema_migrations (
  revision integer PRIMARY KEY,
  name varchar(63) NOT NULL UNIQUE,
  applied_at timestamptz(3) NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  CONSTRAINT schema_migrations_revision_positive CHECK (revision > 0),
  CONSTRAINT schema_migrations_name_format CHECK (name ~ '^[a-z][a-z0-9_]{2,62}$')
);

CREATE TABLE viberacing_private.invites (
  invite_id uuid PRIMARY KEY,
  verifier_digest bytea NOT NULL UNIQUE,
  state varchar(16) NOT NULL DEFAULT 'active',
  created_at timestamptz(3) NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  expires_at timestamptz(3) NOT NULL,
  redeemed_at timestamptz(3),
  redeemed_profile_id uuid UNIQUE,
  CONSTRAINT invites_verifier_digest_length CHECK (pg_catalog.octet_length(verifier_digest) = 32),
  CONSTRAINT invites_state CHECK (state IN ('active', 'redeemed', 'revoked')),
  CONSTRAINT invites_expiry_order CHECK (expires_at > created_at),
  CONSTRAINT invites_state_shape CHECK (
    (state = 'active' AND redeemed_at IS NULL AND redeemed_profile_id IS NULL)
    OR (state = 'redeemed' AND redeemed_at IS NOT NULL AND redeemed_profile_id IS NOT NULL)
    OR (state = 'revoked' AND redeemed_at IS NULL AND redeemed_profile_id IS NULL)
  ),
  CONSTRAINT invites_redemption_order CHECK (redeemed_at IS NULL OR redeemed_at >= created_at)
);

CREATE TABLE viberacing_private.profiles (
  profile_id uuid PRIMARY KEY,
  github_user_id bigint NOT NULL UNIQUE,
  handle varchar(24) NOT NULL UNIQUE,
  state varchar(24) NOT NULL DEFAULT 'enrolling',
  locale varchar(2) NOT NULL DEFAULT 'en',
  theme varchar(24) NOT NULL DEFAULT 'neon-night',
  motion_preference varchar(6) NOT NULL DEFAULT 'system',
  streak_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz(3) NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  updated_at timestamptz(3) NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  hidden_at timestamptz(3),
  deletion_requested_at timestamptz(3),
  CONSTRAINT profiles_github_user_id_positive CHECK (github_user_id > 0),
  CONSTRAINT profiles_handle_format CHECK (
    handle ~ '^[a-z0-9][a-z0-9_-]{1,22}[a-z0-9]$'
  ),
  CONSTRAINT profiles_state CHECK (
    state IN ('enrolling', 'active', 'hidden', 'deletion_pending')
  ),
  CONSTRAINT profiles_locale CHECK (locale IN ('en', 'ru')),
  CONSTRAINT profiles_theme CHECK (
    theme IN ('classic-grand-prix', 'cyber-rally', 'neon-night')
  ),
  CONSTRAINT profiles_motion CHECK (motion_preference IN ('off', 'on', 'system')),
  CONSTRAINT profiles_timestamp_order CHECK (
    updated_at >= created_at
    AND (hidden_at IS NULL OR hidden_at >= created_at)
    AND (deletion_requested_at IS NULL OR deletion_requested_at >= created_at)
  ),
  CONSTRAINT profiles_state_shape CHECK (
    (state IN ('enrolling', 'active') AND hidden_at IS NULL AND deletion_requested_at IS NULL)
    OR (state = 'hidden' AND hidden_at IS NOT NULL AND deletion_requested_at IS NULL)
    OR (
      state = 'deletion_pending'
      AND hidden_at IS NOT NULL
      AND deletion_requested_at IS NOT NULL
    )
  )
);

ALTER TABLE viberacing_private.invites
  ADD CONSTRAINT invites_redeemed_profile_fk
  FOREIGN KEY (redeemed_profile_id)
  REFERENCES viberacing_private.profiles (profile_id)
  ON DELETE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE viberacing_private.sessions (
  session_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES viberacing_private.profiles (profile_id) ON DELETE CASCADE,
  verifier_digest bytea NOT NULL UNIQUE,
  state varchar(12) NOT NULL DEFAULT 'active',
  created_at timestamptz(3) NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  expires_at timestamptz(3) NOT NULL,
  ended_at timestamptz(3),
  replaced_by_session_id uuid UNIQUE,
  CONSTRAINT sessions_verifier_digest_length CHECK (pg_catalog.octet_length(verifier_digest) = 32),
  CONSTRAINT sessions_state CHECK (state IN ('active', 'revoked', 'rotated')),
  CONSTRAINT sessions_expiry_order CHECK (expires_at > created_at),
  CONSTRAINT sessions_end_order CHECK (ended_at IS NULL OR ended_at >= created_at),
  CONSTRAINT sessions_not_self_replacing CHECK (
    replaced_by_session_id IS NULL OR replaced_by_session_id <> session_id
  ),
  CONSTRAINT sessions_state_shape CHECK (
    (state = 'active' AND ended_at IS NULL AND replaced_by_session_id IS NULL)
    OR (state = 'revoked' AND ended_at IS NOT NULL AND replaced_by_session_id IS NULL)
    OR (state = 'rotated' AND ended_at IS NOT NULL AND replaced_by_session_id IS NOT NULL)
  ),
  CONSTRAINT sessions_replacement_fk
    FOREIGN KEY (replaced_by_session_id)
    REFERENCES viberacing_private.sessions (session_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE viberacing_private.passkeys (
  passkey_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES viberacing_private.profiles (profile_id) ON DELETE CASCADE,
  credential_id bytea NOT NULL UNIQUE,
  cose_public_key bytea NOT NULL,
  label varchar(64) NOT NULL,
  sign_count bigint NOT NULL DEFAULT 0,
  backup_eligible boolean NOT NULL DEFAULT false,
  backup_state boolean NOT NULL DEFAULT false,
  state varchar(8) NOT NULL DEFAULT 'active',
  created_at timestamptz(3) NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  last_used_at timestamptz(3),
  revoked_at timestamptz(3),
  CONSTRAINT passkeys_credential_id_length CHECK (
    pg_catalog.octet_length(credential_id) BETWEEN 16 AND 1024
  ),
  CONSTRAINT passkeys_public_key_length CHECK (
    pg_catalog.octet_length(cose_public_key) BETWEEN 32 AND 4096
  ),
  CONSTRAINT passkeys_label_format CHECK (
    label = pg_catalog.btrim(label)
    AND label !~ '[[:cntrl:]]'
  ),
  CONSTRAINT passkeys_sign_count_nonnegative CHECK (sign_count >= 0),
  CONSTRAINT passkeys_state CHECK (state IN ('active', 'revoked')),
  CONSTRAINT passkeys_timestamp_order CHECK (
    (last_used_at IS NULL OR last_used_at >= created_at)
    AND (revoked_at IS NULL OR revoked_at >= created_at)
  ),
  CONSTRAINT passkeys_state_shape CHECK (
    (state = 'active' AND revoked_at IS NULL)
    OR (state = 'revoked' AND revoked_at IS NOT NULL)
  )
);

CREATE TABLE viberacing_private.recovery_codes (
  recovery_code_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES viberacing_private.profiles (profile_id) ON DELETE CASCADE,
  batch_id uuid NOT NULL,
  position smallint NOT NULL,
  verifier_phc varchar(255) NOT NULL UNIQUE,
  created_at timestamptz(3) NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  used_at timestamptz(3),
  CONSTRAINT recovery_codes_position CHECK (position BETWEEN 0 AND 15),
  CONSTRAINT recovery_codes_verifier_format CHECK (
    verifier_phc ~ '^\$argon2id\$v=[0-9]+\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$'
  ),
  CONSTRAINT recovery_codes_use_order CHECK (used_at IS NULL OR used_at >= created_at),
  CONSTRAINT recovery_codes_batch_position_unique UNIQUE (batch_id, position)
);

CREATE TABLE viberacing_private.auth_challenges (
  challenge_id uuid PRIMARY KEY,
  profile_id uuid REFERENCES viberacing_private.profiles (profile_id) ON DELETE CASCADE,
  purpose varchar(32) NOT NULL,
  challenge_digest bytea NOT NULL UNIQUE,
  context_digest bytea NOT NULL,
  user_verification_required boolean NOT NULL DEFAULT true,
  created_at timestamptz(3) NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  expires_at timestamptz(3) NOT NULL,
  consumed_at timestamptz(3),
  CONSTRAINT auth_challenges_purpose CHECK (
    purpose IN (
      'passkey_login',
      'passkey_registration',
      'pairing_approval',
      'recovery_change',
      'source_reactivation',
      'source_unlink',
      'profile_deletion'
    )
  ),
  CONSTRAINT auth_challenges_digest_lengths CHECK (
    pg_catalog.octet_length(challenge_digest) = 32
    AND pg_catalog.octet_length(context_digest) = 32
  ),
  CONSTRAINT auth_challenges_expiry_order CHECK (expires_at > created_at),
  CONSTRAINT auth_challenges_consumption_order CHECK (
    consumed_at IS NULL OR consumed_at >= created_at
  ),
  CONSTRAINT auth_challenges_profile_shape CHECK (
    (purpose = 'passkey_login') OR profile_id IS NOT NULL
  ),
  CONSTRAINT auth_challenges_user_verification CHECK (user_verification_required)
);

CREATE TABLE viberacing_private.codex_sources (
  source_id varchar(26) PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES viberacing_private.profiles (profile_id) ON DELETE CASCADE,
  state varchar(12) NOT NULL DEFAULT 'active',
  created_at timestamptz(3) NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  state_changed_at timestamptz(3) NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  CONSTRAINT codex_sources_id_format CHECK (source_id ~ '^src_[A-Za-z0-9_-]{22}$'),
  CONSTRAINT codex_sources_state CHECK (
    state IN ('active', 'paused', 'unlinked', 'quarantined')
  ),
  CONSTRAINT codex_sources_timestamp_order CHECK (state_changed_at >= created_at),
  CONSTRAINT codex_sources_profile_source_unique UNIQUE (profile_id, source_id)
);

CREATE TABLE viberacing_private.device_keys (
  device_key_id uuid PRIMARY KEY,
  device_id varchar(26) UNIQUE,
  source_id varchar(26) REFERENCES viberacing_private.codex_sources (source_id) ON DELETE CASCADE,
  public_key bytea NOT NULL UNIQUE,
  label varchar(64) NOT NULL,
  connector_version varchar(64) NOT NULL,
  os_family varchar(7) NOT NULL,
  architecture varchar(7) NOT NULL,
  state varchar(8) NOT NULL DEFAULT 'pending',
  created_at timestamptz(3) NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  activated_at timestamptz(3),
  revoked_at timestamptz(3),
  CONSTRAINT device_keys_id_format CHECK (
    device_id IS NULL OR device_id ~ '^dev_[A-Za-z0-9_-]{22}$'
  ),
  CONSTRAINT device_keys_public_key_length CHECK (pg_catalog.octet_length(public_key) = 32),
  CONSTRAINT device_keys_label_format CHECK (
    label = pg_catalog.btrim(label)
    AND label !~ '[[:cntrl:]]'
  ),
  CONSTRAINT device_keys_connector_version_format CHECK (
    connector_version ~ '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$'
  ),
  CONSTRAINT device_keys_os_family CHECK (os_family IN ('windows', 'macos', 'linux')),
  CONSTRAINT device_keys_architecture CHECK (architecture IN ('x86_64', 'aarch64')),
  CONSTRAINT device_keys_state CHECK (state IN ('pending', 'active', 'revoked')),
  CONSTRAINT device_keys_timestamp_order CHECK (
    (activated_at IS NULL OR activated_at >= created_at)
    AND (revoked_at IS NULL OR (activated_at IS NOT NULL AND revoked_at >= activated_at))
  ),
  CONSTRAINT device_keys_state_shape CHECK (
    (
      state = 'pending'
      AND source_id IS NULL
      AND device_id IS NULL
      AND activated_at IS NULL
      AND revoked_at IS NULL
    )
    OR (
      state = 'active'
      AND source_id IS NOT NULL
      AND device_id IS NOT NULL
      AND activated_at IS NOT NULL
      AND revoked_at IS NULL
    )
    OR (
      state = 'revoked'
      AND source_id IS NOT NULL
      AND device_id IS NOT NULL
      AND activated_at IS NOT NULL
      AND revoked_at IS NOT NULL
    )
  ),
  CONSTRAINT device_keys_source_device_unique UNIQUE (source_id, device_id),
  CONSTRAINT device_keys_binding_unique UNIQUE (device_key_id, source_id, device_id)
);

CREATE TABLE viberacing_private.pairing_transactions (
  pairing_id uuid PRIMARY KEY,
  poll_verifier_digest bytea NOT NULL UNIQUE,
  user_code_digest bytea NOT NULL UNIQUE,
  challenge bytea NOT NULL,
  pending_device_key_id uuid NOT NULL UNIQUE
    REFERENCES viberacing_private.device_keys (device_key_id) ON DELETE RESTRICT,
  device_label varchar(64) NOT NULL,
  connector_version varchar(64) NOT NULL,
  os_family varchar(7) NOT NULL,
  architecture varchar(7) NOT NULL,
  state varchar(10) NOT NULL DEFAULT 'pending',
  approved_profile_id uuid,
  source_choice varchar(8),
  approved_source_id varchar(26),
  activated_device_id varchar(26),
  created_at timestamptz(3) NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  expires_at timestamptz(3) NOT NULL,
  approved_at timestamptz(3),
  activated_at timestamptz(3),
  CONSTRAINT pairing_digest_lengths CHECK (
    pg_catalog.octet_length(poll_verifier_digest) = 32
    AND pg_catalog.octet_length(user_code_digest) = 32
    AND pg_catalog.octet_length(challenge) = 32
  ),
  CONSTRAINT pairing_device_label_format CHECK (
    device_label = pg_catalog.btrim(device_label)
    AND device_label !~ '[[:cntrl:]]'
  ),
  CONSTRAINT pairing_connector_version_format CHECK (
    connector_version ~ '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$'
  ),
  CONSTRAINT pairing_os_family CHECK (os_family IN ('windows', 'macos', 'linux')),
  CONSTRAINT pairing_architecture CHECK (architecture IN ('x86_64', 'aarch64')),
  CONSTRAINT pairing_state CHECK (state IN ('pending', 'approved', 'activated', 'cancelled')),
  CONSTRAINT pairing_source_choice CHECK (source_choice IS NULL OR source_choice IN ('new', 'existing')),
  CONSTRAINT pairing_expiry_order CHECK (expires_at > created_at),
  CONSTRAINT pairing_approval_order CHECK (
    approved_at IS NULL OR (approved_at >= created_at AND approved_at <= expires_at)
  ),
  CONSTRAINT pairing_activation_order CHECK (
    activated_at IS NULL
    OR (
      approved_at IS NOT NULL
      AND activated_at >= approved_at
      AND activated_at <= expires_at
    )
  ),
  CONSTRAINT pairing_approval_group CHECK (
    pg_catalog.num_nonnulls(
      approved_profile_id,
      source_choice,
      approved_source_id,
      approved_at
    ) IN (0, 4)
  ),
  CONSTRAINT pairing_activation_group CHECK (
    pg_catalog.num_nonnulls(activated_device_id, activated_at) IN (0, 2)
  ),
  CONSTRAINT pairing_state_shape CHECK (
    (state = 'pending' AND approved_at IS NULL AND activated_at IS NULL)
    OR (state = 'approved' AND approved_at IS NOT NULL AND activated_at IS NULL)
    OR (state = 'activated' AND approved_at IS NOT NULL AND activated_at IS NOT NULL)
    OR (state = 'cancelled' AND activated_at IS NULL)
  ),
  CONSTRAINT pairing_approved_source_fk
    FOREIGN KEY (approved_profile_id, approved_source_id)
    REFERENCES viberacing_private.codex_sources (profile_id, source_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT pairing_activated_device_fk
    FOREIGN KEY (pending_device_key_id, approved_source_id, activated_device_id)
    REFERENCES viberacing_private.device_keys (device_key_id, source_id, device_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE viberacing_private.deletion_jobs (
  deletion_job_id uuid PRIMARY KEY,
  profile_id uuid UNIQUE REFERENCES viberacing_private.profiles (profile_id) ON DELETE SET NULL,
  profile_ref_digest bytea NOT NULL UNIQUE,
  state varchar(12) NOT NULL DEFAULT 'queued',
  attempt_count smallint NOT NULL DEFAULT 0,
  lease_token_digest bytea,
  requested_at timestamptz(3) NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  available_at timestamptz(3) NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  lease_expires_at timestamptz(3),
  completed_at timestamptz(3),
  last_error_code varchar(64),
  CONSTRAINT deletion_jobs_profile_digest_length CHECK (
    pg_catalog.octet_length(profile_ref_digest) = 32
  ),
  CONSTRAINT deletion_jobs_state CHECK (state IN ('queued', 'running', 'retry_wait', 'purged')),
  CONSTRAINT deletion_jobs_attempt_count CHECK (attempt_count BETWEEN 0 AND 255),
  CONSTRAINT deletion_jobs_lease_digest_length CHECK (
    lease_token_digest IS NULL OR pg_catalog.octet_length(lease_token_digest) = 32
  ),
  CONSTRAINT deletion_jobs_error_code_format CHECK (
    last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{2,63}$'
  ),
  CONSTRAINT deletion_jobs_time_order CHECK (
    available_at >= requested_at
    AND (lease_expires_at IS NULL OR lease_expires_at >= requested_at)
    AND (completed_at IS NULL OR completed_at >= requested_at)
  ),
  CONSTRAINT deletion_jobs_lease_group CHECK (
    pg_catalog.num_nonnulls(lease_token_digest, lease_expires_at) IN (0, 2)
  ),
  CONSTRAINT deletion_jobs_state_shape CHECK (
    (
      state IN ('queued', 'retry_wait')
      AND profile_id IS NOT NULL
      AND lease_token_digest IS NULL
      AND completed_at IS NULL
    )
    OR (
      state = 'running'
      AND profile_id IS NOT NULL
      AND lease_token_digest IS NOT NULL
      AND completed_at IS NULL
    )
    OR (state = 'purged' AND lease_token_digest IS NULL AND completed_at IS NOT NULL)
  )
);

CREATE TABLE viberacing_private.deletion_tombstones (
  tombstone_id uuid PRIMARY KEY,
  profile_ref_digest bytea NOT NULL UNIQUE,
  identity_ref_digest bytea NOT NULL UNIQUE,
  digest_key_version smallint NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  expires_at timestamptz(3) NOT NULL,
  CONSTRAINT deletion_tombstones_digest_lengths CHECK (
    pg_catalog.octet_length(profile_ref_digest) = 32
    AND pg_catalog.octet_length(identity_ref_digest) = 32
  ),
  CONSTRAINT deletion_tombstones_key_version CHECK (digest_key_version BETWEEN 1 AND 32767),
  CONSTRAINT deletion_tombstones_expiry_order CHECK (expires_at > created_at)
);

CREATE INDEX invites_expiry_idx
  ON viberacing_private.invites (expires_at)
  WHERE state = 'active';
CREATE INDEX sessions_profile_state_idx
  ON viberacing_private.sessions (profile_id, state);
CREATE INDEX sessions_expiry_idx
  ON viberacing_private.sessions (expires_at)
  WHERE state = 'active';
CREATE INDEX passkeys_profile_state_idx
  ON viberacing_private.passkeys (profile_id, state);
CREATE INDEX recovery_codes_profile_batch_idx
  ON viberacing_private.recovery_codes (profile_id, batch_id);
CREATE INDEX auth_challenges_expiry_idx
  ON viberacing_private.auth_challenges (expires_at)
  WHERE consumed_at IS NULL;
CREATE INDEX codex_sources_profile_state_idx
  ON viberacing_private.codex_sources (profile_id, state);
CREATE INDEX device_keys_source_state_idx
  ON viberacing_private.device_keys (source_id, state);
CREATE INDEX pairing_transactions_expiry_idx
  ON viberacing_private.pairing_transactions (expires_at)
  WHERE state IN ('pending', 'approved');
CREATE INDEX deletion_jobs_work_idx
  ON viberacing_private.deletion_jobs (available_at, requested_at)
  WHERE state IN ('queued', 'retry_wait');
CREATE INDEX deletion_tombstones_expiry_idx
  ON viberacing_private.deletion_tombstones (expires_at);

CREATE FUNCTION viberacing_private.enforce_profile_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.profile_id IS DISTINCT FROM OLD.profile_id
    OR NEW.github_user_id IS DISTINCT FROM OLD.github_user_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'profile identity binding is immutable';
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state
    AND NOT (
      (OLD.state = 'enrolling' AND NEW.state IN ('active', 'hidden', 'deletion_pending'))
      OR (OLD.state = 'active' AND NEW.state IN ('hidden', 'deletion_pending'))
      OR (OLD.state = 'hidden' AND NEW.state IN ('active', 'deletion_pending'))
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'invalid profile state transition';
  END IF;

  NEW.updated_at := pg_catalog.statement_timestamp();
  RETURN NEW;
END
$function$;

CREATE TRIGGER profiles_enforce_update
BEFORE UPDATE ON viberacing_private.profiles
FOR EACH ROW EXECUTE FUNCTION viberacing_private.enforce_profile_update();

CREATE FUNCTION viberacing_private.enforce_source_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.source_id IS DISTINCT FROM OLD.source_id
    OR NEW.profile_id IS DISTINCT FROM OLD.profile_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'source binding is immutable';
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state
    AND NOT (
      (OLD.state = 'active' AND NEW.state IN ('paused', 'unlinked', 'quarantined'))
      OR (OLD.state = 'paused' AND NEW.state IN ('active', 'unlinked', 'quarantined'))
      OR (OLD.state = 'quarantined' AND NEW.state IN ('active', 'paused', 'unlinked'))
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'invalid source state transition';
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state THEN
    NEW.state_changed_at := pg_catalog.statement_timestamp();
  ELSIF NEW.state_changed_at IS DISTINCT FROM OLD.state_changed_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'source state timestamp is server managed';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER codex_sources_enforce_update
BEFORE UPDATE ON viberacing_private.codex_sources
FOR EACH ROW EXECUTE FUNCTION viberacing_private.enforce_source_update();

CREATE FUNCTION viberacing_private.enforce_device_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.device_id IS DISTINCT FROM OLD.device_id
    OR NEW.source_id IS DISTINCT FROM OLD.source_id THEN
    IF NOT (
      OLD.state = 'pending'
      AND NEW.state = 'active'
      AND OLD.device_id IS NULL
      AND OLD.source_id IS NULL
      AND NEW.device_id IS NOT NULL
      AND NEW.source_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23000',
        MESSAGE = 'device source binding is immutable after activation';
    END IF;
  END IF;

  IF NEW.device_key_id IS DISTINCT FROM OLD.device_key_id
    OR NEW.public_key IS DISTINCT FROM OLD.public_key
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'device key binding is immutable';
  END IF;

  IF OLD.state = 'pending'
    AND (
      NEW.label IS DISTINCT FROM OLD.label
      OR NEW.connector_version IS DISTINCT FROM OLD.connector_version
      OR NEW.os_family IS DISTINCT FROM OLD.os_family
      OR NEW.architecture IS DISTINCT FROM OLD.architecture
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'pending device metadata is immutable';
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state
    AND NOT (
      (OLD.state = 'pending' AND NEW.state = 'active')
      OR (OLD.state = 'active' AND NEW.state = 'revoked')
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'invalid device state transition';
  END IF;

  IF NEW.state = OLD.state
    AND (
      NEW.activated_at IS DISTINCT FROM OLD.activated_at
      OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'device lifecycle timestamps change only with state';
  END IF;

  IF OLD.state = 'pending' AND NEW.state = 'active'
    AND NOT (
      OLD.activated_at IS NULL
      AND NEW.activated_at IS NOT NULL
      AND NEW.revoked_at IS NULL
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'device activation requires a server timestamp';
  END IF;

  IF OLD.state = 'active' AND NEW.state = 'revoked'
    AND NOT (
      NEW.activated_at IS NOT DISTINCT FROM OLD.activated_at
      AND OLD.revoked_at IS NULL
      AND NEW.revoked_at IS NOT NULL
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'device revocation requires a server timestamp';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER device_keys_enforce_update
BEFORE UPDATE ON viberacing_private.device_keys
FOR EACH ROW EXECUTE FUNCTION viberacing_private.enforce_device_update();

CREATE FUNCTION viberacing_private.enforce_pairing_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  key_record viberacing_private.device_keys%ROWTYPE;
BEGIN
  SELECT *
  INTO key_record
  FROM viberacing_private.device_keys
  WHERE device_key_id = NEW.pending_device_key_id
  FOR UPDATE;

  IF key_record.state IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'pairing requires one pending device key';
  END IF;

  IF NEW.device_label IS DISTINCT FROM key_record.label
    OR NEW.connector_version IS DISTINCT FROM key_record.connector_version
    OR NEW.os_family IS DISTINCT FROM key_record.os_family
    OR NEW.architecture IS DISTINCT FROM key_record.architecture THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'pairing metadata must match the pending key record';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER pairing_transactions_enforce_insert
BEFORE INSERT ON viberacing_private.pairing_transactions
FOR EACH ROW EXECUTE FUNCTION viberacing_private.enforce_pairing_insert();

CREATE FUNCTION viberacing_private.enforce_pairing_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.pairing_id IS DISTINCT FROM OLD.pairing_id
    OR NEW.poll_verifier_digest IS DISTINCT FROM OLD.poll_verifier_digest
    OR NEW.user_code_digest IS DISTINCT FROM OLD.user_code_digest
    OR NEW.challenge IS DISTINCT FROM OLD.challenge
    OR NEW.pending_device_key_id IS DISTINCT FROM OLD.pending_device_key_id
    OR NEW.device_label IS DISTINCT FROM OLD.device_label
    OR NEW.connector_version IS DISTINCT FROM OLD.connector_version
    OR NEW.os_family IS DISTINCT FROM OLD.os_family
    OR NEW.architecture IS DISTINCT FROM OLD.architecture
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'pending pairing authority is immutable';
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state
    AND NOT (
      (OLD.state = 'pending' AND NEW.state IN ('approved', 'cancelled'))
      OR (OLD.state = 'approved' AND NEW.state IN ('activated', 'cancelled'))
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'invalid pairing state transition';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER pairing_transactions_enforce_update
BEFORE UPDATE ON viberacing_private.pairing_transactions
FOR EACH ROW EXECUTE FUNCTION viberacing_private.enforce_pairing_update();

ALTER TABLE viberacing_private.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.schema_migrations FORCE ROW LEVEL SECURITY;
CREATE POLICY schema_migrations_owner_all ON viberacing_private.schema_migrations
  FOR ALL TO viberacing_owner USING (true) WITH CHECK (true);

ALTER TABLE viberacing_private.invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.invites FORCE ROW LEVEL SECURITY;
CREATE POLICY invites_owner_all ON viberacing_private.invites
  FOR ALL TO viberacing_owner USING (true) WITH CHECK (true);

ALTER TABLE viberacing_private.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY profiles_owner_all ON viberacing_private.profiles
  FOR ALL TO viberacing_owner USING (true) WITH CHECK (true);

ALTER TABLE viberacing_private.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY sessions_owner_all ON viberacing_private.sessions
  FOR ALL TO viberacing_owner USING (true) WITH CHECK (true);

ALTER TABLE viberacing_private.passkeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.passkeys FORCE ROW LEVEL SECURITY;
CREATE POLICY passkeys_owner_all ON viberacing_private.passkeys
  FOR ALL TO viberacing_owner USING (true) WITH CHECK (true);

ALTER TABLE viberacing_private.recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.recovery_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY recovery_codes_owner_all ON viberacing_private.recovery_codes
  FOR ALL TO viberacing_owner USING (true) WITH CHECK (true);

ALTER TABLE viberacing_private.auth_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.auth_challenges FORCE ROW LEVEL SECURITY;
CREATE POLICY auth_challenges_owner_all ON viberacing_private.auth_challenges
  FOR ALL TO viberacing_owner USING (true) WITH CHECK (true);

ALTER TABLE viberacing_private.codex_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.codex_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY codex_sources_owner_all ON viberacing_private.codex_sources
  FOR ALL TO viberacing_owner USING (true) WITH CHECK (true);

ALTER TABLE viberacing_private.device_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.device_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY device_keys_owner_all ON viberacing_private.device_keys
  FOR ALL TO viberacing_owner USING (true) WITH CHECK (true);

ALTER TABLE viberacing_private.pairing_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.pairing_transactions FORCE ROW LEVEL SECURITY;
CREATE POLICY pairing_transactions_owner_all ON viberacing_private.pairing_transactions
  FOR ALL TO viberacing_owner USING (true) WITH CHECK (true);

ALTER TABLE viberacing_private.deletion_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.deletion_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY deletion_jobs_owner_all ON viberacing_private.deletion_jobs
  FOR ALL TO viberacing_owner USING (true) WITH CHECK (true);

ALTER TABLE viberacing_private.deletion_tombstones ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.deletion_tombstones FORCE ROW LEVEL SECURITY;
CREATE POLICY deletion_tombstones_owner_all ON viberacing_private.deletion_tombstones
  FOR ALL TO viberacing_owner USING (true) WITH CHECK (true);

REVOKE ALL ON ALL TABLES IN SCHEMA viberacing_private
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA viberacing_private
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA viberacing_private
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (1, 'identity_foundation');

COMMIT;
