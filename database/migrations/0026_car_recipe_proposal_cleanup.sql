\set ON_ERROR_STOP on

-- Revision 0026: bounded Jobs-only cleanup for expired CarRecipe proposals.
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
      'car_recipe_proposal_cleanup'
    )
  );

INSERT INTO viberacing_private.maintenance_locks (capability)
VALUES ('car_recipe_proposal_cleanup');

CREATE FUNCTION viberacing_api.cleanup_expired_car_recipe_proposals(
  p_batch_size integer
)
RETURNS TABLE (
  deleted_proposals integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  now_at timestamptz(3);
BEGIN
  IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 1000 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  -- Runtime roles cannot lock this private row directly or select a caller-defined lock key.
  PERFORM lock_record.capability
  FROM viberacing_private.maintenance_locks AS lock_record
  WHERE lock_record.capability = 'car_recipe_proposal_cleanup'
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  -- Capture the cutoff only after the private Jobs mutex. Web proposal decisions already holding
  -- a row settle first or remain skipped for a later run; a proposal live at this point is never
  -- selected.
  now_at := pg_catalog.clock_timestamp();

  WITH expired_proposal AS MATERIALIZED (
    SELECT proposal_record.proposal_id
    FROM viberacing_private.car_recipe_proposals AS proposal_record
    WHERE proposal_record.expires_at <= now_at
    ORDER BY proposal_record.expires_at, proposal_record.proposal_id
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  ),
  deleted_proposal AS (
    DELETE FROM viberacing_private.car_recipe_proposals AS proposal_record
    USING expired_proposal
    WHERE proposal_record.proposal_id = expired_proposal.proposal_id
      AND proposal_record.expires_at <= now_at
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer
  INTO deleted_proposals
  FROM deleted_proposal;

  RETURN NEXT;
EXCEPTION
  WHEN lock_not_available OR integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
    RETURN;
END
$function$;

REVOKE EXECUTE ON FUNCTION viberacing_api.cleanup_expired_car_recipe_proposals(integer)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

GRANT EXECUTE ON FUNCTION viberacing_api.cleanup_expired_car_recipe_proposals(integer)
  TO viberacing_jobs;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (26, 'car_recipe_proposal_cleanup');

COMMIT;
