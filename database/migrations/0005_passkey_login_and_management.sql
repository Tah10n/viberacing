\set ON_ERROR_STOP on

-- Revision 0005: passkey login, exact step-up provenance, and bounded multi-passkey management.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

-- Ceremonies created before this revision do not identify the passkey that verified them. Closing
-- them is safer than carrying unverifiable step-up authority across the security-boundary change.
DELETE FROM viberacing_private.auth_challenges;

-- Likewise, an approved but not yet activated pairing created by the old contract has no exact
-- session/passkey provenance. Activated devices are separate, explicit authority and remain live.
UPDATE viberacing_private.pairing_transactions
SET state = 'cancelled'
WHERE state = 'approved';

-- Older schema revisions allowed an impossible WebAuthn flag combination. Normalize it before the
-- stronger constraint so an upgrade fails closed without stranding otherwise valid credentials.
UPDATE viberacing_private.passkeys
SET backup_state = false
WHERE backup_state AND NOT backup_eligible;

ALTER TABLE viberacing_private.passkeys
  ADD CONSTRAINT passkeys_profile_binding_unique UNIQUE (passkey_id, profile_id),
  ADD CONSTRAINT passkeys_backup_state_consistent CHECK (NOT backup_state OR backup_eligible);

ALTER TABLE viberacing_private.sessions
  ADD COLUMN authentication_kind varchar(10) NOT NULL DEFAULT 'enrollment',
  ADD COLUMN authenticated_by_passkey_id uuid,
  ADD CONSTRAINT sessions_authentication_kind CHECK (
    authentication_kind IN ('enrollment', 'passkey')
  ),
  ADD CONSTRAINT sessions_authentication_shape CHECK (
    (authentication_kind = 'enrollment' AND authenticated_by_passkey_id IS NULL)
    OR (authentication_kind = 'passkey' AND authenticated_by_passkey_id IS NOT NULL)
  ),
  ADD CONSTRAINT sessions_authenticated_passkey_fk
    FOREIGN KEY (authenticated_by_passkey_id, profile_id)
    REFERENCES viberacing_private.passkeys (passkey_id, profile_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

-- Existing sessions were not cryptographically attributable to a credential. Profiles that
-- already have a passkey must sign in once under the new contract instead of inheriting authority.
UPDATE viberacing_private.sessions AS session_record
SET
  state = 'revoked',
  ended_at = pg_catalog.statement_timestamp()
WHERE session_record.state = 'active'
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.passkeys AS passkey_record
    WHERE passkey_record.profile_id = session_record.profile_id
      AND passkey_record.state = 'active'
  );

CREATE INDEX sessions_authenticated_passkey_idx
  ON viberacing_private.sessions (authenticated_by_passkey_id, state)
  WHERE authenticated_by_passkey_id IS NOT NULL;

ALTER TABLE viberacing_private.auth_challenges
  ADD COLUMN verified_by_passkey_id uuid,
  ADD COLUMN authorized_passkey_action varchar(6),
  ADD COLUMN authorized_passkey_id uuid,
  ADD CONSTRAINT auth_challenges_verified_passkey_fk
    FOREIGN KEY (verified_by_passkey_id, profile_id)
    REFERENCES viberacing_private.passkeys (passkey_id, profile_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT auth_challenges_authorized_passkey_fk
    FOREIGN KEY (authorized_passkey_id, profile_id)
    REFERENCES viberacing_private.passkeys (passkey_id, profile_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT auth_challenges_passkey_action CHECK (
    authorized_passkey_action IS NULL OR authorized_passkey_action IN ('add', 'revoke')
  ),
  ADD CONSTRAINT auth_challenges_verification_shape CHECK (
    (
      purpose IN ('passkey_login', 'passkey_registration')
      AND verified_by_passkey_id IS NULL
    )
    OR (
      purpose NOT IN ('passkey_login', 'passkey_registration')
      AND (
        (consumed_at IS NULL AND verified_by_passkey_id IS NULL)
        OR (consumed_at IS NOT NULL AND verified_by_passkey_id IS NOT NULL)
      )
    )
  );

ALTER TABLE viberacing_private.auth_challenges
  DROP CONSTRAINT auth_challenges_authorization_binding_shape;
ALTER TABLE viberacing_private.auth_challenges
  ADD CONSTRAINT auth_challenges_authorization_binding_shape CHECK (
    (
      purpose = 'pairing_approval'
      AND authorized_pairing_id IS NOT NULL
      AND authorized_source_choice IS NOT NULL
      AND authorized_source_id IS NOT NULL
      AND authorized_passkey_action IS NULL
      AND authorized_passkey_id IS NULL
    )
    OR (
      purpose IN ('source_reactivation', 'source_unlink')
      AND authorized_pairing_id IS NULL
      AND authorized_source_choice IS NULL
      AND authorized_source_id IS NOT NULL
      AND authorized_passkey_action IS NULL
      AND authorized_passkey_id IS NULL
    )
    OR (
      purpose = 'passkey_change'
      AND authorized_pairing_id IS NULL
      AND authorized_source_choice IS NULL
      AND authorized_source_id IS NULL
      AND (
        (authorized_passkey_action = 'add' AND authorized_passkey_id IS NULL)
        OR (authorized_passkey_action = 'revoke' AND authorized_passkey_id IS NOT NULL)
      )
    )
    OR (
      purpose NOT IN (
        'pairing_approval',
        'source_reactivation',
        'source_unlink',
        'passkey_change'
      )
      AND authorized_pairing_id IS NULL
      AND authorized_source_choice IS NULL
      AND authorized_source_id IS NULL
      AND authorized_passkey_action IS NULL
      AND authorized_passkey_id IS NULL
    )
  );

CREATE INDEX auth_challenges_verified_passkey_idx
  ON viberacing_private.auth_challenges (verified_by_passkey_id, authorized_action_used_at)
  WHERE verified_by_passkey_id IS NOT NULL;
CREATE INDEX auth_challenges_authorized_passkey_idx
  ON viberacing_private.auth_challenges (authorized_passkey_id, profile_id)
  WHERE authorized_passkey_id IS NOT NULL;

ALTER TABLE viberacing_private.pairing_transactions
  ADD COLUMN approved_by_session_id uuid,
  ADD COLUMN approved_by_passkey_id uuid,
  ADD CONSTRAINT pairing_approved_session_fk
    FOREIGN KEY (approved_by_session_id, approved_profile_id)
    REFERENCES viberacing_private.sessions (session_id, profile_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT pairing_approved_passkey_fk
    FOREIGN KEY (approved_by_passkey_id, approved_profile_id)
    REFERENCES viberacing_private.passkeys (passkey_id, profile_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT pairing_approval_provenance_shape CHECK (
    (state = 'pending' AND approved_by_session_id IS NULL AND approved_by_passkey_id IS NULL)
    OR state = 'cancelled'
    OR (
      state IN ('approved', 'activated')
      AND (
        (approved_by_session_id IS NULL AND approved_by_passkey_id IS NULL)
        OR (approved_by_session_id IS NOT NULL AND approved_by_passkey_id IS NOT NULL)
      )
      AND (state <> 'approved' OR approved_by_session_id IS NOT NULL)
    )
  );

CREATE INDEX pairing_transactions_approval_passkey_idx
  ON viberacing_private.pairing_transactions (approved_by_passkey_id, state)
  WHERE approved_by_passkey_id IS NOT NULL;

ALTER TABLE viberacing_private.audit_events
  DROP CONSTRAINT audit_events_type;
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
      'deletion.requested'
    )
  );

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
      'deletion.requested'
    )
    OR p_actor_kind IS NULL
    OR p_actor_kind NOT IN ('admin', 'profile', 'system', 'job')
    OR (p_actor_kind = 'profile') IS DISTINCT FROM (p_profile_id IS NOT NULL)
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

CREATE FUNCTION viberacing_private.enforce_passkey_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.passkey_id IS DISTINCT FROM OLD.passkey_id
    OR NEW.profile_id IS DISTINCT FROM OLD.profile_id
    OR NEW.credential_id IS DISTINCT FROM OLD.credential_id
    OR NEW.cose_public_key IS DISTINCT FROM OLD.cose_public_key
    OR NEW.label IS DISTINCT FROM OLD.label
    OR NEW.backup_eligible IS DISTINCT FROM OLD.backup_eligible
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'passkey identity is immutable';
  END IF;

  IF NEW.sign_count < OLD.sign_count
    OR (OLD.last_used_at IS NOT NULL AND NEW.last_used_at < OLD.last_used_at)
    OR (OLD.last_used_at IS NOT NULL AND NEW.last_used_at IS NULL) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'passkey usage state cannot move backward';
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state
    AND NOT (
      OLD.state = 'active'
      AND NEW.state = 'revoked'
      AND OLD.revoked_at IS NULL
      AND NEW.revoked_at IS NOT NULL
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'invalid passkey state transition';
  END IF;

  IF NEW.state = OLD.state AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'passkey revocation time is immutable';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER passkeys_enforce_update
BEFORE UPDATE ON viberacing_private.passkeys
FOR EACH ROW EXECUTE FUNCTION viberacing_private.enforce_passkey_update();

CREATE OR REPLACE FUNCTION viberacing_private.enforce_pairing_update()
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

  IF (
      NEW.approved_profile_id IS DISTINCT FROM OLD.approved_profile_id
      OR NEW.source_choice IS DISTINCT FROM OLD.source_choice
      OR NEW.approved_source_id IS DISTINCT FROM OLD.approved_source_id
      OR NEW.approved_by_session_id IS DISTINCT FROM OLD.approved_by_session_id
      OR NEW.approved_by_passkey_id IS DISTINCT FROM OLD.approved_by_passkey_id
      OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
    )
    AND NOT (
      OLD.state = 'pending'
      AND NEW.state = 'approved'
      AND OLD.approved_profile_id IS NULL
      AND OLD.source_choice IS NULL
      AND OLD.approved_source_id IS NULL
      AND OLD.approved_by_session_id IS NULL
      AND OLD.approved_by_passkey_id IS NULL
      AND OLD.approved_at IS NULL
      AND NEW.approved_profile_id IS NOT NULL
      AND NEW.source_choice IS NOT NULL
      AND NEW.approved_source_id IS NOT NULL
      AND NEW.approved_by_session_id IS NOT NULL
      AND NEW.approved_by_passkey_id IS NOT NULL
      AND NEW.approved_at IS NOT NULL
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'pairing approval binding is immutable';
  END IF;

  IF (
      NEW.activated_device_id IS DISTINCT FROM OLD.activated_device_id
      OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
    )
    AND NOT (
      OLD.state = 'approved'
      AND NEW.state = 'activated'
      AND OLD.activated_device_id IS NULL
      AND OLD.activated_at IS NULL
      AND NEW.activated_device_id IS NOT NULL
      AND NEW.activated_at IS NOT NULL
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'pairing activation binding is immutable';
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

CREATE OR REPLACE FUNCTION viberacing_api.consume_auth_challenge(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_challenge_id uuid,
  p_purpose text,
  p_challenge_digest bytea,
  p_context_digest bytea
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  authenticated_profile_id uuid;
  changed_rows bigint;
BEGIN
  IF p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32
    OR p_challenge_id IS NULL
    OR p_purpose <> 'passkey_registration'
    OR pg_catalog.octet_length(p_challenge_digest) IS DISTINCT FROM 32
    OR pg_catalog.octet_length(p_context_digest) IS DISTINCT FROM 32 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  authenticated_profile_id := viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest,
    ARRAY['enrolling']
  );

  UPDATE viberacing_private.auth_challenges
  SET consumed_at = pg_catalog.statement_timestamp()
  WHERE challenge_id = p_challenge_id
    AND profile_id = authenticated_profile_id
    AND session_id = p_session_id
    AND purpose = 'passkey_registration'
    AND challenge_digest = p_challenge_digest
    AND context_digest = p_context_digest
    AND consumed_at IS NULL
    AND expires_at >= pg_catalog.statement_timestamp();

  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  RETURN changed_rows = 1;
END
$function$;

CREATE OR REPLACE FUNCTION viberacing_api.register_initial_passkey(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_challenge_id uuid,
  p_passkey_id uuid,
  p_credential_id bytea,
  p_cose_public_key bytea,
  p_label text,
  p_sign_count bigint,
  p_backup_eligible boolean,
  p_backup_state boolean,
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
  now_at timestamptz(3) := pg_catalog.statement_timestamp();
BEGIN
  IF p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32
    OR p_challenge_id IS NULL
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
    OR p_audit_event_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  authenticated_profile_id := viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest,
    ARRAY['enrolling']
  );

  PERFORM viberacing_private.claim_authorized_action(
    p_challenge_id,
    authenticated_profile_id,
    p_session_id,
    'passkey_registration'
  );

  IF EXISTS (
      SELECT 1
      FROM viberacing_private.passkeys
      WHERE profile_id = authenticated_profile_id
    ) THEN
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
    authenticated_profile_id,
    p_credential_id,
    p_cose_public_key,
    p_label,
    p_sign_count,
    p_backup_eligible,
    p_backup_state,
    'active',
    now_at
  );

  UPDATE viberacing_private.sessions
  SET
    authentication_kind = 'passkey',
    authenticated_by_passkey_id = p_passkey_id
  WHERE session_id = p_session_id
    AND profile_id = authenticated_profile_id
    AND state = 'active';

  UPDATE viberacing_private.profiles
  SET state = 'active'
  WHERE profile_id = authenticated_profile_id;

  PERFORM viberacing_private.append_audit_event(
    p_audit_event_id,
    'passkey.registered',
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

CREATE OR REPLACE FUNCTION viberacing_api.rotate_session(
  p_old_session_id uuid,
  p_old_session_verifier_digest bytea,
  p_new_session_id uuid,
  p_new_verifier_digest bytea,
  p_new_expires_at timestamptz,
  p_audit_event_id uuid,
  p_request_id text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  session_profile_id uuid;
  session_authentication_kind text;
  session_passkey_id uuid;
  now_at timestamptz(3) := pg_catalog.statement_timestamp();
BEGIN
  IF p_old_session_id IS NULL
    OR pg_catalog.octet_length(p_old_session_verifier_digest) IS DISTINCT FROM 32
    OR p_new_session_id IS NULL
    OR p_new_session_id = p_old_session_id
    OR pg_catalog.octet_length(p_new_verifier_digest) IS DISTINCT FROM 32
    OR p_new_expires_at IS NULL
    OR p_new_expires_at <= now_at
    OR p_new_expires_at > now_at + INTERVAL '31 days'
    OR p_audit_event_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  session_profile_id := viberacing_private.authenticate_session(
    p_old_session_id,
    p_old_session_verifier_digest,
    ARRAY['enrolling', 'active', 'hidden']
  );

  SELECT authentication_kind, authenticated_by_passkey_id
  INTO session_authentication_kind, session_passkey_id
  FROM viberacing_private.sessions
  WHERE session_id = p_old_session_id
    AND profile_id = session_profile_id;

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
    p_new_session_id,
    session_profile_id,
    p_new_verifier_digest,
    'active',
    now_at,
    p_new_expires_at,
    session_authentication_kind,
    session_passkey_id
  );

  UPDATE viberacing_private.sessions
  SET
    state = 'rotated',
    ended_at = now_at,
    replaced_by_session_id = p_new_session_id
  WHERE session_id = p_old_session_id;

  PERFORM viberacing_private.append_audit_event(
    p_audit_event_id,
    'session.rotated',
    'profile',
    session_profile_id,
    p_request_id,
    NULL
  );

  RETURN session_profile_id;
EXCEPTION
  WHEN integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
    RETURN NULL;
END
$function$;

CREATE FUNCTION viberacing_api.create_passkey_login_challenge(
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
  now_at timestamptz(3) := pg_catalog.statement_timestamp();
BEGIN
  IF p_challenge_id IS NULL
    OR pg_catalog.octet_length(p_challenge_digest) IS DISTINCT FROM 32
    OR pg_catalog.octet_length(p_context_digest) IS DISTINCT FROM 32
    OR p_expires_at IS NULL
    OR p_expires_at <= now_at
    OR p_expires_at > now_at + INTERVAL '5 minutes' THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  INSERT INTO viberacing_private.auth_challenges (
    challenge_id,
    purpose,
    challenge_digest,
    context_digest,
    user_verification_required,
    created_at,
    expires_at
  )
  VALUES (
    p_challenge_id,
    'passkey_login',
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

CREATE FUNCTION viberacing_api.read_passkey_verification_material(p_credential_id bytea)
RETURNS TABLE (
  passkey_id uuid,
  cose_public_key bytea,
  sign_count bigint,
  backup_eligible boolean,
  backup_state boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF p_credential_id IS NULL
    OR pg_catalog.octet_length(p_credential_id) NOT BETWEEN 16 AND 1024 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  RETURN QUERY
  SELECT
    passkey_record.passkey_id,
    passkey_record.cose_public_key,
    passkey_record.sign_count,
    passkey_record.backup_eligible,
    passkey_record.backup_state
  FROM viberacing_private.passkeys AS passkey_record
  JOIN viberacing_private.profiles AS profile_record
    ON profile_record.profile_id = passkey_record.profile_id
  WHERE passkey_record.credential_id = p_credential_id
    AND passkey_record.state = 'active'
    AND profile_record.state IN ('active', 'hidden');
END
$function$;

CREATE FUNCTION viberacing_api.complete_passkey_login(
  p_challenge_id uuid,
  p_challenge_digest bytea,
  p_context_digest bytea,
  p_passkey_id uuid,
  p_credential_id bytea,
  p_observed_sign_count bigint,
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
  authenticated_profile_id uuid;
  locked_passkey_id uuid;
  locked_backup_eligible boolean;
  active_session_count bigint;
  changed_rows bigint;
  now_at timestamptz(3) := pg_catalog.statement_timestamp();
BEGIN
  IF p_challenge_id IS NULL
    OR pg_catalog.octet_length(p_challenge_digest) IS DISTINCT FROM 32
    OR pg_catalog.octet_length(p_context_digest) IS DISTINCT FROM 32
    OR p_passkey_id IS NULL
    OR p_credential_id IS NULL
    OR pg_catalog.octet_length(p_credential_id) NOT BETWEEN 16 AND 1024
    OR p_observed_sign_count IS NULL
    OR p_observed_sign_count < 0
    OR p_backup_state IS NULL
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
  FROM viberacing_private.passkeys
  WHERE passkey_id = p_passkey_id
    AND credential_id = p_credential_id
    AND state = 'active';

  IF candidate_profile_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT profile_id
  INTO authenticated_profile_id
  FROM viberacing_private.profiles
  WHERE profile_id = candidate_profile_id
    AND state IN ('active', 'hidden')
  FOR UPDATE;

  IF authenticated_profile_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT passkey_id, backup_eligible
  INTO locked_passkey_id, locked_backup_eligible
  FROM viberacing_private.passkeys
  WHERE passkey_id = p_passkey_id
    AND profile_id = authenticated_profile_id
    AND credential_id = p_credential_id
    AND state = 'active'
  FOR UPDATE;

  IF locked_passkey_id IS NULL OR (p_backup_state AND NOT locked_backup_eligible) THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT pg_catalog.count(*)
  INTO active_session_count
  FROM viberacing_private.sessions
  WHERE profile_id = authenticated_profile_id
    AND state = 'active'
    AND expires_at >= now_at;

  IF active_session_count >= 32 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.auth_challenges
  SET
    consumed_at = now_at,
    authorized_action_used_at = now_at
  WHERE challenge_id = p_challenge_id
    AND purpose = 'passkey_login'
    AND profile_id IS NULL
    AND session_id IS NULL
    AND challenge_digest = p_challenge_digest
    AND context_digest = p_context_digest
    AND consumed_at IS NULL
    AND authorized_action_used_at IS NULL
    AND expires_at >= now_at;

  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.passkeys
  SET
    sign_count = GREATEST(sign_count, p_observed_sign_count),
    backup_state = p_backup_state,
    last_used_at = now_at
  WHERE passkey_id = locked_passkey_id;

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
    authenticated_profile_id,
    p_session_verifier_digest,
    'active',
    now_at,
    p_session_expires_at,
    'passkey',
    locked_passkey_id
  );

  PERFORM viberacing_private.append_audit_event(
    p_audit_event_id,
    'passkey.authenticated',
    'profile',
    authenticated_profile_id,
    p_request_id,
    NULL
  );

  RETURN authenticated_profile_id;
EXCEPTION
  WHEN integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
    RETURN NULL;
END
$function$;

CREATE FUNCTION viberacing_api.create_passkey_change_challenge(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_action text,
  p_target_passkey_id uuid,
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
  active_passkey_count bigint;
  lifetime_passkey_count bigint;
  now_at timestamptz(3) := pg_catalog.statement_timestamp();
BEGIN
  IF p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32
    OR p_action IS NULL
    OR p_action NOT IN ('add', 'revoke')
    OR (p_action = 'add' AND p_target_passkey_id IS NOT NULL)
    OR (p_action = 'revoke' AND p_target_passkey_id IS NULL)
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

  SELECT
    pg_catalog.count(*) FILTER (WHERE state = 'active'),
    pg_catalog.count(*)
  INTO active_passkey_count, lifetime_passkey_count
  FROM viberacing_private.passkeys
  WHERE profile_id = authenticated_profile_id;

  IF active_passkey_count = 0
    OR (p_action = 'add' AND lifetime_passkey_count >= 32)
    OR (
      p_action = 'revoke'
      AND (
        active_passkey_count <= 1
        OR NOT EXISTS (
          SELECT 1
          FROM viberacing_private.passkeys
          WHERE passkey_id = p_target_passkey_id
            AND profile_id = authenticated_profile_id
            AND state = 'active'
        )
      )
    ) THEN
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
    authorized_passkey_action,
    authorized_passkey_id,
    created_at,
    expires_at
  )
  VALUES (
    p_challenge_id,
    authenticated_profile_id,
    p_session_id,
    'passkey_change',
    p_challenge_digest,
    p_context_digest,
    true,
    p_action,
    p_target_passkey_id,
    now_at,
    p_expires_at
  );
EXCEPTION
  WHEN integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
END
$function$;

CREATE FUNCTION viberacing_api.consume_passkey_challenge(
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
  now_at timestamptz(3) := pg_catalog.statement_timestamp();
BEGIN
  IF p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32
    OR p_challenge_id IS NULL
    OR p_purpose IS NULL
    OR p_purpose NOT IN (
      'passkey_change',
      'pairing_approval',
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

  IF p_purpose IN ('passkey_change', 'profile_deletion') THEN
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

CREATE FUNCTION viberacing_private.claim_passkey_authorized_action(
  p_challenge_id uuid,
  p_profile_id uuid,
  p_session_id uuid,
  p_action text,
  p_target_passkey_id uuid,
  p_context_digest bytea
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  verifying_passkey_id uuid;
  changed_rows bigint;
BEGIN
  IF p_action NOT IN ('add', 'revoke')
    OR (p_action = 'add' AND p_target_passkey_id IS NOT NULL)
    OR (p_action = 'revoke' AND p_target_passkey_id IS NULL)
    OR pg_catalog.octet_length(p_context_digest) IS DISTINCT FROM 32 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.auth_challenges
  SET authorized_action_used_at = pg_catalog.statement_timestamp()
  WHERE challenge_id = p_challenge_id
    AND profile_id = p_profile_id
    AND session_id = p_session_id
    AND purpose = 'passkey_change'
    AND authorized_passkey_action = p_action
    AND authorized_passkey_id IS NOT DISTINCT FROM p_target_passkey_id
    AND context_digest = p_context_digest
    AND consumed_at IS NOT NULL
    AND verified_by_passkey_id IS NOT NULL
    AND authorized_action_used_at IS NULL
    AND expires_at >= pg_catalog.statement_timestamp()
  RETURNING verified_by_passkey_id INTO verifying_passkey_id;

  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  RETURN verifying_passkey_id;
END
$function$;

CREATE FUNCTION viberacing_api.read_passkey_inventory(
  p_session_id uuid,
  p_session_verifier_digest bytea
)
RETURNS TABLE (
  passkey_id uuid,
  label text,
  state text,
  backup_eligible boolean,
  backup_state boolean,
  created_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  current_authenticator boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  authenticated_profile_id uuid;
  current_passkey_id uuid;
BEGIN
  IF p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  authenticated_profile_id := viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest,
    ARRAY['active', 'hidden']
  );

  SELECT authenticated_by_passkey_id
  INTO current_passkey_id
  FROM viberacing_private.sessions
  WHERE session_id = p_session_id
    AND profile_id = authenticated_profile_id;

  RETURN QUERY
  SELECT
    passkey_record.passkey_id,
    passkey_record.label::text,
    passkey_record.state::text,
    passkey_record.backup_eligible,
    passkey_record.backup_state,
    passkey_record.created_at,
    passkey_record.last_used_at,
    passkey_record.revoked_at,
    passkey_record.passkey_id = current_passkey_id
  FROM viberacing_private.passkeys AS passkey_record
  WHERE passkey_record.profile_id = authenticated_profile_id
  ORDER BY passkey_record.created_at, passkey_record.passkey_id;
END
$function$;

CREATE FUNCTION viberacing_api.add_passkey(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_challenge_id uuid,
  p_context_digest bytea,
  p_passkey_id uuid,
  p_credential_id bytea,
  p_cose_public_key bytea,
  p_label text,
  p_sign_count bigint,
  p_backup_eligible boolean,
  p_backup_state boolean,
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
  lifetime_passkey_count bigint;
  now_at timestamptz(3) := pg_catalog.statement_timestamp();
BEGIN
  IF p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32
    OR p_challenge_id IS NULL
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

  PERFORM viberacing_private.claim_passkey_authorized_action(
    p_challenge_id,
    authenticated_profile_id,
    p_session_id,
    'add',
    NULL,
    p_context_digest
  );

  SELECT pg_catalog.count(*)
  INTO lifetime_passkey_count
  FROM viberacing_private.passkeys
  WHERE profile_id = authenticated_profile_id;

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
    authenticated_profile_id,
    p_credential_id,
    p_cose_public_key,
    p_label,
    p_sign_count,
    p_backup_eligible,
    p_backup_state,
    'active',
    now_at
  );

  PERFORM viberacing_private.append_audit_event(
    p_audit_event_id,
    'passkey.registered',
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

CREATE FUNCTION viberacing_api.revoke_passkey(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_target_passkey_id uuid,
  p_challenge_id uuid,
  p_context_digest bytea,
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
  locked_passkey_id uuid;
  active_passkey_count bigint;
  now_at timestamptz(3) := pg_catalog.statement_timestamp();
BEGIN
  IF p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32
    OR p_target_passkey_id IS NULL
    OR p_challenge_id IS NULL
    OR pg_catalog.octet_length(p_context_digest) IS DISTINCT FROM 32
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

  PERFORM viberacing_private.claim_passkey_authorized_action(
    p_challenge_id,
    authenticated_profile_id,
    p_session_id,
    'revoke',
    p_target_passkey_id,
    p_context_digest
  );

  SELECT passkey_id
  INTO locked_passkey_id
  FROM viberacing_private.passkeys
  WHERE passkey_id = p_target_passkey_id
    AND profile_id = authenticated_profile_id
    AND state = 'active'
  FOR UPDATE;

  IF locked_passkey_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT pg_catalog.count(*)
  INTO active_passkey_count
  FROM viberacing_private.passkeys
  WHERE profile_id = authenticated_profile_id
    AND state = 'active';

  IF active_passkey_count <= 1 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.pairing_transactions AS pairing_record
  SET state = 'cancelled'
  WHERE pairing_record.approved_profile_id = authenticated_profile_id
    AND pairing_record.state = 'approved'
    AND (
      pairing_record.approved_by_passkey_id = locked_passkey_id
      OR pairing_record.approved_by_session_id IN (
        SELECT session_record.session_id
        FROM viberacing_private.sessions AS session_record
        WHERE session_record.profile_id = authenticated_profile_id
          AND session_record.authenticated_by_passkey_id = locked_passkey_id
      )
    );

  DELETE FROM viberacing_private.auth_challenges AS challenge_record
  WHERE challenge_record.profile_id = authenticated_profile_id
    AND challenge_record.authorized_action_used_at IS NULL
    AND (
      challenge_record.verified_by_passkey_id = locked_passkey_id
      OR challenge_record.session_id IN (
        SELECT session_record.session_id
        FROM viberacing_private.sessions AS session_record
        WHERE session_record.profile_id = authenticated_profile_id
          AND session_record.authenticated_by_passkey_id = locked_passkey_id
      )
    );

  UPDATE viberacing_private.sessions
  SET
    state = 'revoked',
    ended_at = now_at
  WHERE profile_id = authenticated_profile_id
    AND authenticated_by_passkey_id = locked_passkey_id
    AND state = 'active';

  UPDATE viberacing_private.passkeys
  SET
    state = 'revoked',
    revoked_at = now_at
  WHERE passkey_id = locked_passkey_id;

  PERFORM viberacing_private.append_audit_event(
    p_audit_event_id,
    'passkey.revoked',
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

CREATE OR REPLACE FUNCTION viberacing_api.approve_pairing(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_pairing_id uuid,
  p_challenge_id uuid,
  p_context_digest bytea,
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
  authorized_source_choice text;
  authorized_source_id text;
  verifying_passkey_id uuid;
  locked_device_key_id uuid;
  changed_rows bigint;
  source_count bigint;
  device_authority_count bigint;
  now_at timestamptz := pg_catalog.statement_timestamp();
BEGIN
  IF p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32
    OR p_pairing_id IS NULL
    OR p_challenge_id IS NULL
    OR pg_catalog.octet_length(p_context_digest) IS DISTINCT FROM 32
    OR p_audit_event_id IS NULL
    OR p_request_id IS NULL
    OR p_request_id !~ '^req_[A-Za-z0-9_-]{22}$' THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  authenticated_profile_id := viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest,
    ARRAY['active']
  );

  UPDATE viberacing_private.auth_challenges AS challenge_record
  SET authorized_action_used_at = now_at
  WHERE challenge_record.challenge_id = p_challenge_id
    AND challenge_record.profile_id = authenticated_profile_id
    AND challenge_record.session_id = p_session_id
    AND challenge_record.purpose = 'pairing_approval'
    AND challenge_record.context_digest = p_context_digest
    AND challenge_record.authorized_pairing_id = p_pairing_id
    AND challenge_record.consumed_at IS NOT NULL
    AND challenge_record.verified_by_passkey_id IS NOT NULL
    AND challenge_record.authorized_action_used_at IS NULL
    AND challenge_record.expires_at >= now_at
  RETURNING
    challenge_record.authorized_source_choice,
    challenge_record.authorized_source_id,
    challenge_record.verified_by_passkey_id
  INTO authorized_source_choice, authorized_source_id, verifying_passkey_id;

  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT pending_device_key_id
  INTO locked_device_key_id
  FROM viberacing_private.pairing_transactions
  WHERE pairing_id = p_pairing_id
    AND state = 'pending'
    AND expires_at >= now_at
  FOR UPDATE;

  IF locked_device_key_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT pg_catalog.count(*)
  INTO source_count
  FROM viberacing_private.codex_sources
  WHERE profile_id = authenticated_profile_id;

  IF authorized_source_choice = 'new' THEN
    IF source_count >= 32
      OR EXISTS (
        SELECT 1
        FROM viberacing_private.codex_sources
        WHERE source_id = authorized_source_id
      ) THEN
      PERFORM viberacing_private.operation_failed();
    END IF;
  ELSE
    PERFORM 1
    FROM viberacing_private.codex_sources
    WHERE profile_id = authenticated_profile_id
      AND source_id = authorized_source_id
      AND state = 'active'
    FOR UPDATE;

    IF NOT FOUND THEN
      PERFORM viberacing_private.operation_failed();
    END IF;
  END IF;

  SELECT
    (
      SELECT pg_catalog.count(*)
      FROM viberacing_private.device_keys AS key_record
      JOIN viberacing_private.codex_sources AS source_record
        ON source_record.source_id = key_record.source_id
      WHERE source_record.profile_id = authenticated_profile_id
        AND key_record.state = 'active'
    )
    + (
      SELECT pg_catalog.count(*)
      FROM viberacing_private.pairing_transactions AS approved_pairing
      WHERE approved_pairing.approved_profile_id = authenticated_profile_id
        AND approved_pairing.state = 'approved'
        AND approved_pairing.expires_at >= now_at
    )
  INTO device_authority_count;

  IF device_authority_count >= 64 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  IF authorized_source_choice = 'new' THEN
    INSERT INTO viberacing_private.codex_sources (
      source_id,
      profile_id,
      state,
      created_at,
      state_changed_at
    )
    VALUES (
      authorized_source_id,
      authenticated_profile_id,
      'active',
      now_at,
      now_at
    );
  END IF;

  UPDATE viberacing_private.pairing_transactions
  SET
    state = 'approved',
    approved_profile_id = authenticated_profile_id,
    source_choice = authorized_source_choice,
    approved_source_id = authorized_source_id,
    approved_by_session_id = p_session_id,
    approved_by_passkey_id = verifying_passkey_id,
    approved_at = now_at
  WHERE pairing_id = p_pairing_id;

  PERFORM viberacing_private.append_audit_event(
    p_audit_event_id,
    'pairing.approved',
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

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (5, 'passkey_login_and_management');

COMMIT;
