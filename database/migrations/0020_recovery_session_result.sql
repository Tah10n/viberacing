\set ON_ERROR_STOP on

-- Revision 0020: minimal post-registration profile result for restricted recovery.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

CREATE FUNCTION viberacing_api.complete_recovery_registration_session(
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
  recovered_profile_id uuid;
BEGIN
  recovered_profile_id := viberacing_api.complete_recovery_registration(
    p_recovery_authority_id,
    p_authority_verifier_digest,
    p_challenge_digest,
    p_context_digest,
    p_passkey_id,
    p_credential_id,
    p_cose_public_key,
    p_label,
    p_sign_count,
    p_backup_eligible,
    p_backup_state,
    p_session_id,
    p_session_verifier_digest,
    p_session_expires_at,
    p_audit_event_id,
    p_request_id
  );

  IF recovered_profile_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  RETURN QUERY
  SELECT
    profile_record.profile_id,
    profile_record.handle::text,
    profile_record.locale::text
  FROM viberacing_private.profiles AS profile_record
  WHERE profile_record.profile_id = recovered_profile_id
    AND profile_record.state IN ('active', 'hidden');

  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
END
$function$;

REVOKE EXECUTE ON FUNCTION viberacing_api.complete_recovery_registration_session(
  uuid, bytea, bytea, bytea, uuid, bytea, bytea, text,
  bigint, boolean, boolean, uuid, bytea, timestamptz, uuid, text
) FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

GRANT EXECUTE ON FUNCTION viberacing_api.complete_recovery_registration_session(
  uuid, bytea, bytea, bytea, uuid, bytea, bytea, text,
  bigint, boolean, boolean, uuid, bytea, timestamptz, uuid, text
) TO viberacing_web;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (20, 'recovery_session_result');

COMMIT;
