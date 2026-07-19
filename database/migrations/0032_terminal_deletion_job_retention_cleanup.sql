\set ON_ERROR_STOP on

-- Revision 0032: bounded Jobs-only cleanup for terminal profile-deletion jobs.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

CREATE INDEX deletion_jobs_terminal_retention_idx
  ON viberacing_private.deletion_jobs (completed_at, deletion_job_id)
  WHERE state = 'purged' AND profile_id IS NULL;

CREATE FUNCTION viberacing_api.cleanup_terminal_deletion_jobs(
  p_batch_size integer
)
RETURNS TABLE (
  deleted_deletion_jobs integer
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

  -- Terminal-job retention shares the profile-deletion mutex. A purge that is about to make a job
  -- terminal therefore settles before the cutoff is captured, and cleanup workers serialize
  -- without introducing a caller-selected lock key.
  PERFORM lock_record.capability
  FROM viberacing_private.maintenance_locks AS lock_record
  WHERE lock_record.capability = 'profile_deletion_purge'
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  cutoff_at := pg_catalog.clock_timestamp() - INTERVAL '30 days';

  WITH terminal_job AS MATERIALIZED (
    SELECT job_record.deletion_job_id
    FROM viberacing_private.deletion_jobs AS job_record
    WHERE job_record.state = 'purged'
      AND job_record.profile_id IS NULL
      AND job_record.completed_at IS NOT NULL
      AND job_record.completed_at <= cutoff_at
    ORDER BY job_record.completed_at, job_record.deletion_job_id
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  ),
  deleted_job AS (
    DELETE FROM viberacing_private.deletion_jobs AS job_record
    USING terminal_job
    WHERE job_record.deletion_job_id = terminal_job.deletion_job_id
      AND job_record.state = 'purged'
      AND job_record.profile_id IS NULL
      AND job_record.completed_at IS NOT NULL
      AND job_record.completed_at <= cutoff_at
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer
  INTO deleted_deletion_jobs
  FROM deleted_job;

  RETURN NEXT;
EXCEPTION
  WHEN lock_not_available OR integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
    RETURN;
END
$function$;

REVOKE EXECUTE ON FUNCTION viberacing_api.cleanup_terminal_deletion_jobs(integer)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

GRANT EXECUTE ON FUNCTION viberacing_api.cleanup_terminal_deletion_jobs(integer)
  TO viberacing_jobs;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (32, 'terminal_deletion_job_retention_cleanup');

COMMIT;
