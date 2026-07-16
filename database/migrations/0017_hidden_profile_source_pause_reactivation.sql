\set ON_ERROR_STOP on

-- Revision 0017: keep source pause and reactivation independent from public visibility.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

CREATE OR REPLACE FUNCTION viberacing_api.pause_source(
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
SET lock_timeout = '5s'
SET statement_timeout = '10s'
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
    ARRAY['active', 'hidden']
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

CREATE OR REPLACE FUNCTION viberacing_api.create_source_action_challenge(
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
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $function$
DECLARE
  authenticated_profile_id uuid;
  allowed_profile_states text[];
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
    allowed_profile_states := ARRAY['active', 'hidden'];
    required_source_states := ARRAY['paused'];
  ELSIF p_purpose = 'source_unlink' THEN
    allowed_profile_states := ARRAY['active'];
    required_source_states := ARRAY['active', 'paused', 'quarantined'];
  ELSE
    PERFORM viberacing_private.operation_failed();
  END IF;

  authenticated_profile_id := viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest,
    allowed_profile_states
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
SET lock_timeout = '5s'
SET statement_timeout = '10s'
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

  IF p_purpose IN (
    'passkey_change',
    'recovery_change',
    'profile_deletion',
    'source_reactivation'
  ) THEN
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

CREATE OR REPLACE FUNCTION viberacing_api.reactivate_source(
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
SET lock_timeout = '5s'
SET statement_timeout = '10s'
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
    ARRAY['active', 'hidden']
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

REVOKE EXECUTE ON FUNCTION viberacing_api.pause_source(uuid, bytea, text, uuid, text)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
GRANT EXECUTE ON FUNCTION viberacing_api.pause_source(uuid, bytea, text, uuid, text)
  TO viberacing_web;

REVOKE EXECUTE ON FUNCTION viberacing_api.create_source_action_challenge(
  uuid, bytea, text, text, uuid, bytea, bytea, timestamptz
) FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
GRANT EXECUTE ON FUNCTION viberacing_api.create_source_action_challenge(
  uuid, bytea, text, text, uuid, bytea, bytea, timestamptz
) TO viberacing_web;

REVOKE EXECUTE ON FUNCTION viberacing_api.consume_passkey_challenge(
  uuid, bytea, uuid, text, bytea, bytea, uuid, bigint, boolean
) FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
GRANT EXECUTE ON FUNCTION viberacing_api.consume_passkey_challenge(
  uuid, bytea, uuid, text, bytea, bytea, uuid, bigint, boolean
) TO viberacing_web;

REVOKE EXECUTE ON FUNCTION viberacing_api.reactivate_source(
  uuid, bytea, text, uuid, bytea, uuid, text
) FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
GRANT EXECUTE ON FUNCTION viberacing_api.reactivate_source(
  uuid, bytea, text, uuid, bytea, uuid, text
) TO viberacing_web;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (17, 'hidden_profile_source_pause_reactivation');

COMMIT;
