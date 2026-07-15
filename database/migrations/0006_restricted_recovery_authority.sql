\set ON_ERROR_STOP on

-- Revision 0006: passkey-protected recovery-code rotation and restricted account recovery.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

-- Used recovery material must not remain available for offline verification after consumption.
ALTER TABLE viberacing_private.recovery_codes
  ALTER COLUMN verifier_phc DROP NOT NULL,
  DROP CONSTRAINT recovery_codes_verifier_format,
  DROP CONSTRAINT recovery_codes_use_order;

UPDATE viberacing_private.recovery_codes
SET verifier_phc = NULL
WHERE used_at IS NOT NULL;

ALTER TABLE viberacing_private.recovery_codes
  ADD CONSTRAINT recovery_codes_verifier_format CHECK (
    verifier_phc IS NULL
    OR verifier_phc ~ '^\$argon2id\$v=[0-9]+\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$'
  ),
  ADD CONSTRAINT recovery_codes_state_shape CHECK (
    (used_at IS NULL AND verifier_phc IS NOT NULL)
    OR (used_at IS NOT NULL AND verifier_phc IS NULL AND used_at >= created_at)
  );

CREATE TABLE viberacing_private.recovery_authorities (
  recovery_authority_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES viberacing_private.profiles (profile_id) ON DELETE CASCADE,
  source_recovery_code_id uuid NOT NULL,
  verifier_digest bytea NOT NULL UNIQUE,
  challenge_digest bytea NOT NULL UNIQUE,
  context_digest bytea NOT NULL,
  state varchar(9) NOT NULL DEFAULT 'active',
  created_at timestamptz(3) NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  expires_at timestamptz(3) NOT NULL,
  completed_at timestamptz(3),
  revoked_at timestamptz(3),
  CONSTRAINT recovery_authorities_digest_lengths CHECK (
    pg_catalog.octet_length(verifier_digest) = 32
    AND pg_catalog.octet_length(challenge_digest) = 32
    AND pg_catalog.octet_length(context_digest) = 32
  ),
  CONSTRAINT recovery_authorities_state CHECK (state IN ('active', 'completed', 'revoked')),
  CONSTRAINT recovery_authorities_expiry_order CHECK (
    expires_at > created_at
    AND expires_at <= created_at + INTERVAL '10 minutes'
  ),
  CONSTRAINT recovery_authorities_state_shape CHECK (
    (state = 'active' AND completed_at IS NULL AND revoked_at IS NULL)
    OR (
      state = 'completed'
      AND completed_at IS NOT NULL
      AND completed_at >= created_at
      AND revoked_at IS NULL
    )
    OR (
      state = 'revoked'
      AND revoked_at IS NOT NULL
      AND revoked_at >= created_at
      AND completed_at IS NULL
    )
  )
);

CREATE UNIQUE INDEX recovery_authorities_profile_active_unique
  ON viberacing_private.recovery_authorities (profile_id)
  WHERE state = 'active';
CREATE INDEX recovery_authorities_expiry_idx
  ON viberacing_private.recovery_authorities (expires_at)
  WHERE state = 'active';

ALTER TABLE viberacing_private.recovery_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.recovery_authorities FORCE ROW LEVEL SECURITY;
CREATE POLICY recovery_authorities_owner_all ON viberacing_private.recovery_authorities
  FOR ALL TO viberacing_owner USING (true) WITH CHECK (true);

ALTER TABLE viberacing_private.audit_events
  DROP CONSTRAINT audit_events_type,
  DROP CONSTRAINT audit_events_actor,
  DROP CONSTRAINT audit_events_actor_shape;

ALTER TABLE viberacing_private.audit_events
  ADD CONSTRAINT audit_events_type CHECK (
    event_type IN (
      'invite.issued',
      'profile.enrolled',
      'passkey.registered',
      'passkey.authenticated',
      'passkey.revoked',
      'session.rotated',
      'session.revoked',
      'pairing.approved',
      'device.activated',
      'source.paused',
      'source.reactivated',
      'source.unlinked',
      'device.revoked',
      'recovery.codes_replaced',
      'recovery.started',
      'recovery.completed',
      'deletion.requested'
    )
  ),
  ADD CONSTRAINT audit_events_actor CHECK (
    actor_kind IN ('admin', 'profile', 'recovery', 'system', 'job')
  ),
  ADD CONSTRAINT audit_events_actor_shape CHECK (
    actor_kind IN ('profile', 'recovery') OR profile_id IS NULL
  );

CREATE FUNCTION viberacing_private.enforce_recovery_code_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.recovery_code_id IS DISTINCT FROM OLD.recovery_code_id
    OR NEW.profile_id IS DISTINCT FROM OLD.profile_id
    OR NEW.batch_id IS DISTINCT FROM OLD.batch_id
    OR NEW.position IS DISTINCT FROM OLD.position
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'recovery code binding is immutable';
  END IF;

  IF NOT (
    OLD.used_at IS NULL
    AND OLD.verifier_phc IS NOT NULL
    AND NEW.used_at IS NOT NULL
    AND NEW.verifier_phc IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'recovery code permits only one terminal consume transition';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER recovery_codes_enforce_update
BEFORE UPDATE ON viberacing_private.recovery_codes
FOR EACH ROW EXECUTE FUNCTION viberacing_private.enforce_recovery_code_update();

CREATE FUNCTION viberacing_private.enforce_recovery_authority_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.recovery_authority_id IS DISTINCT FROM OLD.recovery_authority_id
    OR NEW.profile_id IS DISTINCT FROM OLD.profile_id
    OR NEW.source_recovery_code_id IS DISTINCT FROM OLD.source_recovery_code_id
    OR NEW.verifier_digest IS DISTINCT FROM OLD.verifier_digest
    OR NEW.challenge_digest IS DISTINCT FROM OLD.challenge_digest
    OR NEW.context_digest IS DISTINCT FROM OLD.context_digest
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'recovery authority binding is immutable';
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state
    AND NOT (
      OLD.state = 'active'
      AND (
        (
          NEW.state = 'completed'
          AND OLD.completed_at IS NULL
          AND NEW.completed_at IS NOT NULL
          AND NEW.revoked_at IS NULL
        )
        OR (
          NEW.state = 'revoked'
          AND OLD.revoked_at IS NULL
          AND NEW.revoked_at IS NOT NULL
          AND NEW.completed_at IS NULL
        )
      )
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'invalid recovery authority state transition';
  END IF;

  IF NEW.state = OLD.state
    AND (
      NEW.completed_at IS DISTINCT FROM OLD.completed_at
      OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'recovery authority terminal time is immutable';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER recovery_authorities_enforce_update
BEFORE UPDATE ON viberacing_private.recovery_authorities
FOR EACH ROW EXECUTE FUNCTION viberacing_private.enforce_recovery_authority_update();

CREATE FUNCTION viberacing_private.revoke_recovery_on_profile_deletion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF OLD.state IS DISTINCT FROM 'deletion_pending' AND NEW.state = 'deletion_pending' THEN
    UPDATE viberacing_private.recovery_authorities
    SET
      state = 'revoked',
      revoked_at = pg_catalog.clock_timestamp()
    WHERE profile_id = NEW.profile_id
      AND state = 'active';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER profiles_revoke_recovery_on_deletion
AFTER UPDATE ON viberacing_private.profiles
FOR EACH ROW EXECUTE FUNCTION viberacing_private.revoke_recovery_on_profile_deletion();

CREATE OR REPLACE FUNCTION viberacing_private.append_audit_event(
  p_audit_event_id uuid,
  p_event_type text,
  p_actor_kind text,
  p_profile_id uuid,
  p_request_id text,
  p_reason_code text
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF p_audit_event_id IS NULL
    OR p_event_type IS NULL
    OR p_event_type NOT IN (
      'invite.issued',
      'profile.enrolled',
      'passkey.registered',
      'passkey.authenticated',
      'passkey.revoked',
      'session.rotated',
      'session.revoked',
      'pairing.approved',
      'device.activated',
      'source.paused',
      'source.reactivated',
      'source.unlinked',
      'device.revoked',
      'recovery.codes_replaced',
      'recovery.started',
      'recovery.completed',
      'deletion.requested'
    )
    OR p_actor_kind IS NULL
    OR p_actor_kind NOT IN ('admin', 'profile', 'recovery', 'system', 'job')
    OR (p_actor_kind IN ('profile', 'recovery')) IS DISTINCT FROM (p_profile_id IS NOT NULL)
    OR p_request_id IS NULL
    OR p_request_id !~ '^req_[A-Za-z0-9_-]{22}$'
    OR (p_reason_code IS NOT NULL AND p_reason_code !~ '^[A-Z][A-Z0-9_]{2,63}$') THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  INSERT INTO viberacing_private.audit_events (
    audit_event_id,
    event_type,
    actor_kind,
    profile_id,
    request_id,
    reason_code
  )
  VALUES (
    p_audit_event_id,
    p_event_type,
    p_actor_kind,
    p_profile_id,
    p_request_id,
    p_reason_code
  );
END
$function$;

CREATE OR REPLACE FUNCTION viberacing_api.consume_passkey_challenge(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_challenge_id uuid,
  p_purpose text,
  p_challenge_digest bytea,
  p_context_digest bytea,
  p_verified_passkey_id uuid,
  p_observed_sign_count bigint,
  p_backup_state boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  authenticated_profile_id uuid;
  allowed_profile_states text[];
  locked_passkey_id uuid;
  locked_backup_eligible boolean;
  changed_rows bigint;
  now_at timestamptz := pg_catalog.statement_timestamp();
BEGIN
  IF p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32
    OR p_challenge_id IS NULL
    OR p_purpose IS NULL
    OR p_purpose NOT IN (
      'passkey_change',
      'pairing_approval',
      'recovery_change',
      'source_reactivation',
      'source_unlink',
      'profile_deletion'
    )
    OR pg_catalog.octet_length(p_challenge_digest) IS DISTINCT FROM 32
    OR pg_catalog.octet_length(p_context_digest) IS DISTINCT FROM 32
    OR p_verified_passkey_id IS NULL
    OR p_observed_sign_count IS NULL
    OR p_observed_sign_count < 0
    OR p_backup_state IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  IF p_purpose IN ('passkey_change', 'recovery_change', 'profile_deletion') THEN
    allowed_profile_states := ARRAY['active', 'hidden'];
  ELSE
    allowed_profile_states := ARRAY['active'];
  END IF;

  authenticated_profile_id := viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest,
    allowed_profile_states
  );

  SELECT passkey_id, backup_eligible
  INTO locked_passkey_id, locked_backup_eligible
  FROM viberacing_private.passkeys
  WHERE passkey_id = p_verified_passkey_id
    AND profile_id = authenticated_profile_id
    AND state = 'active'
  FOR UPDATE;

  IF locked_passkey_id IS NULL OR (p_backup_state AND NOT locked_backup_eligible) THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  -- The statement may have waited on a profile/passkey lock. Use post-lock wall time so a
  -- ceremony that expired while waiting cannot be consumed and usage time cannot move backward.
  now_at := pg_catalog.clock_timestamp();

  UPDATE viberacing_private.auth_challenges
  SET
    consumed_at = now_at,
    verified_by_passkey_id = locked_passkey_id
  WHERE challenge_id = p_challenge_id
    AND profile_id = authenticated_profile_id
    AND session_id = p_session_id
    AND purpose = p_purpose
    AND challenge_digest = p_challenge_digest
    AND context_digest = p_context_digest
    AND consumed_at IS NULL
    AND verified_by_passkey_id IS NULL
    AND expires_at >= now_at;

  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows = 0 THEN
    RETURN false;
  END IF;

  UPDATE viberacing_private.passkeys
  SET
    sign_count = GREATEST(sign_count, p_observed_sign_count),
    backup_state = p_backup_state,
    last_used_at = now_at
  WHERE passkey_id = locked_passkey_id;

  RETURN true;
END
$function$;

CREATE FUNCTION viberacing_api.create_recovery_change_challenge(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_challenge_id uuid,
  p_challenge_digest bytea,
  p_context_digest bytea,
  p_expires_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  authenticated_profile_id uuid;
  now_at timestamptz := pg_catalog.statement_timestamp();
BEGIN
  IF p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32
    OR p_challenge_id IS NULL
    OR pg_catalog.octet_length(p_challenge_digest) IS DISTINCT FROM 32
    OR pg_catalog.octet_length(p_context_digest) IS DISTINCT FROM 32
    OR p_expires_at IS NULL
    OR p_expires_at <= now_at
    OR p_expires_at > now_at + INTERVAL '5 minutes' THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  authenticated_profile_id := viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest,
    ARRAY['active', 'hidden']
  );

  now_at := pg_catalog.clock_timestamp();
  IF p_expires_at <= now_at OR p_expires_at > now_at + INTERVAL '5 minutes' THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  INSERT INTO viberacing_private.auth_challenges (
    challenge_id,
    profile_id,
    session_id,
    purpose,
    challenge_digest,
    context_digest,
    user_verification_required,
    created_at,
    expires_at
  )
  VALUES (
    p_challenge_id,
    authenticated_profile_id,
    p_session_id,
    'recovery_change',
    p_challenge_digest,
    p_context_digest,
    true,
    now_at,
    p_expires_at
  );
EXCEPTION
  WHEN integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
END
$function$;

CREATE FUNCTION viberacing_api.replace_recovery_codes(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_challenge_id uuid,
  p_context_digest bytea,
  p_batch_id uuid,
  p_recovery_code_ids uuid[],
  p_verifier_phcs text[],
  p_audit_event_id uuid,
  p_request_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  authenticated_profile_id uuid;
  changed_rows bigint;
  code_count integer;
  now_at timestamptz := pg_catalog.statement_timestamp();
BEGIN
  code_count := pg_catalog.cardinality(p_recovery_code_ids);

  IF p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32
    OR p_challenge_id IS NULL
    OR pg_catalog.octet_length(p_context_digest) IS DISTINCT FROM 32
    OR p_batch_id IS NULL
    OR pg_catalog.array_ndims(p_recovery_code_ids) IS DISTINCT FROM 1
    OR pg_catalog.array_ndims(p_verifier_phcs) IS DISTINCT FROM 1
    OR pg_catalog.array_lower(p_recovery_code_ids, 1) IS DISTINCT FROM 1
    OR pg_catalog.array_lower(p_verifier_phcs, 1) IS DISTINCT FROM 1
    OR code_count NOT BETWEEN 8 AND 16
    OR pg_catalog.cardinality(p_verifier_phcs) IS DISTINCT FROM code_count
    OR pg_catalog.array_position(p_recovery_code_ids, NULL) IS NOT NULL
    OR pg_catalog.array_position(p_verifier_phcs, NULL) IS NOT NULL
    OR (
      SELECT pg_catalog.count(DISTINCT code_id) <> code_count
      FROM pg_catalog.unnest(p_recovery_code_ids) AS supplied_code(code_id)
    )
    OR (
      SELECT pg_catalog.count(DISTINCT verifier_phc) <> code_count
      FROM pg_catalog.unnest(p_verifier_phcs) AS supplied_verifier(verifier_phc)
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(p_verifier_phcs) AS supplied_verifier(verifier_phc)
      WHERE CASE
        WHEN pg_catalog.octet_length(verifier_phc) > 255 THEN true
        ELSE verifier_phc !~ '^\$argon2id\$v=[0-9]+\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$'
      END
    )
    OR p_audit_event_id IS NULL
    OR p_request_id IS NULL
    OR p_request_id !~ '^req_[A-Za-z0-9_-]{22}$' THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  authenticated_profile_id := viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest,
    ARRAY['active', 'hidden']
  );

  -- A competing recovery start can commit after this statement began but before the profile lock
  -- is acquired. Terminal timestamps must be taken after that lock so rotation always dominates.
  now_at := pg_catalog.clock_timestamp();

  UPDATE viberacing_private.auth_challenges
  SET authorized_action_used_at = now_at
  WHERE challenge_id = p_challenge_id
    AND profile_id = authenticated_profile_id
    AND session_id = p_session_id
    AND purpose = 'recovery_change'
    AND context_digest = p_context_digest
    AND consumed_at IS NOT NULL
    AND verified_by_passkey_id IS NOT NULL
    AND authorized_action_used_at IS NULL
    AND expires_at >= now_at;

  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.recovery_authorities
  SET
    state = 'revoked',
    revoked_at = now_at
  WHERE profile_id = authenticated_profile_id
    AND state = 'active';

  DELETE FROM viberacing_private.recovery_codes
  WHERE profile_id = authenticated_profile_id;

  INSERT INTO viberacing_private.recovery_codes (
    recovery_code_id,
    profile_id,
    batch_id,
    position,
    verifier_phc,
    created_at
  )
  SELECT
    p_recovery_code_ids[code_index],
    authenticated_profile_id,
    p_batch_id,
    (code_index - 1)::smallint,
    p_verifier_phcs[code_index],
    now_at
  FROM pg_catalog.generate_series(1, code_count) AS supplied_index(code_index);

  PERFORM viberacing_private.append_audit_event(
    p_audit_event_id,
    'recovery.codes_replaced',
    'profile',
    authenticated_profile_id,
    p_request_id,
    NULL
  );
EXCEPTION
  WHEN integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
END
$function$;

CREATE FUNCTION viberacing_api.read_recovery_code_verification_material(
  p_recovery_code_id uuid
)
RETURNS TABLE (
  recovery_code_id uuid,
  verifier_phc text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF p_recovery_code_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  RETURN QUERY
  SELECT
    recovery_code.recovery_code_id,
    recovery_code.verifier_phc::text
  FROM viberacing_private.recovery_codes AS recovery_code
  JOIN viberacing_private.profiles AS profile_record
    ON profile_record.profile_id = recovery_code.profile_id
  WHERE recovery_code.recovery_code_id = p_recovery_code_id
    AND recovery_code.used_at IS NULL
    AND recovery_code.verifier_phc IS NOT NULL
    AND profile_record.state IN ('active', 'hidden');
END
$function$;

CREATE FUNCTION viberacing_api.start_recovery(
  p_recovery_code_id uuid,
  p_recovery_authority_id uuid,
  p_verifier_digest bytea,
  p_challenge_digest bytea,
  p_context_digest bytea,
  p_expires_at timestamptz,
  p_audit_event_id uuid,
  p_request_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  candidate_profile_id uuid;
  locked_profile_id uuid;
  consumed_recovery_code_id uuid;
  now_at timestamptz := pg_catalog.statement_timestamp();
BEGIN
  IF p_recovery_code_id IS NULL
    OR p_recovery_authority_id IS NULL
    OR pg_catalog.octet_length(p_verifier_digest) IS DISTINCT FROM 32
    OR pg_catalog.octet_length(p_challenge_digest) IS DISTINCT FROM 32
    OR pg_catalog.octet_length(p_context_digest) IS DISTINCT FROM 32
    OR p_expires_at IS NULL
    OR p_expires_at <= now_at
    OR p_expires_at > now_at + INTERVAL '10 minutes'
    OR p_audit_event_id IS NULL
    OR p_request_id IS NULL
    OR p_request_id !~ '^req_[A-Za-z0-9_-]{22}$' THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT profile_id
  INTO candidate_profile_id
  FROM viberacing_private.recovery_codes
  WHERE recovery_code_id = p_recovery_code_id
    AND used_at IS NULL
    AND verifier_phc IS NOT NULL;

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

  now_at := pg_catalog.clock_timestamp();
  IF p_expires_at <= now_at OR p_expires_at > now_at + INTERVAL '10 minutes' THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.recovery_codes
  SET
    verifier_phc = NULL,
    used_at = now_at
  WHERE recovery_code_id = p_recovery_code_id
    AND profile_id = locked_profile_id
    AND used_at IS NULL
    AND verifier_phc IS NOT NULL
  RETURNING recovery_code_id INTO consumed_recovery_code_id;

  IF consumed_recovery_code_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.recovery_authorities
  SET
    state = 'revoked',
    revoked_at = now_at
  WHERE profile_id = locked_profile_id
    AND state = 'active';

  INSERT INTO viberacing_private.recovery_authorities (
    recovery_authority_id,
    profile_id,
    source_recovery_code_id,
    verifier_digest,
    challenge_digest,
    context_digest,
    state,
    created_at,
    expires_at
  )
  VALUES (
    p_recovery_authority_id,
    locked_profile_id,
    consumed_recovery_code_id,
    p_verifier_digest,
    p_challenge_digest,
    p_context_digest,
    'active',
    now_at,
    p_expires_at
  );

  PERFORM viberacing_private.append_audit_event(
    p_audit_event_id,
    'recovery.started',
    'recovery',
    locked_profile_id,
    p_request_id,
    NULL
  );
EXCEPTION
  WHEN integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
END
$function$;

CREATE FUNCTION viberacing_api.complete_recovery_registration(
  p_recovery_authority_id uuid,
  p_authority_verifier_digest bytea,
  p_challenge_digest bytea,
  p_context_digest bytea,
  p_passkey_id uuid,
  p_credential_id bytea,
  p_cose_public_key bytea,
  p_label text,
  p_sign_count bigint,
  p_backup_eligible boolean,
  p_backup_state boolean,
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_session_expires_at timestamptz,
  p_audit_event_id uuid,
  p_request_id text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  candidate_profile_id uuid;
  recovered_profile_id uuid;
  locked_authority_id uuid;
  lifetime_passkey_count bigint;
  now_at timestamptz := pg_catalog.statement_timestamp();
BEGIN
  IF p_recovery_authority_id IS NULL
    OR pg_catalog.octet_length(p_authority_verifier_digest) IS DISTINCT FROM 32
    OR pg_catalog.octet_length(p_challenge_digest) IS DISTINCT FROM 32
    OR pg_catalog.octet_length(p_context_digest) IS DISTINCT FROM 32
    OR p_passkey_id IS NULL
    OR p_credential_id IS NULL
    OR pg_catalog.octet_length(p_credential_id) NOT BETWEEN 16 AND 1024
    OR p_cose_public_key IS NULL
    OR pg_catalog.octet_length(p_cose_public_key) NOT BETWEEN 32 AND 4096
    OR p_label IS NULL
    OR pg_catalog.char_length(p_label) NOT BETWEEN 1 AND 64
    OR p_label <> pg_catalog.btrim(p_label)
    OR p_label ~ '[[:cntrl:]]'
    OR p_sign_count IS NULL
    OR p_sign_count < 0
    OR p_backup_eligible IS NULL
    OR p_backup_state IS NULL
    OR (p_backup_state AND NOT p_backup_eligible)
    OR p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32
    OR p_session_expires_at IS NULL
    OR p_session_expires_at <= now_at
    OR p_session_expires_at > now_at + INTERVAL '31 days'
    OR p_audit_event_id IS NULL
    OR p_request_id IS NULL
    OR p_request_id !~ '^req_[A-Za-z0-9_-]{22}$' THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT profile_id
  INTO candidate_profile_id
  FROM viberacing_private.recovery_authorities
  WHERE recovery_authority_id = p_recovery_authority_id
    AND verifier_digest = p_authority_verifier_digest
    AND state = 'active'
    AND expires_at >= now_at;

  IF candidate_profile_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT profile_id
  INTO recovered_profile_id
  FROM viberacing_private.profiles
  WHERE profile_id = candidate_profile_id
    AND state IN ('active', 'hidden')
  FOR UPDATE;

  IF recovered_profile_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  -- A concurrent old-passkey login can finish before this profile lock is acquired. Refresh time
  -- after the lock so revoking that newly created session cannot predate its creation.
  now_at := pg_catalog.clock_timestamp();
  IF p_session_expires_at <= now_at
    OR p_session_expires_at > now_at + INTERVAL '31 days' THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT recovery_authority_id
  INTO locked_authority_id
  FROM viberacing_private.recovery_authorities
  WHERE recovery_authority_id = p_recovery_authority_id
    AND profile_id = recovered_profile_id
    AND verifier_digest = p_authority_verifier_digest
    AND challenge_digest = p_challenge_digest
    AND context_digest = p_context_digest
    AND state = 'active'
    AND expires_at >= now_at
  FOR UPDATE;

  IF locked_authority_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT pg_catalog.count(*)
  INTO lifetime_passkey_count
  FROM viberacing_private.passkeys
  WHERE profile_id = recovered_profile_id;

  -- Historical credential rows preserve session and pairing provenance. Until bounded cleanup is
  -- implemented, recovery fails closed at the same public lifetime ceiling as normal key add.
  IF lifetime_passkey_count >= 32 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  INSERT INTO viberacing_private.passkeys (
    passkey_id,
    profile_id,
    credential_id,
    cose_public_key,
    label,
    sign_count,
    backup_eligible,
    backup_state,
    state,
    created_at
  )
  VALUES (
    p_passkey_id,
    recovered_profile_id,
    p_credential_id,
    p_cose_public_key,
    p_label,
    p_sign_count,
    p_backup_eligible,
    p_backup_state,
    'active',
    now_at
  );

  UPDATE viberacing_private.pairing_transactions
  SET state = 'cancelled'
  WHERE approved_profile_id = recovered_profile_id
    AND state = 'approved';

  DELETE FROM viberacing_private.auth_challenges
  WHERE profile_id = recovered_profile_id;

  UPDATE viberacing_private.sessions
  SET
    state = 'revoked',
    ended_at = now_at
  WHERE profile_id = recovered_profile_id
    AND state = 'active';

  UPDATE viberacing_private.passkeys
  SET
    state = 'revoked',
    revoked_at = now_at
  WHERE profile_id = recovered_profile_id
    AND passkey_id <> p_passkey_id
    AND state = 'active';

  DELETE FROM viberacing_private.recovery_codes
  WHERE profile_id = recovered_profile_id;

  UPDATE viberacing_private.recovery_authorities
  SET
    state = 'completed',
    completed_at = now_at
  WHERE recovery_authority_id = locked_authority_id;

  INSERT INTO viberacing_private.sessions (
    session_id,
    profile_id,
    verifier_digest,
    state,
    created_at,
    expires_at,
    authentication_kind,
    authenticated_by_passkey_id
  )
  VALUES (
    p_session_id,
    recovered_profile_id,
    p_session_verifier_digest,
    'active',
    now_at,
    p_session_expires_at,
    'passkey',
    p_passkey_id
  );

  PERFORM viberacing_private.append_audit_event(
    p_audit_event_id,
    'recovery.completed',
    'recovery',
    recovered_profile_id,
    p_request_id,
    NULL
  );

  RETURN recovered_profile_id;
EXCEPTION
  WHEN integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
    RETURN NULL;
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

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (6, 'restricted_recovery_authority');

COMMIT;
