\set ON_ERROR_STOP on

-- cspell:ignore indexrelid relname indpred indnkeyatts

-- Deterministic synthetic evidence for bounded terminal deletion-job cleanup. The transaction is
-- rolled back and does not imply a scheduler, tombstone policy, backup purge, or deployment.

BEGIN;

CREATE FUNCTION pg_temp.assert_true(condition boolean, label text)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  IF condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'assertion failed: %', label;
  END IF;
END
$function$;

CREATE FUNCTION pg_temp.expect_operation_failure(statement text, label text)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected closed operation failure: %', label;
END
$function$;

CREATE FUNCTION pg_temp.expect_permission_failure(statement text, label text)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected permission failure: %', label;
END
$function$;

SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (
  profile_id,
  github_user_id,
  handle,
  state,
  created_at,
  updated_at,
  hidden_at,
  deletion_requested_at
)
VALUES (
  '00000000-0000-4000-8000-000000034101',
  900000000000034101,
  'deletion-job-live',
  'deletion_pending',
  pg_catalog.statement_timestamp() - INTERVAL '50 days',
  pg_catalog.statement_timestamp() - INTERVAL '45 days',
  pg_catalog.statement_timestamp() - INTERVAL '45 days',
  pg_catalog.statement_timestamp() - INTERVAL '45 days'
);

INSERT INTO viberacing_private.profiles (profile_id, github_user_id, handle, state)
VALUES (
  '00000000-0000-4000-8000-000000034102',
  900000000000034102,
  'deletion-job-linked',
  'active'
);

INSERT INTO viberacing_private.deletion_jobs (
  deletion_job_id,
  profile_id,
  profile_ref_digest,
  state,
  requested_at,
  available_at,
  completed_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000034201',
    NULL,
    pg_catalog.decode(pg_catalog.lpad('34201', 64, '0'), 'hex'),
    'purged',
    pg_catalog.statement_timestamp() - INTERVAL '50 days',
    pg_catalog.statement_timestamp() - INTERVAL '50 days',
    pg_catalog.statement_timestamp() - INTERVAL '40 days'
  ),
  (
    '00000000-0000-4000-8000-000000034202',
    NULL,
    pg_catalog.decode(pg_catalog.lpad('34202', 64, '0'), 'hex'),
    'purged',
    pg_catalog.statement_timestamp() - INTERVAL '40 days',
    pg_catalog.statement_timestamp() - INTERVAL '40 days',
    pg_catalog.statement_timestamp() - INTERVAL '31 days'
  ),
  (
    '00000000-0000-4000-8000-000000034203',
    NULL,
    pg_catalog.decode(pg_catalog.lpad('34203', 64, '0'), 'hex'),
    'purged',
    pg_catalog.statement_timestamp() - INTERVAL '30 days',
    pg_catalog.statement_timestamp() - INTERVAL '30 days',
    pg_catalog.statement_timestamp() - INTERVAL '29 days'
  ),
  (
    '00000000-0000-4000-8000-000000034204',
    '00000000-0000-4000-8000-000000034101',
    pg_catalog.decode(pg_catalog.lpad('34204', 64, '0'), 'hex'),
    'queued',
    pg_catalog.statement_timestamp() - INTERVAL '45 days',
    pg_catalog.statement_timestamp() - INTERVAL '45 days',
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000034205',
    '00000000-0000-4000-8000-000000034102',
    pg_catalog.decode(pg_catalog.lpad('34205', 64, '0'), 'hex'),
    'purged',
    pg_catalog.statement_timestamp() - INTERVAL '50 days',
    pg_catalog.statement_timestamp() - INTERVAL '50 days',
    pg_catalog.statement_timestamp() - INTERVAL '40 days'
  );

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(index_record.indpred IS NOT NULL)
      AND pg_catalog.bool_and(index_record.indnkeyatts = 2)
    FROM pg_catalog.pg_index AS index_record
    JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index_record.indexrelid
    WHERE index_relation.relname = 'deletion_jobs_terminal_retention_idx'
  ),
  'terminal deletion jobs have one partial, deterministically ordered cleanup index'
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT deleted_deletion_jobs = 1
    FROM viberacing_api.cleanup_terminal_deletion_jobs(1)
  ),
  'the first batch deletes only the oldest eligible terminal deletion job'
);

SET LOCAL ROLE viberacing_owner;
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM viberacing_private.deletion_jobs
    WHERE deletion_job_id = '00000000-0000-4000-8000-000000034201'
  )
  AND EXISTS (
    SELECT 1 FROM viberacing_private.deletion_jobs
    WHERE deletion_job_id = '00000000-0000-4000-8000-000000034202'
  ),
  'terminal deletion-job cleanup follows completion and identifier order'
);

SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.assert_true(
  (
    SELECT deleted_deletion_jobs = 1
    FROM viberacing_api.cleanup_terminal_deletion_jobs(10)
  ),
  'the next batch deletes the remaining aged terminal deletion job'
);
SELECT pg_temp.assert_true(
  (
    SELECT deleted_deletion_jobs = 0
    FROM viberacing_api.cleanup_terminal_deletion_jobs(10)
  ),
  'terminal deletion-job cleanup is idempotent after eligible rows are gone'
);

SET LOCAL ROLE viberacing_owner;
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM viberacing_private.deletion_jobs
    WHERE deletion_job_id = '00000000-0000-4000-8000-000000034203'
      AND state = 'purged'
      AND profile_id IS NULL
      AND completed_at > pg_catalog.statement_timestamp() - INTERVAL '30 days'
  )
  AND EXISTS (
    SELECT 1 FROM viberacing_private.deletion_jobs
    WHERE deletion_job_id = '00000000-0000-4000-8000-000000034204'
      AND state = 'queued'
      AND profile_id = '00000000-0000-4000-8000-000000034101'
      AND completed_at IS NULL
  )
  AND EXISTS (
    SELECT 1 FROM viberacing_private.deletion_jobs
    WHERE deletion_job_id = '00000000-0000-4000-8000-000000034205'
      AND state = 'purged'
      AND profile_id = '00000000-0000-4000-8000-000000034102'
      AND completed_at <= pg_catalog.statement_timestamp() - INTERVAL '30 days'
  ),
  'recent, linked terminal evidence and non-terminal deletion authority remain untouched'
);

SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_terminal_deletion_jobs(NULL)$sql$,
  'a null terminal deletion-job cleanup batch fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_terminal_deletion_jobs(0)$sql$,
  'a zero terminal deletion-job cleanup batch fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_terminal_deletion_jobs(1001)$sql$,
  'an oversized terminal deletion-job cleanup batch fails closed'
);

SET LOCAL ROLE viberacing_web;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_terminal_deletion_jobs(1)$sql$,
  'Web cannot run terminal deletion-job cleanup'
);
SET LOCAL ROLE viberacing_ingest;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_terminal_deletion_jobs(1)$sql$,
  'Ingest cannot run terminal deletion-job cleanup'
);
SET LOCAL ROLE viberacing_admin;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_terminal_deletion_jobs(1)$sql$,
  'Admin cannot run terminal deletion-job cleanup'
);

SET LOCAL ROLE viberacing_owner;
DELETE FROM viberacing_private.maintenance_locks
WHERE capability = 'profile_deletion_purge';
SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_terminal_deletion_jobs(1)$sql$,
  'a missing private deletion mutex fails terminal deletion-job cleanup closed'
);

ROLLBACK;
