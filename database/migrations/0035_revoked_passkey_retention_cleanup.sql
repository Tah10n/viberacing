\set ON_ERROR_STOP on

-- Revision 0035: bounded Jobs-only cleanup for aged unreferenced revoked passkeys.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

CREATE INDEX passkeys_revoked_retention_idx
  ON viberacing_private.passkeys (revoked_at, passkey_id)
  WHERE state = 'revoked';

CREATE FUNCTION viberacing_api.cleanup_aged_revoked_passkeys(
  p_batch_size integer
)
RETURNS TABLE (
  deleted_passkeys integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  cutoff_at timestamptz(3);
  locked_mutex_count bigint;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 1000 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  -- Preserve the profile-purge lock order and serialize every class that can remove a restrictive
  -- authentication or pairing reference. Runtime credential operations never use these mutexes,
  -- so the repeated revoked-state and reference predicates remain the authority boundary.
  PERFORM lock_record.capability
  FROM viberacing_private.maintenance_locks AS lock_record
  WHERE lock_record.capability IN (
    'auth_retention_cleanup',
    'pairing_retention_cleanup'
  )
  ORDER BY lock_record.capability
  FOR UPDATE;

  GET DIAGNOSTICS locked_mutex_count = ROW_COUNT;
  IF locked_mutex_count <> 2 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  cutoff_at := pg_catalog.clock_timestamp() - INTERVAL '180 days';

  WITH eligible_passkey AS MATERIALIZED (
    SELECT passkey_record.passkey_id
    FROM viberacing_private.passkeys AS passkey_record
    WHERE passkey_record.state = 'revoked'
      AND passkey_record.revoked_at <= cutoff_at
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.sessions AS session_record
        WHERE session_record.authenticated_by_passkey_id = passkey_record.passkey_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.auth_challenges AS challenge_record
        WHERE challenge_record.verified_by_passkey_id = passkey_record.passkey_id
          OR challenge_record.authorized_passkey_id = passkey_record.passkey_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.pairing_transactions AS pairing_record
        WHERE pairing_record.approved_by_passkey_id = passkey_record.passkey_id
      )
    ORDER BY passkey_record.revoked_at, passkey_record.passkey_id
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  ),
  deleted_passkey AS (
    DELETE FROM viberacing_private.passkeys AS passkey_record
    USING eligible_passkey
    WHERE passkey_record.passkey_id = eligible_passkey.passkey_id
      AND passkey_record.state = 'revoked'
      AND passkey_record.revoked_at <= cutoff_at
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.sessions AS session_record
        WHERE session_record.authenticated_by_passkey_id = passkey_record.passkey_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.auth_challenges AS challenge_record
        WHERE challenge_record.verified_by_passkey_id = passkey_record.passkey_id
          OR challenge_record.authorized_passkey_id = passkey_record.passkey_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.pairing_transactions AS pairing_record
        WHERE pairing_record.approved_by_passkey_id = passkey_record.passkey_id
      )
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer
  INTO deleted_passkeys
  FROM deleted_passkey;

  RETURN NEXT;
EXCEPTION
  WHEN lock_not_available OR integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
    RETURN;
END
$function$;

REVOKE EXECUTE ON FUNCTION viberacing_api.cleanup_aged_revoked_passkeys(integer)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

GRANT EXECUTE ON FUNCTION viberacing_api.cleanup_aged_revoked_passkeys(integer)
  TO viberacing_jobs;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (35, 'revoked_passkey_retention_cleanup');

COMMIT;
