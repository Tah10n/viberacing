\set ON_ERROR_STOP on

-- cspell:ignore indexrelid relname indpred

-- Deterministic synthetic evidence for bounded expired-session cleanup. The transaction is rolled
-- back and does not imply a scheduler, deployed retention policy, or complete provenance purge.

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
  '00000000-0000-4000-8000-000000030101',
  900000000000030101,
  'session-cleanup',
  'active'
);

INSERT INTO viberacing_private.sessions (
  session_id,
  profile_id,
  verifier_digest,
  state,
  created_at,
  expires_at,
  ended_at,
  replaced_by_session_id
)
VALUES
  (
    '00000000-0000-4000-8000-000000030201',
    '00000000-0000-4000-8000-000000030101',
    pg_catalog.decode(pg_catalog.lpad('30201', 64, '0'), 'hex'),
    'active',
    pg_catalog.statement_timestamp() - INTERVAL '2 hours',
    pg_catalog.statement_timestamp() - INTERVAL '12 minutes',
    NULL,
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000030202',
    '00000000-0000-4000-8000-000000030101',
    pg_catalog.decode(pg_catalog.lpad('30202', 64, '0'), 'hex'),
    'revoked',
    pg_catalog.statement_timestamp() - INTERVAL '2 hours',
    pg_catalog.statement_timestamp() - INTERVAL '10 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '20 minutes',
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000030203',
    '00000000-0000-4000-8000-000000030101',
    pg_catalog.decode(pg_catalog.lpad('30203', 64, '0'), 'hex'),
    'rotated',
    pg_catalog.statement_timestamp() - INTERVAL '2 hours',
    pg_catalog.statement_timestamp() - INTERVAL '8 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '30 minutes',
    '00000000-0000-4000-8000-000000030204'
  ),
  (
    '00000000-0000-4000-8000-000000030204',
    '00000000-0000-4000-8000-000000030101',
    pg_catalog.decode(pg_catalog.lpad('30204', 64, '0'), 'hex'),
    'active',
    pg_catalog.statement_timestamp() - INTERVAL '30 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '6 minutes',
    NULL,
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000030205',
    '00000000-0000-4000-8000-000000030101',
    pg_catalog.decode(pg_catalog.lpad('30205', 64, '0'), 'hex'),
    'active',
    pg_catalog.statement_timestamp() - INTERVAL '30 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '5 minutes',
    NULL,
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000030206',
    '00000000-0000-4000-8000-000000030101',
    pg_catalog.decode(pg_catalog.lpad('30206', 64, '0'), 'hex'),
    'active',
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour',
    NULL,
    NULL
  );

INSERT INTO viberacing_private.auth_challenges (
  challenge_id,
  profile_id,
  session_id,
  purpose,
  challenge_digest,
  context_digest,
  created_at,
  expires_at
)
VALUES (
  '00000000-0000-4000-8000-000000030301',
  '00000000-0000-4000-8000-000000030101',
  '00000000-0000-4000-8000-000000030201',
  'passkey_registration',
  pg_catalog.decode(pg_catalog.lpad('30301', 64, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('30311', 64, '0'), 'hex'),
  pg_catalog.statement_timestamp(),
  pg_catalog.statement_timestamp() + INTERVAL '5 minutes'
);

INSERT INTO viberacing_private.passkeys (
  passkey_id,
  profile_id,
  credential_id,
  cose_public_key,
  label
)
VALUES (
  '00000000-0000-4000-8000-000000030401',
  '00000000-0000-4000-8000-000000030101',
  pg_catalog.decode(pg_catalog.lpad('30401', 64, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('30411', 128, '0'), 'hex'),
  'Session cleanup passkey'
);

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES (
  'src_' || pg_catalog.repeat('S', 22),
  '00000000-0000-4000-8000-000000030101'
);

INSERT INTO viberacing_private.device_keys (
  device_key_id,
  public_key,
  label,
  connector_version,
  os_family,
  architecture,
  created_at
)
VALUES (
  '00000000-0000-4000-8000-000000030501',
  pg_catalog.decode(pg_catalog.lpad('30501', 64, '0'), 'hex'),
  'Retained connector',
  '6.0.0',
  'linux',
  'x86_64',
  pg_catalog.statement_timestamp() - INTERVAL '20 minutes'
);

INSERT INTO viberacing_private.pairing_transactions (
  pairing_id,
  poll_verifier_digest,
  user_code_digest,
  challenge,
  pending_device_key_id,
  device_label,
  connector_version,
  os_family,
  architecture,
  created_at,
  expires_at
)
VALUES (
  '00000000-0000-4000-8000-000000030601',
  pg_catalog.decode(pg_catalog.lpad('30601', 64, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('30611', 64, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('30621', 64, '0'), 'hex'),
  '00000000-0000-4000-8000-000000030501',
  'Retained connector',
  '6.0.0',
  'linux',
  'x86_64',
  pg_catalog.statement_timestamp() - INTERVAL '20 minutes',
  pg_catalog.statement_timestamp() - INTERVAL '4 minutes'
);

UPDATE viberacing_private.pairing_transactions
SET
  state = 'approved',
  approved_profile_id = '00000000-0000-4000-8000-000000030101',
  source_choice = 'existing',
  approved_source_id = 'src_' || pg_catalog.repeat('S', 22),
  approved_at = pg_catalog.statement_timestamp() - INTERVAL '15 minutes',
  approved_by_session_id = '00000000-0000-4000-8000-000000030205',
  approved_by_passkey_id = '00000000-0000-4000-8000-000000030401'
WHERE pairing_id = '00000000-0000-4000-8000-000000030601';

UPDATE viberacing_private.device_keys
SET
  state = 'active',
  source_id = 'src_' || pg_catalog.repeat('S', 22),
  device_id = 'dev_' || pg_catalog.repeat('S', 22),
  activated_at = pg_catalog.statement_timestamp() - INTERVAL '10 minutes'
WHERE device_key_id = '00000000-0000-4000-8000-000000030501';

UPDATE viberacing_private.pairing_transactions
SET
  state = 'activated',
  activated_device_id = 'dev_' || pg_catalog.repeat('S', 22),
  activated_at = pg_catalog.statement_timestamp() - INTERVAL '10 minutes'
WHERE pairing_id = '00000000-0000-4000-8000-000000030601';

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1 AND pg_catalog.bool_and(index_record.indpred IS NULL)
    FROM pg_catalog.pg_index AS index_record
    JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index_record.indexrelid
    WHERE index_relation.relname = 'sessions_expiry_idx'
  ),
  'the session cleanup expiry index includes active, revoked, and rotated rows'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1 AND pg_catalog.bool_and(index_record.indpred IS NOT NULL)
    FROM pg_catalog.pg_index AS index_record
    JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index_record.indexrelid
    WHERE index_relation.relname = 'pairing_transactions_approval_session_idx'
  ),
  'pairing session provenance has a bounded supporting index'
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT deleted_sessions = 1
    FROM viberacing_api.cleanup_expired_sessions(1)
  ),
  'the first batch deletes only the oldest eligible expired session'
);

SET LOCAL ROLE viberacing_owner;
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM viberacing_private.auth_challenges
    WHERE challenge_id = '00000000-0000-4000-8000-000000030301'
  ),
  'session deletion cascades its now-unusable session-bound challenge'
);

SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.assert_true(
  (
    SELECT deleted_sessions = 3
    FROM viberacing_api.cleanup_expired_sessions(3)
  ),
  'one bounded call removes terminal state and advances through an expired rotation chain'
);

SELECT pg_temp.assert_true(
  (
    SELECT deleted_sessions = 0
    FROM viberacing_api.cleanup_expired_sessions(10)
  ),
  'session cleanup is idempotent after eligible expired rows are gone'
);

SET LOCAL ROLE viberacing_owner;
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM viberacing_private.sessions
    WHERE session_id = '00000000-0000-4000-8000-000000030205'
      AND expires_at <= pg_catalog.statement_timestamp()
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '00000000-0000-4000-8000-000000030601'
      AND approved_by_session_id = '00000000-0000-4000-8000-000000030205'
      AND state = 'activated'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.sessions
    WHERE session_id = '00000000-0000-4000-8000-000000030206'
      AND state = 'active'
      AND expires_at > pg_catalog.statement_timestamp()
  ),
  'immutable pairing provenance and the live session remain untouched'
);

SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_sessions(NULL)$sql$,
  'a null session cleanup batch fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_sessions(0)$sql$,
  'a zero session cleanup batch fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_sessions(1001)$sql$,
  'an oversized session cleanup batch fails closed'
);

SET LOCAL ROLE viberacing_web;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_sessions(1)$sql$,
  'Web cannot run session cleanup'
);
SET LOCAL ROLE viberacing_ingest;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_sessions(1)$sql$,
  'Ingest cannot run session cleanup'
);
SET LOCAL ROLE viberacing_admin;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_sessions(1)$sql$,
  'Admin cannot run session cleanup'
);

SET LOCAL ROLE viberacing_owner;
DELETE FROM viberacing_private.maintenance_locks
WHERE capability = 'auth_retention_cleanup';
SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_sessions(1)$sql$,
  'a missing private authentication mutex fails session cleanup closed'
);

ROLLBACK;
