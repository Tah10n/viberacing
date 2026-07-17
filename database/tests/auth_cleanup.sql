\set ON_ERROR_STOP on

-- cspell:ignore indpred indexrelid relname

-- Deterministic synthetic evidence for bounded expired authentication-state cleanup. The
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
  ('00000000-0000-4000-8000-000000023101', 900000000000023101, 'auth-cleanup-one', 'active'),
  ('00000000-0000-4000-8000-000000023102', 900000000000023102, 'auth-cleanup-two', 'active'),
  ('00000000-0000-4000-8000-000000023103', 900000000000023103, 'auth-cleanup-live', 'active');

INSERT INTO viberacing_private.auth_challenges (
  challenge_id,
  purpose,
  challenge_digest,
  context_digest,
  created_at,
  expires_at,
  consumed_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000023201',
    'passkey_login',
    pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('31', 32), 'hex'),
    pg_catalog.statement_timestamp() - INTERVAL '12 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '7 minutes',
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000023202',
    'passkey_login',
    pg_catalog.decode(pg_catalog.repeat('22', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('32', 32), 'hex'),
    pg_catalog.statement_timestamp() - INTERVAL '10 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '5 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '6 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000023203',
    'passkey_login',
    pg_catalog.decode(pg_catalog.repeat('23', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('33', 32), 'hex'),
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp() + INTERVAL '5 minutes',
    NULL
  );

INSERT INTO viberacing_private.recovery_codes (
  recovery_code_id,
  profile_id,
  batch_id,
  position,
  verifier_phc,
  created_at,
  used_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000023301',
    '00000000-0000-4000-8000-000000023101',
    '00000000-0000-4000-8000-000000023311',
    0,
    NULL,
    pg_catalog.statement_timestamp() - INTERVAL '12 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '11 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000023302',
    '00000000-0000-4000-8000-000000023102',
    '00000000-0000-4000-8000-000000023312',
    0,
    NULL,
    pg_catalog.statement_timestamp() - INTERVAL '10 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '9 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000023303',
    '00000000-0000-4000-8000-000000023103',
    '00000000-0000-4000-8000-000000023313',
    0,
    NULL,
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp()
  );

INSERT INTO viberacing_private.recovery_authorities (
  recovery_authority_id,
  profile_id,
  source_recovery_code_id,
  verifier_digest,
  challenge_digest,
  context_digest,
  state,
  created_at,
  expires_at,
  revoked_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000023401',
    '00000000-0000-4000-8000-000000023101',
    '00000000-0000-4000-8000-000000023301',
    pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('51', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('61', 32), 'hex'),
    'active',
    pg_catalog.statement_timestamp() - INTERVAL '12 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '7 minutes',
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000023402',
    '00000000-0000-4000-8000-000000023102',
    '00000000-0000-4000-8000-000000023302',
    pg_catalog.decode(pg_catalog.repeat('42', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('52', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('62', 32), 'hex'),
    'revoked',
    pg_catalog.statement_timestamp() - INTERVAL '10 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '5 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '6 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000023403',
    '00000000-0000-4000-8000-000000023103',
    '00000000-0000-4000-8000-000000023303',
    pg_catalog.decode(pg_catalog.repeat('43', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('53', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('63', 32), 'hex'),
    'active',
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp() + INTERVAL '5 minutes',
    NULL
  );

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 2 AND pg_catalog.bool_and(index_record.indpred IS NULL)
    FROM pg_catalog.pg_index AS index_record
    JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index_record.indexrelid
    WHERE index_relation.relname IN (
      'auth_challenges_expiry_idx',
      'recovery_authorities_expiry_idx'
    )
  ),
  'cleanup expiry indexes include consumed and terminal rows'
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT
      deleted_challenges = 1
      AND deleted_recovery_authorities = 1
      AND deleted_used_recovery_codes = 1
    FROM viberacing_api.cleanup_expired_auth_state(1)
  ),
  'the first batch independently deletes the oldest expired challenge and recovery authority'
);

SELECT pg_temp.assert_true(
  (
    SELECT
      deleted_challenges = 1
      AND deleted_recovery_authorities = 1
      AND deleted_used_recovery_codes = 1
    FROM viberacing_api.cleanup_expired_auth_state(1)
  ),
  'the second batch removes the remaining expired authentication state'
);

SELECT pg_temp.assert_true(
  (
    SELECT
      deleted_challenges = 0
      AND deleted_recovery_authorities = 0
      AND deleted_used_recovery_codes = 0
    FROM viberacing_api.cleanup_expired_auth_state(1)
  ),
  'authentication cleanup is idempotent after expired state is gone'
);

SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM viberacing_private.auth_challenges
    WHERE challenge_id = '00000000-0000-4000-8000-000000023203'
      AND expires_at > pg_catalog.statement_timestamp()
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.recovery_authorities
    WHERE recovery_authority_id = '00000000-0000-4000-8000-000000023403'
      AND state = 'active'
      AND expires_at > pg_catalog.statement_timestamp()
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.recovery_codes
    WHERE recovery_code_id = '00000000-0000-4000-8000-000000023303'
      AND used_at IS NOT NULL
      AND verifier_phc IS NULL
  ),
  'live challenge, authority, and its already scrubbed code remain untouched'
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_auth_state(NULL)$sql$,
  'a null authentication cleanup batch fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_auth_state(0)$sql$,
  'a zero authentication cleanup batch fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_auth_state(1001)$sql$,
  'an oversized authentication cleanup batch fails closed'
);

SET LOCAL ROLE viberacing_web;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_auth_state(1)$sql$,
  'Web cannot run authentication cleanup'
);
SET LOCAL ROLE viberacing_ingest;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_auth_state(1)$sql$,
  'Ingest cannot run authentication cleanup'
);
SET LOCAL ROLE viberacing_admin;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_auth_state(1)$sql$,
  'Admin cannot run authentication cleanup'
);

SET LOCAL ROLE viberacing_owner;
DELETE FROM viberacing_private.maintenance_locks
WHERE capability = 'auth_retention_cleanup';
SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_auth_state(1)$sql$,
  'a missing private authentication cleanup mutex fails closed'
);

ROLLBACK;
