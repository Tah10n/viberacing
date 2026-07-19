\set ON_ERROR_STOP on

-- Revision 0036: bounded Jobs-only cleanup for aged minimized revoked devices.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

CREATE INDEX device_keys_revoked_retention_idx
  ON viberacing_private.device_keys (revoked_at, device_key_id)
  WHERE state = 'revoked';

CREATE FUNCTION viberacing_api.cleanup_aged_revoked_devices(
  p_batch_size integer
)
RETURNS TABLE (
  deleted_pairings integer,
  deleted_device_keys integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  candidate record;
  changed_rows bigint;
  cutoff_at timestamptz(3);
  locked_mutex_count bigint;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 1000 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  -- Preserve the profile-purge order for the two capabilities whose rows must already be absent
  -- or minimized. Runtime device operations use neither mutex, so repeated state/reference checks
  -- and row locks remain the authority boundary.
  PERFORM lock_record.capability
  FROM viberacing_private.maintenance_locks AS lock_record
  WHERE lock_record.capability IN (
    'ingest_retention_cleanup',
    'pairing_retention_cleanup'
  )
  ORDER BY lock_record.capability
  FOR UPDATE;

  GET DIAGNOSTICS locked_mutex_count = ROW_COUNT;
  IF locked_mutex_count <> 2 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  cutoff_at := pg_catalog.clock_timestamp() - INTERVAL '180 days';
  deleted_pairings := 0;
  deleted_device_keys := 0;

  FOR candidate IN
    SELECT
      device_record.device_key_id,
      pairing_record.pairing_id
    FROM viberacing_private.device_keys AS device_record
    JOIN viberacing_private.pairing_transactions AS pairing_record
      ON pairing_record.pending_device_key_id = device_record.device_key_id
    WHERE device_record.state = 'revoked'
      AND device_record.revoked_at <= cutoff_at
      AND pairing_record.state = 'activated'
      AND pairing_record.activated_at <= cutoff_at
      AND pairing_record.approved_by_session_id IS NULL
      AND pairing_record.approved_by_passkey_id IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.auth_challenges AS challenge_record
        WHERE challenge_record.authorized_pairing_id = pairing_record.pairing_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.device_nonces AS nonce_record
        WHERE nonce_record.device_key_id = device_record.device_key_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.usage_snapshots AS snapshot_record
        WHERE snapshot_record.device_key_id = device_record.device_key_id
      )
    ORDER BY device_record.revoked_at, device_record.device_key_id
    LIMIT p_batch_size
    FOR UPDATE OF device_record, pairing_record SKIP LOCKED
  LOOP
    DELETE FROM viberacing_private.pairing_transactions AS pairing_record
    WHERE pairing_record.pairing_id = candidate.pairing_id
      AND pairing_record.pending_device_key_id = candidate.device_key_id
      AND pairing_record.state = 'activated'
      AND pairing_record.activated_at <= cutoff_at
      AND pairing_record.approved_by_session_id IS NULL
      AND pairing_record.approved_by_passkey_id IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.auth_challenges AS challenge_record
        WHERE challenge_record.authorized_pairing_id = pairing_record.pairing_id
      )
      AND EXISTS (
        SELECT 1
        FROM viberacing_private.device_keys AS device_record
        WHERE device_record.device_key_id = candidate.device_key_id
          AND device_record.state = 'revoked'
          AND device_record.revoked_at <= cutoff_at
          AND NOT EXISTS (
            SELECT 1
            FROM viberacing_private.device_nonces AS nonce_record
            WHERE nonce_record.device_key_id = device_record.device_key_id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM viberacing_private.usage_snapshots AS snapshot_record
            WHERE snapshot_record.device_key_id = device_record.device_key_id
          )
      );

    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    IF changed_rows <> 1 THEN
      PERFORM viberacing_private.operation_failed();
    END IF;
    deleted_pairings := deleted_pairings + 1;

    DELETE FROM viberacing_private.device_keys AS device_record
    WHERE device_record.device_key_id = candidate.device_key_id
      AND device_record.state = 'revoked'
      AND device_record.revoked_at <= cutoff_at
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.pairing_transactions AS remaining_pairing
        WHERE remaining_pairing.pending_device_key_id = device_record.device_key_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.device_nonces AS nonce_record
        WHERE nonce_record.device_key_id = device_record.device_key_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.usage_snapshots AS snapshot_record
        WHERE snapshot_record.device_key_id = device_record.device_key_id
      );

    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    IF changed_rows <> 1 THEN
      PERFORM viberacing_private.operation_failed();
    END IF;
    deleted_device_keys := deleted_device_keys + 1;
  END LOOP;

  RETURN NEXT;
EXCEPTION
  WHEN lock_not_available OR integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
    RETURN;
END
$function$;

REVOKE EXECUTE ON FUNCTION viberacing_api.cleanup_aged_revoked_devices(integer)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

GRANT EXECUTE ON FUNCTION viberacing_api.cleanup_aged_revoked_devices(integer)
  TO viberacing_jobs;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (36, 'revoked_device_retention_cleanup');

COMMIT;
