\set ON_ERROR_STOP on

-- Revision 0002: procedure-only identity lifecycle capabilities and bounded audit references.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

ALTER TABLE viberacing_private.auth_challenges
  ADD COLUMN session_id uuid,
  ADD COLUMN authorized_action_used_at timestamptz(3);

ALTER TABLE viberacing_private.sessions
  ADD CONSTRAINT sessions_profile_binding_unique UNIQUE (session_id, profile_id);

ALTER TABLE viberacing_private.auth_challenges
  ADD CONSTRAINT auth_challenges_session_profile_fk
  FOREIGN KEY (session_id, profile_id)
  REFERENCES viberacing_private.sessions (session_id, profile_id)
  ON DELETE CASCADE;

ALTER TABLE viberacing_private.auth_challenges
  DROP CONSTRAINT auth_challenges_purpose;
ALTER TABLE viberacing_private.auth_challenges
  ADD CONSTRAINT auth_challenges_purpose CHECK (
    purpose IN (
      'passkey_login',
      'passkey_registration',
      'passkey_change',
      'pairing_approval',
      'recovery_change',
      'source_reactivation',
      'source_unlink',
      'profile_deletion'
    )
  );
ALTER TABLE viberacing_private.auth_challenges
  ADD CONSTRAINT auth_challenges_action_order CHECK (
    authorized_action_used_at IS NULL
    OR (
      consumed_at IS NOT NULL
      AND authorized_action_used_at >= consumed_at
      AND authorized_action_used_at <= expires_at
    )
  );
ALTER TABLE viberacing_private.auth_challenges
  DROP CONSTRAINT auth_challenges_profile_shape;
ALTER TABLE viberacing_private.auth_challenges
  ADD CONSTRAINT auth_challenges_authority_shape CHECK (
    (
      purpose = 'passkey_login'
      AND profile_id IS NULL
      AND session_id IS NULL
    )
    OR (
      purpose <> 'passkey_login'
      AND profile_id IS NOT NULL
      AND session_id IS NOT NULL
    )
  );

CREATE TABLE viberacing_private.audit_events (
  audit_event_id uuid PRIMARY KEY,
  event_type varchar(32) NOT NULL,
  actor_kind varchar(12) NOT NULL,
  profile_id uuid REFERENCES viberacing_private.profiles (profile_id) ON DELETE SET NULL,
  request_id varchar(26) NOT NULL,
  reason_code varchar(64),
  occurred_at timestamptz(3) NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  CONSTRAINT audit_events_type CHECK (
    event_type IN (
      'invite.issued',
      'profile.enrolled',
      'passkey.registered',
      'session.rotated',
      'session.revoked',
      'deletion.requested'
    )
  ),
  CONSTRAINT audit_events_actor CHECK (actor_kind IN ('admin', 'profile', 'system', 'job')),
  CONSTRAINT audit_events_request_id_format CHECK (
    request_id ~ '^req_[A-Za-z0-9_-]{22}$'
  ),
  CONSTRAINT audit_events_reason_code_format CHECK (
    reason_code IS NULL OR reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'
  ),
  CONSTRAINT audit_events_actor_shape CHECK (
    actor_kind = 'profile' OR profile_id IS NULL
  ),
  CONSTRAINT audit_events_request_type_unique UNIQUE (request_id, event_type)
);

CREATE INDEX audit_events_profile_time_idx
  ON viberacing_private.audit_events (profile_id, occurred_at DESC)
  WHERE profile_id IS NOT NULL;
CREATE INDEX audit_events_time_idx
  ON viberacing_private.audit_events (occurred_at);

ALTER TABLE viberacing_private.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_events_owner_all ON viberacing_private.audit_events
  FOR ALL TO viberacing_owner USING (true) WITH CHECK (true);

CREATE FUNCTION viberacing_private.operation_failed()
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = 'P0001',
    MESSAGE = 'operation cannot be completed';
END
$function$;

CREATE FUNCTION viberacing_private.append_audit_event(
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
      'session.rotated',
      'session.revoked',
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

CREATE FUNCTION viberacing_private.authenticate_session(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_allowed_profile_states text[]
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  authenticated_profile_id uuid;
BEGIN
  SELECT session_record.profile_id
  INTO authenticated_profile_id
  FROM viberacing_private.sessions AS session_record
  JOIN viberacing_private.profiles AS profile_record
    ON profile_record.profile_id = session_record.profile_id
  WHERE session_record.session_id = p_session_id
    AND session_record.verifier_digest = p_session_verifier_digest
    AND session_record.state = 'active'
    AND session_record.expires_at >= pg_catalog.statement_timestamp()
    AND profile_record.state = ANY (p_allowed_profile_states)
  FOR UPDATE OF session_record, profile_record;

  IF authenticated_profile_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  RETURN authenticated_profile_id;
END
$function$;

CREATE FUNCTION viberacing_private.claim_authorized_action(
  p_challenge_id uuid,
  p_profile_id uuid,
  p_session_id uuid,
  p_purpose text
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  changed_rows bigint;
BEGIN
  UPDATE viberacing_private.auth_challenges
  SET authorized_action_used_at = pg_catalog.statement_timestamp()
  WHERE challenge_id = p_challenge_id
    AND profile_id = p_profile_id
    AND session_id = p_session_id
    AND purpose = p_purpose
    AND consumed_at IS NOT NULL
    AND authorized_action_used_at IS NULL
    AND expires_at >= pg_catalog.statement_timestamp();

  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
END
$function$;

CREATE FUNCTION viberacing_api.issue_invite(
  p_invite_id uuid,
  p_verifier_digest bytea,
  p_expires_at timestamptz,
  p_audit_event_id uuid,
  p_request_id text,
  p_reason_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  now_at timestamptz(3) := pg_catalog.statement_timestamp();
BEGIN
  IF p_invite_id IS NULL
    OR pg_catalog.octet_length(p_verifier_digest) IS DISTINCT FROM 32
    OR p_expires_at IS NULL
    OR p_expires_at <= now_at
    OR p_expires_at > now_at + INTERVAL '90 days'
    OR p_audit_event_id IS NULL
    OR p_reason_code IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  INSERT INTO viberacing_private.invites (
    invite_id,
    verifier_digest,
    created_at,
    expires_at
  )
  VALUES (p_invite_id, p_verifier_digest, now_at, p_expires_at);

  PERFORM viberacing_private.append_audit_event(
    p_audit_event_id,
    'invite.issued',
    'admin',
    NULL,
    p_request_id,
    p_reason_code
  );
EXCEPTION
  WHEN integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
END
$function$;

CREATE FUNCTION viberacing_api.enroll_profile(
  p_invite_id uuid,
  p_invite_verifier_digest bytea,
  p_profile_id uuid,
  p_github_user_id bigint,
  p_handle text,
  p_locale text,
  p_theme text,
  p_motion_preference text,
  p_streak_visible boolean,
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_session_expires_at timestamptz,
  p_audit_event_id uuid,
  p_request_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  changed_rows bigint;
  now_at timestamptz(3) := pg_catalog.statement_timestamp();
BEGIN
  IF p_invite_id IS NULL
    OR pg_catalog.octet_length(p_invite_verifier_digest) IS DISTINCT FROM 32
    OR p_profile_id IS NULL
    OR p_github_user_id IS NULL
    OR p_github_user_id <= 0
    OR p_handle IS NULL
    OR p_handle !~ '^[a-z0-9][a-z0-9_-]{1,22}[a-z0-9]$'
    OR p_locale IS NULL
    OR p_locale NOT IN ('en', 'ru')
    OR p_theme IS NULL
    OR p_theme NOT IN ('classic-grand-prix', 'cyber-rally', 'neon-night')
    OR p_motion_preference IS NULL
    OR p_motion_preference NOT IN ('off', 'on', 'system')
    OR p_streak_visible IS NULL
    OR p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32
    OR p_session_expires_at IS NULL
    OR p_session_expires_at <= now_at
    OR p_session_expires_at > now_at + INTERVAL '31 days'
    OR p_audit_event_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  INSERT INTO viberacing_private.profiles (
    profile_id,
    github_user_id,
    handle,
    state,
    locale,
    theme,
    motion_preference,
    streak_visible,
    created_at,
    updated_at
  )
  VALUES (
    p_profile_id,
    p_github_user_id,
    p_handle,
    'enrolling',
    p_locale,
    p_theme,
    p_motion_preference,
    p_streak_visible,
    now_at,
    now_at
  );

  UPDATE viberacing_private.invites
  SET
    state = 'redeemed',
    redeemed_at = now_at,
    redeemed_profile_id = p_profile_id
  WHERE invite_id = p_invite_id
    AND verifier_digest = p_invite_verifier_digest
    AND state = 'active'
    AND expires_at >= now_at;

  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  INSERT INTO viberacing_private.sessions (
    session_id,
    profile_id,
    verifier_digest,
    state,
    created_at,
    expires_at
  )
  VALUES (
    p_session_id,
    p_profile_id,
    p_session_verifier_digest,
    'active',
    now_at,
    p_session_expires_at
  );

  PERFORM viberacing_private.append_audit_event(
    p_audit_event_id,
    'profile.enrolled',
    'profile',
    p_profile_id,
    p_request_id,
    NULL
  );
EXCEPTION
  WHEN integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
END
$function$;

CREATE FUNCTION viberacing_api.create_auth_challenge(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_challenge_id uuid,
  p_purpose text,
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
  allowed_profile_states text[];
  now_at timestamptz(3) := pg_catalog.statement_timestamp();
BEGIN
  IF p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32
    OR p_challenge_id IS NULL
    OR pg_catalog.octet_length(p_challenge_digest) IS DISTINCT FROM 32
    OR pg_catalog.octet_length(p_context_digest) IS DISTINCT FROM 32
    OR p_expires_at IS NULL
    OR p_expires_at <= now_at
    OR p_expires_at > now_at + INTERVAL '15 minutes' THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  IF p_purpose = 'passkey_registration' THEN
    allowed_profile_states := ARRAY['enrolling'];
  ELSIF p_purpose = 'profile_deletion' THEN
    allowed_profile_states := ARRAY['active', 'hidden'];
  ELSE
    PERFORM viberacing_private.operation_failed();
  END IF;

  authenticated_profile_id := viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest,
    allowed_profile_states
  );

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
    p_purpose,
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

CREATE FUNCTION viberacing_api.consume_auth_challenge(
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
  allowed_profile_states text[];
  changed_rows bigint;
BEGIN
  IF p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32
    OR p_challenge_id IS NULL
    OR pg_catalog.octet_length(p_challenge_digest) IS DISTINCT FROM 32
    OR pg_catalog.octet_length(p_context_digest) IS DISTINCT FROM 32 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  IF p_purpose = 'passkey_registration' THEN
    allowed_profile_states := ARRAY['enrolling'];
  ELSIF p_purpose = 'profile_deletion' THEN
    allowed_profile_states := ARRAY['active', 'hidden'];
  ELSE
    PERFORM viberacing_private.operation_failed();
  END IF;

  authenticated_profile_id := viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest,
    allowed_profile_states
  );

  UPDATE viberacing_private.auth_challenges
  SET consumed_at = pg_catalog.statement_timestamp()
  WHERE challenge_id = p_challenge_id
    AND profile_id = authenticated_profile_id
    AND session_id = p_session_id
    AND purpose = p_purpose
    AND challenge_digest = p_challenge_digest
    AND context_digest = p_context_digest
    AND consumed_at IS NULL
    AND expires_at >= pg_catalog.statement_timestamp();

  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  RETURN changed_rows = 1;
END
$function$;

CREATE FUNCTION viberacing_api.register_initial_passkey(
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

CREATE FUNCTION viberacing_api.rotate_session(
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

  INSERT INTO viberacing_private.sessions (
    session_id,
    profile_id,
    verifier_digest,
    state,
    created_at,
    expires_at
  )
  VALUES (
    p_new_session_id,
    session_profile_id,
    p_new_verifier_digest,
    'active',
    now_at,
    p_new_expires_at
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

CREATE FUNCTION viberacing_api.revoke_session(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_audit_event_id uuid,
  p_request_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  session_profile_id uuid;
BEGIN
  IF p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32
    OR p_audit_event_id IS NULL
    OR p_request_id IS NULL
    OR p_request_id !~ '^req_[A-Za-z0-9_-]{22}$' THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.sessions
  SET
    state = 'revoked',
    ended_at = pg_catalog.statement_timestamp()
  WHERE session_id = p_session_id
    AND verifier_digest = p_session_verifier_digest
    AND state = 'active'
  RETURNING profile_id INTO session_profile_id;

  IF session_profile_id IS NULL THEN
    RETURN false;
  END IF;

  PERFORM viberacing_private.append_audit_event(
    p_audit_event_id,
    'session.revoked',
    'profile',
    session_profile_id,
    p_request_id,
    NULL
  );
  RETURN true;
EXCEPTION
  WHEN integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
    RETURN false;
END
$function$;

CREATE FUNCTION viberacing_api.request_profile_deletion(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_typed_handle text,
  p_challenge_id uuid,
  p_deletion_job_id uuid,
  p_profile_ref_digest bytea,
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
  locked_profile_id uuid;
  now_at timestamptz(3) := pg_catalog.statement_timestamp();
BEGIN
  IF p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32
    OR p_typed_handle IS NULL
    OR p_typed_handle !~ '^[a-z0-9][a-z0-9_-]{1,22}[a-z0-9]$'
    OR p_challenge_id IS NULL
    OR p_deletion_job_id IS NULL
    OR pg_catalog.octet_length(p_profile_ref_digest) IS DISTINCT FROM 32
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

  PERFORM viberacing_private.claim_authorized_action(
    p_challenge_id,
    authenticated_profile_id,
    p_session_id,
    'profile_deletion'
  );

  SELECT profile_id
  INTO locked_profile_id
  FROM viberacing_private.profiles
  WHERE profile_id = authenticated_profile_id
    AND handle = p_typed_handle
    AND state <> 'deletion_pending'
  FOR UPDATE;

  IF locked_profile_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.profiles
  SET
    state = 'deletion_pending',
    hidden_at = COALESCE(hidden_at, now_at),
    deletion_requested_at = now_at
  WHERE profile_id = authenticated_profile_id;

  UPDATE viberacing_private.sessions
  SET
    state = 'revoked',
    ended_at = now_at
  WHERE profile_id = authenticated_profile_id
    AND state = 'active';

  UPDATE viberacing_private.passkeys
  SET
    state = 'revoked',
    revoked_at = now_at
  WHERE profile_id = authenticated_profile_id
    AND state = 'active';

  DELETE FROM viberacing_private.recovery_codes
  WHERE profile_id = authenticated_profile_id;

  DELETE FROM viberacing_private.auth_challenges
  WHERE profile_id = authenticated_profile_id;

  UPDATE viberacing_private.device_keys AS device
  SET
    state = 'revoked',
    revoked_at = now_at
  FROM viberacing_private.codex_sources AS source
  WHERE source.profile_id = authenticated_profile_id
    AND device.source_id = source.source_id
    AND device.state = 'active';

  UPDATE viberacing_private.codex_sources
  SET state = 'unlinked'
  WHERE profile_id = authenticated_profile_id
    AND state IN ('active', 'paused', 'quarantined');

  UPDATE viberacing_private.pairing_transactions
  SET state = 'cancelled'
  WHERE approved_profile_id = authenticated_profile_id
    AND state = 'approved';

  INSERT INTO viberacing_private.deletion_jobs (
    deletion_job_id,
    profile_id,
    profile_ref_digest,
    state,
    requested_at,
    available_at
  )
  VALUES (
    p_deletion_job_id,
    authenticated_profile_id,
    p_profile_ref_digest,
    'queued',
    now_at,
    now_at
  );

  PERFORM viberacing_private.append_audit_event(
    p_audit_event_id,
    'deletion.requested',
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

REVOKE ALL ON TABLE viberacing_private.audit_events
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA viberacing_private
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA viberacing_api
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

REVOKE EXECUTE ON FUNCTION viberacing_api.issue_invite(
  uuid, bytea, timestamptz, uuid, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION viberacing_api.issue_invite(
  uuid, bytea, timestamptz, uuid, text, text
) TO viberacing_admin;

REVOKE EXECUTE ON FUNCTION viberacing_api.enroll_profile(
  uuid, bytea, uuid, bigint, text, text, text, text, boolean,
  uuid, bytea, timestamptz, uuid, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION viberacing_api.enroll_profile(
  uuid, bytea, uuid, bigint, text, text, text, text, boolean,
  uuid, bytea, timestamptz, uuid, text
) TO viberacing_web;

REVOKE EXECUTE ON FUNCTION viberacing_api.create_auth_challenge(
  uuid, bytea, uuid, text, bytea, bytea, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION viberacing_api.create_auth_challenge(
  uuid, bytea, uuid, text, bytea, bytea, timestamptz
) TO viberacing_web;

REVOKE EXECUTE ON FUNCTION viberacing_api.consume_auth_challenge(
  uuid, bytea, uuid, text, bytea, bytea
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION viberacing_api.consume_auth_challenge(
  uuid, bytea, uuid, text, bytea, bytea
) TO viberacing_web;

REVOKE EXECUTE ON FUNCTION viberacing_api.register_initial_passkey(
  uuid, bytea, uuid, uuid, bytea, bytea, text, bigint, boolean, boolean, uuid, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION viberacing_api.register_initial_passkey(
  uuid, bytea, uuid, uuid, bytea, bytea, text, bigint, boolean, boolean, uuid, text
) TO viberacing_web;

REVOKE EXECUTE ON FUNCTION viberacing_api.rotate_session(
  uuid, bytea, uuid, bytea, timestamptz, uuid, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION viberacing_api.rotate_session(
  uuid, bytea, uuid, bytea, timestamptz, uuid, text
) TO viberacing_web;

REVOKE EXECUTE ON FUNCTION viberacing_api.revoke_session(uuid, bytea, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION viberacing_api.revoke_session(uuid, bytea, uuid, text)
  TO viberacing_web;

REVOKE EXECUTE ON FUNCTION viberacing_api.request_profile_deletion(
  uuid, bytea, text, uuid, uuid, bytea, uuid, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION viberacing_api.request_profile_deletion(
  uuid, bytea, text, uuid, uuid, bytea, uuid, text
) TO viberacing_web;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (2, 'identity_capabilities');

COMMIT;
