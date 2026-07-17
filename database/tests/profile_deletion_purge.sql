\set ON_ERROR_STOP on

-- Deterministic synthetic evidence for bounded primary profile deletion. The transaction is
-- rolled back and does not imply a scheduler, backup purge, tombstone policy, or deployment.

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

WITH generated_profile AS (
  SELECT profile_number
  FROM pg_catalog.generate_series(1, 12) AS profile_number
)
INSERT INTO viberacing_private.profiles (
  profile_id,
  github_user_id,
  handle,
  state,
  hidden_at,
  deletion_requested_at
)
SELECT
  (
    '00000000-0000-4000-8000-'
    || pg_catalog.lpad((240000000000 + profile_number)::text, 12, '0')
  )::uuid,
  900000000000024000 + profile_number,
  'purge-batch-' || pg_catalog.lpad(profile_number::text, 2, '0'),
  'deletion_pending',
  pg_catalog.statement_timestamp(),
  pg_catalog.statement_timestamp()
FROM generated_profile;

WITH generated_job AS (
  SELECT profile_number
  FROM pg_catalog.generate_series(1, 12) AS profile_number
)
INSERT INTO viberacing_private.deletion_jobs (
  deletion_job_id,
  profile_id,
  profile_ref_digest,
  state,
  attempt_count,
  requested_at,
  available_at,
  last_error_code
)
SELECT
  (
    '00000000-0000-4000-8000-'
    || pg_catalog.lpad((241000000000 + profile_number)::text, 12, '0')
  )::uuid,
  (
    '00000000-0000-4000-8000-'
    || pg_catalog.lpad((240000000000 + profile_number)::text, 12, '0')
  )::uuid,
  pg_catalog.decode(
    pg_catalog.lpad(pg_catalog.to_hex(242000000000 + profile_number), 64, '0'),
    'hex'
  ),
  CASE WHEN profile_number = 11 THEN 'retry_wait' ELSE 'queued' END,
  CASE WHEN profile_number = 11 THEN 2 ELSE 0 END,
  pg_catalog.statement_timestamp() - INTERVAL '20 minutes'
    + profile_number * INTERVAL '1 second',
  CASE
    WHEN profile_number = 12 THEN pg_catalog.statement_timestamp() + INTERVAL '1 hour'
    ELSE pg_catalog.statement_timestamp() - INTERVAL '20 minutes'
      + profile_number * INTERVAL '1 second'
  END,
  CASE WHEN profile_number = 11 THEN 'RETRYABLE_FAILURE' ELSE NULL END
FROM generated_job;

INSERT INTO viberacing_private.profile_car_recipes (
  profile_id,
  schema_version,
  chassis,
  nose,
  cockpit,
  wing,
  wheels,
  palette,
  trail,
  seed
)
VALUES (
  '00000000-0000-4000-8000-240000000001',
  1,
  'roadster',
  'classic',
  'canopy',
  'none',
  'street',
  'mint',
  'none',
  7
);

INSERT INTO viberacing_private.car_recipe_proposals (
  proposal_id,
  profile_id,
  schema_version,
  chassis,
  nose,
  cockpit,
  wing,
  wheels,
  palette,
  trail,
  seed,
  expires_at
)
VALUES (
  '00000000-0000-4000-8000-243000000001',
  '00000000-0000-4000-8000-240000000001',
  1,
  'rally',
  'scoop',
  'rally',
  'low',
  'all-terrain',
  'sunburst',
  'spark',
  42,
  pg_catalog.statement_timestamp() + INTERVAL '1 hour'
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT purged_profiles = 10
    FROM viberacing_api.purge_profile_deletions(10)
  ),
  'one call purges at most ten oldest due profiles'
);

SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 2
    FROM viberacing_private.profiles
    WHERE handle LIKE 'purge-batch-%'
  )
  AND (
    SELECT pg_catalog.count(*) = 10
      AND pg_catalog.bool_and(profile_id IS NULL AND completed_at IS NOT NULL)
    FROM viberacing_private.deletion_jobs
    WHERE state = 'purged'
      AND deletion_job_id::text LIKE '00000000-0000-4000-8000-2410000000%'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.deletion_jobs
    WHERE deletion_job_id = '00000000-0000-4000-8000-241000000011'
      AND state = 'retry_wait'
      AND profile_id = '00000000-0000-4000-8000-240000000011'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.deletion_jobs
    WHERE deletion_job_id = '00000000-0000-4000-8000-241000000012'
      AND state = 'queued'
      AND available_at > pg_catalog.statement_timestamp()
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.profile_car_recipes
    WHERE profile_id = '00000000-0000-4000-8000-240000000001'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.car_recipe_proposals
    WHERE profile_id = '00000000-0000-4000-8000-240000000001'
  ),
  'the batch cascades CarRecipe state and leaves the next due and future jobs untouched'
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT purged_profiles = 1
    FROM viberacing_api.purge_profile_deletions(10)
  ),
  'a retry-wait job is purged when its availability window is due'
);

SELECT pg_temp.assert_true(
  (
    SELECT purged_profiles = 0
    FROM viberacing_api.purge_profile_deletions(10)
  ),
  'future work is preserved and an empty due batch is idempotent'
);

SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.purge_profile_deletions(NULL)$sql$,
  'a null deletion purge batch fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.purge_profile_deletions(0)$sql$,
  'a zero deletion purge batch fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.purge_profile_deletions(11)$sql$,
  'an oversized deletion purge batch fails closed'
);

SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (profile_id, github_user_id, handle, state)
VALUES (
  '00000000-0000-4000-8000-240000000013',
  900000000000024013,
  'purge-state-drift',
  'active'
);

INSERT INTO viberacing_private.deletion_jobs (
  deletion_job_id,
  profile_id,
  profile_ref_digest,
  requested_at,
  available_at
)
VALUES (
  '00000000-0000-4000-8000-241000000013',
  '00000000-0000-4000-8000-240000000013',
  pg_catalog.decode(pg_catalog.lpad(pg_catalog.to_hex(242000000013), 64, '0'), 'hex'),
  pg_catalog.statement_timestamp() - INTERVAL '1 minute',
  pg_catalog.statement_timestamp() - INTERVAL '1 minute'
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.purge_profile_deletions(1)$sql$,
  'a queue row cannot purge a profile without committed deletion-pending state'
);

SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM viberacing_private.profiles
    WHERE profile_id = '00000000-0000-4000-8000-240000000013'
      AND state = 'active'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.deletion_jobs
    WHERE deletion_job_id = '00000000-0000-4000-8000-241000000013'
      AND state = 'queued'
      AND completed_at IS NULL
  ),
  'state drift rolls the entire attempted purge back'
);

DELETE FROM viberacing_private.deletion_jobs
WHERE deletion_job_id = '00000000-0000-4000-8000-241000000013';
DELETE FROM viberacing_private.profiles
WHERE profile_id = '00000000-0000-4000-8000-240000000013';

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM viberacing_private.deletion_tombstones AS tombstone_record
    JOIN viberacing_private.deletion_jobs AS job_record
      ON job_record.profile_ref_digest = tombstone_record.profile_ref_digest
    WHERE job_record.deletion_job_id::text LIKE '00000000-0000-4000-8000-2410000000%'
  ),
  'primary purge does not invent an unkeyed restore tombstone'
);

SET LOCAL ROLE viberacing_web;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.purge_profile_deletions(1)$sql$,
  'Web cannot purge profiles'
);
SET LOCAL ROLE viberacing_ingest;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.purge_profile_deletions(1)$sql$,
  'Ingest cannot purge profiles'
);
SET LOCAL ROLE viberacing_admin;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.purge_profile_deletions(1)$sql$,
  'Admin cannot purge profiles'
);

SET LOCAL ROLE viberacing_owner;
DELETE FROM viberacing_private.maintenance_locks
WHERE capability = 'profile_deletion_purge';
SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.purge_profile_deletions(1)$sql$,
  'a missing private deletion purge mutex fails closed'
);

ROLLBACK;
