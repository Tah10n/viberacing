\set ON_ERROR_STOP on

-- Revision 0003: session-approved, source-bound pairing with connector possession handoff.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

ALTER TABLE viberacing_private.auth_challenges
  ADD COLUMN authorized_pairing_id uuid
    REFERENCES viberacing_private.pairing_transactions (pairing_id) ON DELETE CASCADE,
  ADD COLUMN authorized_source_choice varchar(8),
  ADD COLUMN authorized_source_id varchar(26);

ALTER TABLE viberacing_private.auth_challenges
  ADD CONSTRAINT auth_challenges_pairing_source_choice CHECK (
    authorized_source_choice IS NULL OR authorized_source_choice IN ('new', 'existing')
  ),
  ADD CONSTRAINT auth_challenges_pairing_source_id CHECK (
    authorized_source_id IS NULL OR authorized_source_id ~ '^src_[A-Za-z0-9_-]{22}$'
  ),
  ADD CONSTRAINT auth_challenges_pairing_binding_shape CHECK (
    (
      purpose = 'pairing_approval'
      AND authorized_pairing_id IS NOT NULL
      AND authorized_source_choice IS NOT NULL
      AND authorized_source_id IS NOT NULL
    )
    OR (
      purpose <> 'pairing_approval'
      AND authorized_pairing_id IS NULL
      AND authorized_source_choice IS NULL
      AND authorized_source_id IS NULL
    )
  );

CREATE INDEX auth_challenges_pairing_idx
  ON viberacing_private.auth_challenges (authorized_pairing_id, profile_id)
  WHERE authorized_pairing_id IS NOT NULL;

ALTER TABLE viberacing_private.audit_events
  DROP CONSTRAINT audit_events_type;
ALTER TABLE viberacing_private.audit_events
  ADD CONSTRAINT audit_events_type CHECK (
    event_type IN (
      'invite.issued',
      'profile.enrolled',
      'passkey.registered',
      'session.rotated',
      'session.revoked',
      'pairing.approved',
      'device.activated',
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
      'session.rotated',
      'session.revoked',
      'pairing.approved',
      'device.activated',
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
      OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
    )
    AND NOT (
      OLD.state = 'pending'
      AND NEW.state = 'approved'
      AND OLD.approved_profile_id IS NULL
      AND OLD.source_choice IS NULL
      AND OLD.approved_source_id IS NULL
      AND OLD.approved_at IS NULL
      AND NEW.approved_profile_id IS NOT NULL
      AND NEW.source_choice IS NOT NULL
      AND NEW.approved_source_id IS NOT NULL
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
  ELSIF p_purpose = 'pairing_approval' THEN
    allowed_profile_states := ARRAY['active'];
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

CREATE FUNCTION viberacing_api.start_pairing(
  p_pairing_id uuid,
  p_poll_verifier_digest bytea,
  p_user_code_digest bytea,
  p_pairing_challenge bytea,
  p_device_key_id uuid,
  p_public_key bytea,
  p_device_label text,
  p_connector_version text,
  p_os_family text,
  p_architecture text,
  p_expires_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  now_at timestamptz := pg_catalog.statement_timestamp();
BEGIN
  IF p_pairing_id IS NULL
    OR pg_catalog.octet_length(p_poll_verifier_digest) IS DISTINCT FROM 32
    OR pg_catalog.octet_length(p_user_code_digest) IS DISTINCT FROM 32
    OR pg_catalog.octet_length(p_pairing_challenge) IS DISTINCT FROM 32
    OR p_device_key_id IS NULL
    OR pg_catalog.octet_length(p_public_key) IS DISTINCT FROM 32
    OR p_device_label IS NULL
    OR pg_catalog.char_length(p_device_label) NOT BETWEEN 1 AND 64
    OR p_device_label <> pg_catalog.btrim(p_device_label)
    OR p_device_label ~ '[[:cntrl:]]'
    OR p_connector_version IS NULL
    OR pg_catalog.char_length(p_connector_version) NOT BETWEEN 5 AND 64
    OR p_connector_version !~ '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$'
    OR p_os_family IS NULL
    OR p_os_family NOT IN ('windows', 'macos', 'linux')
    OR p_architecture IS NULL
    OR p_architecture NOT IN ('x86_64', 'aarch64')
    OR p_expires_at IS NULL
    OR p_expires_at <= now_at
    OR p_expires_at > now_at + INTERVAL '10 minutes' THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  INSERT INTO viberacing_private.device_keys (
    device_key_id,
    public_key,
    label,
    connector_version,
    os_family,
    architecture,
    state,
    created_at
  )
  VALUES (
    p_device_key_id,
    p_public_key,
    p_device_label,
    p_connector_version,
    p_os_family,
    p_architecture,
    'pending',
    now_at
  );

  INSERT INTO viberacing_private.pairing_transactions (
    pairing_id,
    poll_verifier_digest,
    user_code_digest,
    challenge,
    pending_device_key_id,
    device_label,
    connector_version,
    os_family,
    architecture,
    state,
    created_at,
    expires_at
  )
  VALUES (
    p_pairing_id,
    p_poll_verifier_digest,
    p_user_code_digest,
    p_pairing_challenge,
    p_device_key_id,
    p_device_label,
    p_connector_version,
    p_os_family,
    p_architecture,
    'pending',
    now_at,
    p_expires_at
  );
EXCEPTION
  WHEN integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
END
$function$;

CREATE FUNCTION viberacing_api.read_pairing_for_approval(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_user_code_digest bytea
)
RETURNS TABLE (
  pairing_id uuid,
  device_label text,
  connector_version text,
  os_family text,
  architecture text,
  public_key bytea,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32
    OR pg_catalog.octet_length(p_user_code_digest) IS DISTINCT FROM 32 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  PERFORM viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest,
    ARRAY['active']
  );

  RETURN QUERY
  SELECT
    pairing_record.pairing_id,
    pairing_record.device_label::text,
    pairing_record.connector_version::text,
    pairing_record.os_family::text,
    pairing_record.architecture::text,
    key_record.public_key,
    pairing_record.expires_at
  FROM viberacing_private.pairing_transactions AS pairing_record
  JOIN viberacing_private.device_keys AS key_record
    ON key_record.device_key_id = pairing_record.pending_device_key_id
  WHERE pairing_record.user_code_digest = p_user_code_digest
    AND pairing_record.state = 'pending'
    AND pairing_record.expires_at >= pg_catalog.statement_timestamp()
    AND key_record.state = 'pending';
END
$function$;

CREATE FUNCTION viberacing_api.create_pairing_approval_challenge(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_pairing_id uuid,
  p_user_code_digest bytea,
  p_source_choice text,
  p_source_id text,
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
  pairing_expires_at timestamptz(3);
  source_count bigint;
  device_authority_count bigint;
  now_at timestamptz := pg_catalog.statement_timestamp();
BEGIN
  IF p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32
    OR p_pairing_id IS NULL
    OR pg_catalog.octet_length(p_user_code_digest) IS DISTINCT FROM 32
    OR p_source_choice IS NULL
    OR p_source_choice NOT IN ('new', 'existing')
    OR p_source_id IS NULL
    OR p_source_id !~ '^src_[A-Za-z0-9_-]{22}$'
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
    ARRAY['active']
  );

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.passkeys
    WHERE profile_id = authenticated_profile_id
      AND state = 'active'
  ) THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT pairing_record.expires_at
  INTO pairing_expires_at
  FROM viberacing_private.pairing_transactions AS pairing_record
  JOIN viberacing_private.device_keys AS key_record
    ON key_record.device_key_id = pairing_record.pending_device_key_id
  WHERE pairing_record.pairing_id = p_pairing_id
    AND pairing_record.user_code_digest = p_user_code_digest
    AND pairing_record.state = 'pending'
    AND pairing_record.expires_at >= now_at
    AND key_record.state = 'pending'
  FOR UPDATE OF pairing_record, key_record;

  IF pairing_expires_at IS NULL OR p_expires_at > pairing_expires_at THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT pg_catalog.count(*)
  INTO source_count
  FROM viberacing_private.codex_sources
  WHERE profile_id = authenticated_profile_id;

  IF p_source_choice = 'new' THEN
    IF source_count >= 32
      OR EXISTS (
        SELECT 1
        FROM viberacing_private.codex_sources
        WHERE source_id = p_source_id
      ) THEN
      PERFORM viberacing_private.operation_failed();
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.codex_sources
    WHERE profile_id = authenticated_profile_id
      AND source_id = p_source_id
      AND state = 'active'
  ) THEN
    PERFORM viberacing_private.operation_failed();
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

  DELETE FROM viberacing_private.auth_challenges
  WHERE profile_id = authenticated_profile_id
    AND session_id = p_session_id
    AND purpose = 'pairing_approval'
    AND authorized_pairing_id = p_pairing_id
    AND authorized_action_used_at IS NULL;

  INSERT INTO viberacing_private.auth_challenges (
    challenge_id,
    profile_id,
    session_id,
    purpose,
    challenge_digest,
    context_digest,
    user_verification_required,
    authorized_pairing_id,
    authorized_source_choice,
    authorized_source_id,
    created_at,
    expires_at
  )
  VALUES (
    p_challenge_id,
    authenticated_profile_id,
    p_session_id,
    'pairing_approval',
    p_challenge_digest,
    p_context_digest,
    true,
    p_pairing_id,
    p_source_choice,
    p_source_id,
    now_at,
    p_expires_at
  );
EXCEPTION
  WHEN integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
END
$function$;

CREATE FUNCTION viberacing_api.approve_pairing(
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

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.passkeys
    WHERE profile_id = authenticated_profile_id
      AND state = 'active'
  ) THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.auth_challenges AS challenge_record
  SET authorized_action_used_at = now_at
  WHERE challenge_record.challenge_id = p_challenge_id
    AND challenge_record.profile_id = authenticated_profile_id
    AND challenge_record.session_id = p_session_id
    AND challenge_record.purpose = 'pairing_approval'
    AND challenge_record.context_digest = p_context_digest
    AND challenge_record.authorized_pairing_id = p_pairing_id
    AND challenge_record.consumed_at IS NOT NULL
    AND challenge_record.authorized_action_used_at IS NULL
    AND challenge_record.expires_at >= now_at
  RETURNING challenge_record.authorized_source_choice, challenge_record.authorized_source_id
  INTO authorized_source_choice, authorized_source_id;

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

CREATE FUNCTION viberacing_api.read_pairing_verification_material(
  p_poll_verifier_digest bytea
)
RETURNS TABLE (
  pairing_id uuid,
  pairing_challenge bytea,
  public_key bytea,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF pg_catalog.octet_length(p_poll_verifier_digest) IS DISTINCT FROM 32 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  RETURN QUERY
  SELECT
    pairing_record.pairing_id,
    pairing_record.challenge,
    key_record.public_key,
    pairing_record.expires_at
  FROM viberacing_private.pairing_transactions AS pairing_record
  JOIN viberacing_private.device_keys AS key_record
    ON key_record.device_key_id = pairing_record.pending_device_key_id
  WHERE pairing_record.poll_verifier_digest = p_poll_verifier_digest
    AND pairing_record.state = 'approved'
    AND pairing_record.expires_at >= pg_catalog.statement_timestamp()
    AND key_record.state = 'pending';
END
$function$;

CREATE FUNCTION viberacing_api.activate_pairing(
  p_poll_verifier_digest bytea,
  p_pairing_id uuid,
  p_device_id text,
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
  candidate_device_key_id uuid;
  locked_profile_id uuid;
  locked_device_key_id uuid;
  locked_source_id text;
  now_at timestamptz := pg_catalog.statement_timestamp();
BEGIN
  IF pg_catalog.octet_length(p_poll_verifier_digest) IS DISTINCT FROM 32
    OR p_pairing_id IS NULL
    OR p_device_id IS NULL
    OR p_device_id !~ '^dev_[A-Za-z0-9_-]{22}$'
    OR p_audit_event_id IS NULL
    OR p_request_id IS NULL
    OR p_request_id !~ '^req_[A-Za-z0-9_-]{22}$' THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT approved_profile_id, pending_device_key_id
  INTO candidate_profile_id, candidate_device_key_id
  FROM viberacing_private.pairing_transactions
  WHERE pairing_id = p_pairing_id
    AND poll_verifier_digest = p_poll_verifier_digest
    AND state = 'approved'
    AND expires_at >= now_at;

  IF candidate_profile_id IS NULL OR candidate_device_key_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT profile_id
  INTO locked_profile_id
  FROM viberacing_private.profiles
  WHERE profile_id = candidate_profile_id
    AND state = 'active'
  FOR UPDATE;

  IF locked_profile_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT device_key_id
  INTO locked_device_key_id
  FROM viberacing_private.device_keys
  WHERE device_key_id = candidate_device_key_id
    AND state = 'pending'
  FOR UPDATE;

  IF locked_device_key_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT pairing_record.approved_source_id
  INTO locked_source_id
  FROM viberacing_private.pairing_transactions AS pairing_record
  WHERE pairing_record.pairing_id = p_pairing_id
    AND pairing_record.poll_verifier_digest = p_poll_verifier_digest
    AND pairing_record.approved_profile_id = locked_profile_id
    AND pairing_record.pending_device_key_id = locked_device_key_id
    AND pairing_record.state = 'approved'
    AND pairing_record.expires_at >= now_at
  FOR UPDATE;

  IF locked_source_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.device_keys
  SET
    state = 'active',
    source_id = locked_source_id,
    device_id = p_device_id,
    activated_at = now_at
  WHERE device_key_id = locked_device_key_id;

  UPDATE viberacing_private.pairing_transactions
  SET
    state = 'activated',
    activated_device_id = p_device_id,
    activated_at = now_at
  WHERE pairing_id = p_pairing_id;

  PERFORM viberacing_private.append_audit_event(
    p_audit_event_id,
    'device.activated',
    'profile',
    locked_profile_id,
    p_request_id,
    NULL
  );
EXCEPTION
  WHEN integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
END
$function$;

CREATE FUNCTION viberacing_api.poll_pairing_status(
  p_poll_verifier_digest bytea
)
RETURNS TABLE (
  pairing_state text,
  source_id text,
  device_id text,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF pg_catalog.octet_length(p_poll_verifier_digest) IS DISTINCT FROM 32 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  RETURN QUERY
  SELECT
    CASE
      WHEN pairing_record.state IN ('pending', 'approved')
        AND pairing_record.expires_at < pg_catalog.statement_timestamp()
        THEN 'cancelled'
      ELSE pairing_record.state
    END::text,
    CASE
      WHEN pairing_record.state = 'activated' THEN pairing_record.approved_source_id::text
      ELSE NULL
    END,
    CASE
      WHEN pairing_record.state = 'activated' THEN pairing_record.activated_device_id::text
      ELSE NULL
    END,
    pairing_record.expires_at
  FROM viberacing_private.pairing_transactions AS pairing_record
  WHERE pairing_record.poll_verifier_digest = p_poll_verifier_digest;
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

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (3, 'pairing_capabilities');

COMMIT;
