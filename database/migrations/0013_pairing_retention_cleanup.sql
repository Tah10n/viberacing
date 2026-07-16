\set ON_ERROR_STOP on

-- Revision 0013: bounded Jobs-only cleanup for expired pairing state and pending keys.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

ALTER TABLE viberacing_private.maintenance_locks
  DROP CONSTRAINT maintenance_locks_capability,
  ADD CONSTRAINT maintenance_locks_capability CHECK (
    capability IN (
      'ingest_retention_cleanup',
      'community_scoring_refresh',
      'pairing_retention_cleanup'
    )
  );

INSERT INTO viberacing_private.maintenance_locks (capability)
VALUES ('pairing_retention_cleanup');

DROP INDEX viberacing_private.pairing_transactions_expiry_idx;
CREATE INDEX pairing_transactions_expiry_idx
  ON viberacing_private.pairing_transactions (expires_at, pairing_id)
  WHERE state IN ('pending', 'approved', 'cancelled');

CREATE FUNCTION viberacing_api.cleanup_expired_pairing_state(
  p_batch_size integer
)
RETURNS TABLE (
  deleted_pairings integer,
  deleted_pending_keys integer
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
  now_at timestamptz(3);
BEGIN
  IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 1000 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  -- Serialize Jobs callers with a private row that no runtime role can lock directly.
  PERFORM lock_record.capability
  FROM viberacing_private.maintenance_locks AS lock_record
  WHERE lock_record.capability = 'pairing_retention_cleanup'
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  -- Capture the cutoff only after waiting for the Jobs mutex. Pairing expiry is terminal, but a
  -- live approval or activation can hold either row; SKIP LOCKED lets that operation finish and
  -- leaves the still-referenced pair for a later cleanup invocation.
  now_at := pg_catalog.clock_timestamp();
  deleted_pairings := 0;
  deleted_pending_keys := 0;

  FOR candidate IN
    SELECT pairing_record.pairing_id, pairing_record.pending_device_key_id
    FROM viberacing_private.pairing_transactions AS pairing_record
    JOIN viberacing_private.device_keys AS key_record
      ON key_record.device_key_id = pairing_record.pending_device_key_id
    WHERE pairing_record.expires_at <= now_at
      AND pairing_record.state IN ('pending', 'approved', 'cancelled')
      AND key_record.state = 'pending'
      AND key_record.source_id IS NULL
      AND key_record.device_id IS NULL
    ORDER BY pairing_record.expires_at, pairing_record.pairing_id
    LIMIT p_batch_size
    FOR UPDATE OF key_record, pairing_record SKIP LOCKED
  LOOP
    DELETE FROM viberacing_private.pairing_transactions AS pairing_record
    WHERE pairing_record.pairing_id = candidate.pairing_id
      AND pairing_record.pending_device_key_id = candidate.pending_device_key_id
      AND pairing_record.expires_at <= now_at
      AND pairing_record.state IN ('pending', 'approved', 'cancelled');

    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    IF changed_rows <> 1 THEN
      PERFORM viberacing_private.operation_failed();
    END IF;
    deleted_pairings := deleted_pairings + 1;

    DELETE FROM viberacing_private.device_keys AS key_record
    WHERE key_record.device_key_id = candidate.pending_device_key_id
      AND key_record.state = 'pending'
      AND key_record.source_id IS NULL
      AND key_record.device_id IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.pairing_transactions AS remaining_pairing
        WHERE remaining_pairing.pending_device_key_id = key_record.device_key_id
      );

    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    IF changed_rows <> 1 THEN
      PERFORM viberacing_private.operation_failed();
    END IF;
    deleted_pending_keys := deleted_pending_keys + 1;
  END LOOP;

  RETURN NEXT;
EXCEPTION
  WHEN lock_not_available OR integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
    RETURN;
END
$function$;

REVOKE EXECUTE ON FUNCTION viberacing_api.cleanup_expired_pairing_state(integer)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

GRANT EXECUTE ON FUNCTION viberacing_api.cleanup_expired_pairing_state(integer)
  TO viberacing_jobs;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (13, 'pairing_retention_cleanup');

COMMIT;
