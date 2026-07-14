\set ON_ERROR_STOP on

-- Revision 0004: session-owned source inventory and fail-closed source/device lifecycle actions.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

ALTER TABLE viberacing_private.auth_challenges
  DROP CONSTRAINT auth_challenges_pairing_binding_shape;
ALTER TABLE viberacing_private.auth_challenges
  ADD CONSTRAINT auth_challenges_authorization_binding_shape CHECK (
    (
      purpose = 'pairing_approval'
      AND authorized_pairing_id IS NOT NULL
      AND authorized_source_choice IS NOT NULL
      AND authorized_source_id IS NOT NULL
    )
    OR (
      purpose IN ('source_reactivation', 'source_unlink')
      AND authorized_pairing_id IS NULL
      AND authorized_source_choice IS NULL
      AND authorized_source_id IS NOT NULL
    )
    OR (
      purpose NOT IN ('pairing_approval', 'source_reactivation', 'source_unlink')
      AND authorized_pairing_id IS NULL
      AND authorized_source_choice IS NULL
      AND authorized_source_id IS NULL
    )
  );

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
  ELSIF p_purpose IN ('pairing_approval', 'source_reactivation', 'source_unlink') THEN
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

CREATE FUNCTION viberacing_private.claim_source_authorized_action(
  p_challenge_id uuid,
  p_profile_id uuid,
  p_session_id uuid,
  p_purpose text,
  p_source_id text,
  p_context_digest bytea
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  changed_rows bigint;
BEGIN
  IF p_purpose NOT IN ('source_reactivation', 'source_unlink') THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.auth_challenges
  SET authorized_action_used_at = pg_catalog.statement_timestamp()
  WHERE challenge_id = p_challenge_id
    AND profile_id = p_profile_id
    AND session_id = p_session_id
    AND purpose = p_purpose
    AND authorized_source_id = p_source_id
    AND context_digest = p_context_digest
    AND consumed_at IS NOT NULL
    AND authorized_action_used_at IS NULL
    AND expires_at >= pg_catalog.statement_timestamp();

  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
END
$function$;

CREATE FUNCTION viberacing_api.read_source_inventory(
  p_session_id uuid,
  p_session_verifier_digest bytea
)
RETURNS TABLE (
  source_id text,
  source_state text,
  source_state_changed_at timestamptz,
  device_id text,
  device_label text,
  connector_version text,
  os_family text,
  architecture text,
  device_state text,
  activated_at timestamptz,
  revoked_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  authenticated_profile_id uuid;
BEGIN
  IF p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  authenticated_profile_id := viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest,
    ARRAY['active']
  );

  RETURN QUERY
  SELECT
    source_record.source_id::text,
    source_record.state::text,
    source_record.state_changed_at,
    device_record.device_id::text,
    device_record.label::text,
    device_record.connector_version::text,
    device_record.os_family::text,
    device_record.architecture::text,
    device_record.state::text,
    device_record.activated_at,
    device_record.revoked_at
  FROM viberacing_private.codex_sources AS source_record
  LEFT JOIN viberacing_private.device_keys AS device_record
    ON device_record.source_id = source_record.source_id
  WHERE source_record.profile_id = authenticated_profile_id
  ORDER BY
    source_record.source_id,
    device_record.activated_at NULLS LAST,
    device_record.device_id;
END
$function$;

CREATE FUNCTION viberacing_api.pause_source(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_source_id text,
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
  locked_source_id text;
BEGIN
  IF p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32
    OR p_source_id IS NULL
    OR p_source_id !~ '^src_[A-Za-z0-9_-]{22}$'
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

  SELECT source_id
  INTO locked_source_id
  FROM viberacing_private.codex_sources
  WHERE source_id = p_source_id
    AND profile_id = authenticated_profile_id
    AND state = 'active'
  FOR UPDATE;

  IF locked_source_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.codex_sources
  SET state = 'paused'
  WHERE source_id = locked_source_id;

  DELETE FROM viberacing_private.auth_challenges
  WHERE profile_id = authenticated_profile_id
    AND authorized_source_id = locked_source_id
    AND authorized_action_used_at IS NULL;

  UPDATE viberacing_private.pairing_transactions
  SET state = 'cancelled'
  WHERE approved_profile_id = authenticated_profile_id
    AND approved_source_id = locked_source_id
    AND state = 'approved';

  PERFORM viberacing_private.append_audit_event(
    p_audit_event_id,
    'source.paused',
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

CREATE FUNCTION viberacing_api.create_source_action_challenge(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_source_id text,
  p_purpose text,
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
  required_source_states text[];
  now_at timestamptz := pg_catalog.statement_timestamp();
BEGIN
  IF p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32
    OR p_source_id IS NULL
    OR p_source_id !~ '^src_[A-Za-z0-9_-]{22}$'
    OR p_purpose IS NULL
    OR p_challenge_id IS NULL
    OR pg_catalog.octet_length(p_challenge_digest) IS DISTINCT FROM 32
    OR pg_catalog.octet_length(p_context_digest) IS DISTINCT FROM 32
    OR p_expires_at IS NULL
    OR p_expires_at <= now_at
    OR p_expires_at > now_at + INTERVAL '5 minutes' THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  IF p_purpose = 'source_reactivation' THEN
    required_source_states := ARRAY['paused'];
  ELSIF p_purpose = 'source_unlink' THEN
    required_source_states := ARRAY['active', 'paused', 'quarantined'];
  ELSE
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
  ) OR NOT EXISTS (
    SELECT 1
    FROM viberacing_private.codex_sources
    WHERE source_id = p_source_id
      AND profile_id = authenticated_profile_id
      AND state = ANY (required_source_states)
  ) THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  DELETE FROM viberacing_private.auth_challenges
  WHERE profile_id = authenticated_profile_id
    AND session_id = p_session_id
    AND purpose = p_purpose
    AND authorized_source_id = p_source_id
    AND authorized_action_used_at IS NULL;

  INSERT INTO viberacing_private.auth_challenges (
    challenge_id,
    profile_id,
    session_id,
    purpose,
    challenge_digest,
    context_digest,
    user_verification_required,
    authorized_source_id,
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
    p_source_id,
    now_at,
    p_expires_at
  );
EXCEPTION
  WHEN integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
END
$function$;

CREATE FUNCTION viberacing_api.reactivate_source(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_source_id text,
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
  locked_source_id text;
BEGIN
  IF p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32
    OR p_source_id IS NULL
    OR p_source_id !~ '^src_[A-Za-z0-9_-]{22}$'
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

  PERFORM viberacing_private.claim_source_authorized_action(
    p_challenge_id,
    authenticated_profile_id,
    p_session_id,
    'source_reactivation',
    p_source_id,
    p_context_digest
  );

  SELECT source_id
  INTO locked_source_id
  FROM viberacing_private.codex_sources
  WHERE source_id = p_source_id
    AND profile_id = authenticated_profile_id
    AND state = 'paused'
  FOR UPDATE;

  IF locked_source_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.codex_sources
  SET state = 'active'
  WHERE source_id = locked_source_id;

  DELETE FROM viberacing_private.auth_challenges
  WHERE profile_id = authenticated_profile_id
    AND authorized_source_id = locked_source_id
    AND authorized_action_used_at IS NULL;

  PERFORM viberacing_private.append_audit_event(
    p_audit_event_id,
    'source.reactivated',
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

CREATE FUNCTION viberacing_api.unlink_source(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_source_id text,
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
  locked_source_id text;
  now_at timestamptz := pg_catalog.statement_timestamp();
BEGIN
  IF p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32
    OR p_source_id IS NULL
    OR p_source_id !~ '^src_[A-Za-z0-9_-]{22}$'
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

  PERFORM viberacing_private.claim_source_authorized_action(
    p_challenge_id,
    authenticated_profile_id,
    p_session_id,
    'source_unlink',
    p_source_id,
    p_context_digest
  );

  SELECT source_id
  INTO locked_source_id
  FROM viberacing_private.codex_sources
  WHERE source_id = p_source_id
    AND profile_id = authenticated_profile_id
    AND state IN ('active', 'paused', 'quarantined')
  FOR UPDATE;

  IF locked_source_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.codex_sources
  SET state = 'unlinked'
  WHERE source_id = locked_source_id;

  UPDATE viberacing_private.device_keys
  SET
    state = 'revoked',
    revoked_at = now_at
  WHERE source_id = locked_source_id
    AND state = 'active';

  UPDATE viberacing_private.pairing_transactions
  SET state = 'cancelled'
  WHERE approved_profile_id = authenticated_profile_id
    AND approved_source_id = locked_source_id
    AND state = 'approved';

  DELETE FROM viberacing_private.auth_challenges
  WHERE profile_id = authenticated_profile_id
    AND authorized_source_id = locked_source_id
    AND authorized_action_used_at IS NULL;

  PERFORM viberacing_private.append_audit_event(
    p_audit_event_id,
    'source.unlinked',
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

CREATE FUNCTION viberacing_api.revoke_device(
  p_session_id uuid,
  p_session_verifier_digest bytea,
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
  authenticated_profile_id uuid;
  locked_device_key_id uuid;
  now_at timestamptz := pg_catalog.statement_timestamp();
BEGIN
  IF p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32
    OR p_device_id IS NULL
    OR p_device_id !~ '^dev_[A-Za-z0-9_-]{22}$'
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

  SELECT device_record.device_key_id
  INTO locked_device_key_id
  FROM viberacing_private.device_keys AS device_record
  JOIN viberacing_private.codex_sources AS source_record
    ON source_record.source_id = device_record.source_id
  WHERE device_record.device_id = p_device_id
    AND device_record.state = 'active'
    AND source_record.profile_id = authenticated_profile_id
  FOR UPDATE OF device_record, source_record;

  IF locked_device_key_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  UPDATE viberacing_private.device_keys
  SET
    state = 'revoked',
    revoked_at = now_at
  WHERE device_key_id = locked_device_key_id;

  PERFORM viberacing_private.append_audit_event(
    p_audit_event_id,
    'device.revoked',
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

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (4, 'source_device_lifecycle');

COMMIT;
