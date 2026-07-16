\set ON_ERROR_STOP on

-- Revision 0015: session-owned public profile visibility control.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

CREATE FUNCTION viberacing_api.read_profile_visibility(
  p_session_id uuid,
  p_session_verifier_digest bytea
)
RETURNS TABLE (visibility text)
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
  SELECT CASE profile_record.state
    WHEN 'active' THEN 'public'::text
    WHEN 'hidden' THEN 'hidden'::text
  END
  FROM viberacing_private.profiles AS profile_record
  WHERE profile_record.profile_id = authenticated_profile_id
    AND profile_record.state IN ('active', 'hidden');

  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
END
$function$;

CREATE FUNCTION viberacing_api.set_profile_visibility(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_publicly_visible boolean
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $function$
DECLARE
  authenticated_profile_id uuid;
  changed_rows bigint;
  current_state text;
  target_state text;
  now_at timestamptz(3);
BEGIN
  IF p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32
    OR p_publicly_visible IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  authenticated_profile_id := viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest,
    ARRAY['active', 'hidden']
  );

  SELECT profile_record.state
  INTO current_state
  FROM viberacing_private.profiles AS profile_record
  WHERE profile_record.profile_id = authenticated_profile_id
    AND profile_record.state IN ('active', 'hidden')
  FOR UPDATE;

  IF current_state IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  target_state := CASE WHEN p_publicly_visible THEN 'active' ELSE 'hidden' END;
  IF current_state IS DISTINCT FROM target_state THEN
    now_at := pg_catalog.clock_timestamp();
    UPDATE viberacing_private.profiles
    SET
      state = target_state,
      updated_at = now_at,
      hidden_at = CASE WHEN target_state = 'hidden' THEN now_at ELSE NULL END
    WHERE profile_id = authenticated_profile_id;

    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    IF changed_rows <> 1 THEN
      PERFORM viberacing_private.operation_failed();
    END IF;
  END IF;

  RETURN CASE WHEN target_state = 'active' THEN 'public' ELSE 'hidden' END;
EXCEPTION
  WHEN integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
    RETURN NULL;
END
$function$;

REVOKE EXECUTE ON FUNCTION viberacing_api.read_profile_visibility(uuid, bytea)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
GRANT EXECUTE ON FUNCTION viberacing_api.read_profile_visibility(uuid, bytea)
  TO viberacing_web;

REVOKE EXECUTE ON FUNCTION viberacing_api.set_profile_visibility(uuid, bytea, boolean)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
GRANT EXECUTE ON FUNCTION viberacing_api.set_profile_visibility(uuid, bytea, boolean)
  TO viberacing_web;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (15, 'profile_visibility');

COMMIT;
