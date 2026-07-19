\set ON_ERROR_STOP on

-- Revision 0033: bounded Jobs-only cleanup for aged database audit references.
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
      'pairing_retention_cleanup',
      'auth_retention_cleanup',
      'profile_deletion_purge',
      'car_recipe_proposal_cleanup',
      'audit_retention_cleanup'
    )
  );

INSERT INTO viberacing_private.maintenance_locks (capability)
VALUES ('audit_retention_cleanup');

-- Preserve the existing time lookup while making equal-timestamp batch order index-backed.
DROP INDEX viberacing_private.audit_events_time_idx;
CREATE INDEX audit_events_time_idx
  ON viberacing_private.audit_events (occurred_at, audit_event_id);

CREATE FUNCTION viberacing_api.cleanup_expired_audit_events(
  p_batch_size integer
)
RETURNS TABLE (
  deleted_audit_events integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  cutoff_at timestamptz(3);
BEGIN
  IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 1000 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  -- Runtime roles cannot lock this private row directly or select a caller-defined lock key.
  PERFORM lock_record.capability
  FROM viberacing_private.maintenance_locks AS lock_record
  WHERE lock_record.capability = 'audit_retention_cleanup'
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  -- PostgreSQL alone derives the public maximum-retention boundary. New security actions cannot
  -- become eligible while waiting because append_audit_event always records server time.
  cutoff_at := pg_catalog.clock_timestamp() - INTERVAL '180 days';

  WITH expired_audit_event AS MATERIALIZED (
    SELECT audit_record.audit_event_id
    FROM viberacing_private.audit_events AS audit_record
    WHERE audit_record.occurred_at <= cutoff_at
    ORDER BY audit_record.occurred_at, audit_record.audit_event_id
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  ),
  deleted_audit_event AS (
    DELETE FROM viberacing_private.audit_events AS audit_record
    USING expired_audit_event
    WHERE audit_record.audit_event_id = expired_audit_event.audit_event_id
      AND audit_record.occurred_at <= cutoff_at
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer
  INTO deleted_audit_events
  FROM deleted_audit_event;

  RETURN NEXT;
EXCEPTION
  WHEN lock_not_available OR integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
    RETURN;
END
$function$;

REVOKE EXECUTE ON FUNCTION viberacing_api.cleanup_expired_audit_events(integer)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

GRANT EXECUTE ON FUNCTION viberacing_api.cleanup_expired_audit_events(integer)
  TO viberacing_jobs;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (33, 'audit_event_retention_cleanup');

COMMIT;
