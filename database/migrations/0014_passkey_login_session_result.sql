\set ON_ERROR_STOP on

-- Revision 0014: minimal post-proof profile result for Web/Auth passkey login.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

CREATE FUNCTION viberacing_api.complete_passkey_login_session(
  p_challenge_id uuid,
  p_challenge_digest bytea,
  p_context_digest bytea,
  p_challenge_expires_at timestamptz,
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
RETURNS TABLE (
  profile_id uuid,
  handle text,
  locale text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $function$
DECLARE
  authenticated_profile_id uuid;
BEGIN
  -- The sealed browser continuation proves that Web/Auth issued this profile-free challenge. Store
  -- it only after the application verifies the exact credential proof, then consume it in this same
  -- transaction so anonymous options requests cannot create retained database state.
  PERFORM viberacing_api.create_passkey_login_challenge(
    p_challenge_id,
    p_challenge_digest,
    p_context_digest,
    p_challenge_expires_at
  );

  authenticated_profile_id := viberacing_api.complete_passkey_login(
    p_challenge_id,
    p_challenge_digest,
    p_context_digest,
    p_passkey_id,
    p_credential_id,
    p_observed_sign_count,
    p_backup_state,
    p_session_id,
    p_session_verifier_digest,
    p_session_expires_at,
    p_audit_event_id,
    p_request_id
  );

  IF authenticated_profile_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  RETURN QUERY
  SELECT
    profile_record.profile_id,
    profile_record.handle::text,
    profile_record.locale::text
  FROM viberacing_private.profiles AS profile_record
  WHERE profile_record.profile_id = authenticated_profile_id
    AND profile_record.state IN ('active', 'hidden');

  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
END
$function$;

REVOKE EXECUTE ON FUNCTION viberacing_api.complete_passkey_login_session(
  uuid, bytea, bytea, timestamptz, uuid, bytea, bigint, boolean,
  uuid, bytea, timestamptz, uuid, text
) FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

GRANT EXECUTE ON FUNCTION viberacing_api.complete_passkey_login_session(
  uuid, bytea, bytea, timestamptz, uuid, bytea, bigint, boolean,
  uuid, bytea, timestamptz, uuid, text
) TO viberacing_web;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (14, 'passkey_login_session_result');

COMMIT;
