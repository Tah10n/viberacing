\set ON_ERROR_STOP on

-- Revision 0037: bounded Jobs-only reset for expired fixed pairing request windows.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

ALTER TABLE viberacing_private.pairing_request_windows
  DROP CONSTRAINT pairing_request_windows_attempt_count,
  ADD CONSTRAINT pairing_request_windows_state_shape CHECK (
    (
      attempt_count = 0
      AND window_started_at = TIMESTAMPTZ '1970-01-01 00:00:00+00'
    )
    OR (
      attempt_count BETWEEN 1 AND 1000001
      AND window_started_at > TIMESTAMPTZ '1970-01-01 00:00:00+00'
    )
  );

CREATE FUNCTION viberacing_api.reset_expired_pairing_request_windows()
RETURNS TABLE (
  reset_windows integer
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
  inventory_count bigint;
BEGIN
  -- Constraints plus the primary key make 130 rows the complete two-operation by 65-bucket
  -- matrix. Missing fixed rows are availability/security drift and must fail before mutation.
  SELECT pg_catalog.count(*)
  INTO inventory_count
  FROM viberacing_private.pairing_request_windows;

  IF inventory_count <> 130 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  -- Admission accepts a maximum one-hour window. Waiting for that complete maximum preserves every
  -- configured shorter window while bounding the last aggregate timestamp/count after traffic stops.
  cutoff_at := pg_catalog.clock_timestamp() - INTERVAL '1 hour';
  reset_windows := 0;

  -- The fixed primary-key order matches admission's operation-local global-then-bucket order.
  -- Row locks therefore serialize overlapping workers and live admission without a public or
  -- caller-selected mutex. At most the complete 130-row fixed matrix can be visited.
  FOR candidate IN
    SELECT
      window_record.operation,
      window_record.bucket
    FROM viberacing_private.pairing_request_windows AS window_record
    WHERE window_record.attempt_count > 0
      AND window_record.window_started_at <= cutoff_at
    ORDER BY window_record.operation, window_record.bucket
    LIMIT 130
    FOR UPDATE OF window_record
  LOOP
    UPDATE viberacing_private.pairing_request_windows AS window_record
    SET
      window_started_at = TIMESTAMPTZ '1970-01-01 00:00:00+00',
      attempt_count = 0
    WHERE window_record.operation = candidate.operation
      AND window_record.bucket = candidate.bucket
      AND window_record.attempt_count > 0
      AND window_record.window_started_at <= cutoff_at;

    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    IF changed_rows <> 1 THEN
      PERFORM viberacing_private.operation_failed();
    END IF;
    reset_windows := reset_windows + 1;
  END LOOP;

  RETURN NEXT;
EXCEPTION
  WHEN lock_not_available OR integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
    RETURN;
END
$function$;

REVOKE EXECUTE ON FUNCTION viberacing_api.reset_expired_pairing_request_windows()
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

GRANT EXECUTE ON FUNCTION viberacing_api.reset_expired_pairing_request_windows()
  TO viberacing_jobs;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (37, 'pairing_rate_window_retention_reset');

COMMIT;
