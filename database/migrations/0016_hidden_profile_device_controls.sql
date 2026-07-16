\set ON_ERROR_STOP on

-- Revision 0016: preserve private device inventory and revoke while a profile is hidden.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

CREATE OR REPLACE FUNCTION viberacing_api.read_source_inventory(
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
SET lock_timeout = '5s'
SET statement_timeout = '10s'
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
    ARRAY['active', 'hidden']
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

CREATE OR REPLACE FUNCTION viberacing_api.revoke_device(
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
SET lock_timeout = '5s'
SET statement_timeout = '10s'
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
    ARRAY['active', 'hidden']
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

REVOKE EXECUTE ON FUNCTION viberacing_api.read_source_inventory(uuid, bytea)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
GRANT EXECUTE ON FUNCTION viberacing_api.read_source_inventory(uuid, bytea)
  TO viberacing_web;

REVOKE EXECUTE ON FUNCTION viberacing_api.revoke_device(uuid, bytea, text, uuid, text)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
GRANT EXECUTE ON FUNCTION viberacing_api.revoke_device(uuid, bytea, text, uuid, text)
  TO viberacing_web;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (16, 'hidden_profile_device_controls');

COMMIT;
