\set ON_ERROR_STOP on

-- cspell:ignore indexrelid relname indpred indnkeyatts

-- Deterministic synthetic evidence for bounded expired-invite cleanup. The transaction is rolled
-- back and does not imply invite issuance UI, a scheduler, or deployed retention evidence.

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
VALUES (
  '00000000-0000-4000-8000-000000032101',
  900000000000032101,
  'invite-cleanup',
  'active'
);

INSERT INTO viberacing_private.invites (
  invite_id,
  verifier_digest,
  state,
  created_at,
  expires_at,
  redeemed_at,
  redeemed_profile_id
)
VALUES
  (
    '00000000-0000-4000-8000-000000032201',
    pg_catalog.decode(pg_catalog.lpad('32201', 64, '0'), 'hex'),
    'active',
    pg_catalog.statement_timestamp() - INTERVAL '2 hours',
    pg_catalog.statement_timestamp() - INTERVAL '30 minutes',
    NULL,
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000032202',
    pg_catalog.decode(pg_catalog.lpad('32202', 64, '0'), 'hex'),
    'revoked',
    pg_catalog.statement_timestamp() - INTERVAL '2 hours',
    pg_catalog.statement_timestamp() - INTERVAL '20 minutes',
    NULL,
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000032203',
    pg_catalog.decode(pg_catalog.lpad('32203', 64, '0'), 'hex'),
    'redeemed',
    pg_catalog.statement_timestamp() - INTERVAL '2 hours',
    pg_catalog.statement_timestamp() - INTERVAL '10 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '1 hour',
    '00000000-0000-4000-8000-000000032101'
  ),
  (
    '00000000-0000-4000-8000-000000032204',
    pg_catalog.decode(pg_catalog.lpad('32204', 64, '0'), 'hex'),
    'active',
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour',
    NULL,
    NULL
  );

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(index_record.indpred IS NOT NULL)
      AND pg_catalog.bool_and(index_record.indnkeyatts = 2)
    FROM pg_catalog.pg_index AS index_record
    JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index_record.indexrelid
    WHERE index_relation.relname = 'invites_expiry_idx'
  ),
  'the unredeemed invite cleanup index is partial and deterministically ordered'
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT deleted_invites = 1
    FROM viberacing_api.cleanup_expired_invites(1)
  ),
  'the first invite batch deletes only the oldest expired unredeemed verifier'
);

SET LOCAL ROLE viberacing_owner;
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM viberacing_private.invites
    WHERE invite_id = '00000000-0000-4000-8000-000000032201'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.invites
    WHERE invite_id = '00000000-0000-4000-8000-000000032202'
  ),
  'the bounded batch follows expiry and identifier order'
);

SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.assert_true(
  (
    SELECT deleted_invites = 1
    FROM viberacing_api.cleanup_expired_invites(10)
  ),
  'the next batch deletes the expired revoked verifier'
);
SELECT pg_temp.assert_true(
  (
    SELECT deleted_invites = 0
    FROM viberacing_api.cleanup_expired_invites(10)
  ),
  'invite cleanup is idempotent after eligible rows are gone'
);

SET LOCAL ROLE viberacing_owner;
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM viberacing_private.invites
    WHERE invite_id = '00000000-0000-4000-8000-000000032203'
      AND state = 'redeemed'
      AND redeemed_profile_id = '00000000-0000-4000-8000-000000032101'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.invites
    WHERE invite_id = '00000000-0000-4000-8000-000000032204'
      AND state = 'active'
      AND expires_at > pg_catalog.statement_timestamp()
  ),
  'redeemed provenance and live invite authority remain untouched'
);

SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_invites(NULL)$sql$,
  'a null invite cleanup batch fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_invites(0)$sql$,
  'a zero invite cleanup batch fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_invites(1001)$sql$,
  'an oversized invite cleanup batch fails closed'
);

SET LOCAL ROLE viberacing_web;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_invites(1)$sql$,
  'Web cannot run invite cleanup'
);
SET LOCAL ROLE viberacing_ingest;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_invites(1)$sql$,
  'Ingest cannot run invite cleanup'
);
SET LOCAL ROLE viberacing_admin;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_invites(1)$sql$,
  'Admin cannot run invite cleanup'
);

SET LOCAL ROLE viberacing_owner;
DELETE FROM viberacing_private.maintenance_locks
WHERE capability = 'auth_retention_cleanup';
SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_invites(1)$sql$,
  'a missing private authentication mutex fails invite cleanup closed'
);

ROLLBACK;
