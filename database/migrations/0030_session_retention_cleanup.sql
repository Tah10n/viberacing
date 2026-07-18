\set ON_ERROR_STOP on

-- Revision 0030: bounded Jobs-only cleanup for expired unreferenced browser sessions.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

-- The former partial index bounded live authorization reads but could not serve physical cleanup
-- for revoked or rotated sessions. Primary-key and profile/state indexes remain unchanged.
DROP INDEX viberacing_private.sessions_expiry_idx;
CREATE INDEX sessions_expiry_idx
  ON viberacing_private.sessions (expires_at, session_id);

-- Pairing approval provenance deliberately retains an exact approving session. Keep that
-- retention check and the corresponding foreign-key delete probe bounded without changing the
-- immutable pairing contract.
CREATE INDEX pairing_transactions_approval_session_idx
  ON viberacing_private.pairing_transactions (approved_by_session_id)
  WHERE approved_by_session_id IS NOT NULL;

CREATE FUNCTION viberacing_api.cleanup_expired_sessions(
  p_batch_size integer
)
RETURNS TABLE (
  deleted_sessions integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  candidate_session_id uuid;
  changed_rows bigint;
  now_at timestamptz(3);
BEGIN
  IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 1000 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  -- Session deletion cascades session-bound challenges, so it shares the existing private auth
  -- mutex. Authentication cleanup and profile purge already lock this exact row.
  PERFORM lock_record.capability
  FROM viberacing_private.maintenance_locks AS lock_record
  WHERE lock_record.capability = 'auth_retention_cleanup'
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  -- Capture server time only after the auth mutex. A live authorization transition already owns
  -- its session row and is skipped. Rotation predecessors are deleted before their replacement,
  -- while immutable pairing provenance remains retained until a separate reviewed history policy.
  now_at := pg_catalog.clock_timestamp();
  deleted_sessions := 0;

  LOOP
    EXIT WHEN deleted_sessions >= p_batch_size;
    candidate_session_id := NULL;

    SELECT session_record.session_id
    INTO candidate_session_id
    FROM viberacing_private.sessions AS session_record
    WHERE session_record.expires_at <= now_at
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.sessions AS predecessor_record
        WHERE predecessor_record.replaced_by_session_id = session_record.session_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.pairing_transactions AS pairing_record
        WHERE pairing_record.approved_by_session_id = session_record.session_id
      )
    ORDER BY session_record.expires_at, session_record.session_id
    LIMIT 1
    FOR UPDATE OF session_record SKIP LOCKED;

    EXIT WHEN candidate_session_id IS NULL;

    DELETE FROM viberacing_private.sessions AS session_record
    WHERE session_record.session_id = candidate_session_id
      AND session_record.expires_at <= now_at
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.sessions AS predecessor_record
        WHERE predecessor_record.replaced_by_session_id = session_record.session_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.pairing_transactions AS pairing_record
        WHERE pairing_record.approved_by_session_id = session_record.session_id
      );

    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    IF changed_rows <> 1 THEN
      PERFORM viberacing_private.operation_failed();
    END IF;
    deleted_sessions := deleted_sessions + 1;
  END LOOP;

  RETURN NEXT;
EXCEPTION
  WHEN lock_not_available OR integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
    RETURN;
END
$function$;

REVOKE EXECUTE ON FUNCTION viberacing_api.cleanup_expired_sessions(integer)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

GRANT EXECUTE ON FUNCTION viberacing_api.cleanup_expired_sessions(integer)
  TO viberacing_jobs;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (30, 'session_retention_cleanup');

COMMIT;
