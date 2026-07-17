\set ON_ERROR_STOP on

-- Deterministic synthetic evidence for bounded expired CarRecipe-proposal cleanup. The
-- transaction is rolled back and does not imply a scheduler, deployed retention policy, or purge.

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

INSERT INTO viberacing_private.profiles (profile_id, github_user_id, handle, state)
VALUES
  ('00000000-0000-4000-8000-000000027101', 900000000000027101, 'car-cleanup-oldest', 'active'),
  ('00000000-0000-4000-8000-000000027102', 900000000000027102, 'car-cleanup-newer', 'active'),
  ('00000000-0000-4000-8000-000000027103', 900000000000027103, 'car-cleanup-live', 'active');

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
  '00000000-0000-4000-8000-000000027101',
  1,
  'roadster',
  'classic',
  'open',
  'none',
  'street',
  'mint',
  'none',
  27
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
  created_at,
  expires_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000027301',
    '00000000-0000-4000-8000-000000027101',
    1,
    'formula',
    'wedge',
    'canopy',
    'high',
    'slick',
    'redline',
    'grid',
    301,
    pg_catalog.statement_timestamp() - INTERVAL '4 hours',
    pg_catalog.statement_timestamp() - INTERVAL '3 hours'
  ),
  (
    '00000000-0000-4000-8000-000000027302',
    '00000000-0000-4000-8000-000000027102',
    1,
    'rally',
    'scoop',
    'rally',
    'low',
    'all-terrain',
    'sunburst',
    'spark',
    302,
    pg_catalog.statement_timestamp() - INTERVAL '3 hours',
    pg_catalog.statement_timestamp() - INTERVAL '2 hours'
  ),
  (
    '00000000-0000-4000-8000-000000027303',
    '00000000-0000-4000-8000-000000027103',
    1,
    'roadster',
    'classic',
    'open',
    'none',
    'street',
    'turbo-blue',
    'none',
    303,
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour'
  );

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT deleted_proposals = 1
    FROM viberacing_api.cleanup_expired_car_recipe_proposals(1)
  ),
  'the first batch deletes exactly one expired proposal'
);

SET LOCAL ROLE viberacing_owner;
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM viberacing_private.car_recipe_proposals
    WHERE proposal_id = '00000000-0000-4000-8000-000000027301'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.car_recipe_proposals
    WHERE proposal_id = '00000000-0000-4000-8000-000000027302'
  ),
  'oldest-first cleanup leaves the newer expired proposal for a later batch'
);

SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.assert_true(
  (
    SELECT deleted_proposals = 1
    FROM viberacing_api.cleanup_expired_car_recipe_proposals(1)
  ),
  'the second batch deletes the remaining expired proposal'
);
SELECT pg_temp.assert_true(
  (
    SELECT deleted_proposals = 0
    FROM viberacing_api.cleanup_expired_car_recipe_proposals(1)
  ),
  'proposal cleanup is idempotent after expired state is gone'
);

SET LOCAL ROLE viberacing_owner;
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM viberacing_private.car_recipe_proposals
    WHERE proposal_id = '00000000-0000-4000-8000-000000027303'
      AND expires_at > pg_catalog.statement_timestamp()
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.profile_car_recipes
    WHERE profile_id = '00000000-0000-4000-8000-000000027101'
      AND seed = 27
  ),
  'cleanup preserves live proposals and active recipes'
);

SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_car_recipe_proposals(NULL)$sql$,
  'a null CarRecipe proposal cleanup batch fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_car_recipe_proposals(0)$sql$,
  'a zero CarRecipe proposal cleanup batch fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_car_recipe_proposals(1001)$sql$,
  'an oversized CarRecipe proposal cleanup batch fails closed'
);

SET LOCAL ROLE viberacing_web;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_car_recipe_proposals(1)$sql$,
  'Web cannot run CarRecipe proposal cleanup'
);
SET LOCAL ROLE viberacing_ingest;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_car_recipe_proposals(1)$sql$,
  'Ingest cannot run CarRecipe proposal cleanup'
);
SET LOCAL ROLE viberacing_admin;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_car_recipe_proposals(1)$sql$,
  'Admin cannot run CarRecipe proposal cleanup'
);

SET LOCAL ROLE viberacing_owner;
DELETE FROM viberacing_private.maintenance_locks
WHERE capability = 'car_recipe_proposal_cleanup';
SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_car_recipe_proposals(1)$sql$,
  'a missing private CarRecipe proposal cleanup mutex fails closed'
);

ROLLBACK;
