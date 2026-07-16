\set ON_ERROR_STOP on

-- cspell:ignore indexrelid relname indpred indrelid

-- Deterministic synthetic evidence for the reviewed pairing cleanup procedure. The transaction is
-- rolled back and does not imply a scheduler, production retention policy, or user-data purge.

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
  '00000000-0000-4000-8000-000000014101',
  900000000000014101,
  'pairing-cleanup',
  'active'
);

INSERT INTO viberacing_private.sessions (
  session_id,
  profile_id,
  verifier_digest,
  expires_at
)
VALUES (
  '00000000-0000-4000-8000-000000014201',
  '00000000-0000-4000-8000-000000014101',
  pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '1 hour'
);

INSERT INTO viberacing_private.passkeys (
  passkey_id,
  profile_id,
  credential_id,
  cose_public_key,
  label
)
VALUES (
  '00000000-0000-4000-8000-000000014301',
  '00000000-0000-4000-8000-000000014101',
  pg_catalog.decode(pg_catalog.repeat('31', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('32', 64), 'hex'),
  'Pairing cleanup passkey'
);

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES (
  'src_' || pg_catalog.repeat('J', 22),
  '00000000-0000-4000-8000-000000014101'
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
VALUES
  (
    '00000000-0000-4000-8000-000000014401',
    pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
    'Expired pending connector',
    '6.0.0',
    'linux',
    'x86_64',
    pg_catalog.statement_timestamp() - INTERVAL '30 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000014402',
    pg_catalog.decode(pg_catalog.repeat('42', 32), 'hex'),
    'Expired approved connector',
    '6.0.0',
    'linux',
    'x86_64',
    pg_catalog.statement_timestamp() - INTERVAL '25 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000014403',
    pg_catalog.decode(pg_catalog.repeat('43', 32), 'hex'),
    'Expired cancelled connector',
    '6.0.0',
    'linux',
    'x86_64',
    pg_catalog.statement_timestamp() - INTERVAL '20 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000014404',
    pg_catalog.decode(pg_catalog.repeat('44', 32), 'hex'),
    'Live pending connector',
    '6.0.0',
    'linux',
    'x86_64',
    pg_catalog.statement_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000014405',
    pg_catalog.decode(pg_catalog.repeat('45', 32), 'hex'),
    'Activated connector',
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
VALUES
  (
    '00000000-0000-4000-8000-000000014501',
    pg_catalog.decode(pg_catalog.repeat('51', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('61', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('71', 32), 'hex'),
    '00000000-0000-4000-8000-000000014401',
    'Expired pending connector',
    '6.0.0',
    'linux',
    'x86_64',
    pg_catalog.statement_timestamp() - INTERVAL '30 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '20 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000014502',
    pg_catalog.decode(pg_catalog.repeat('52', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('62', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('72', 32), 'hex'),
    '00000000-0000-4000-8000-000000014402',
    'Expired approved connector',
    '6.0.0',
    'linux',
    'x86_64',
    pg_catalog.statement_timestamp() - INTERVAL '25 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '15 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000014503',
    pg_catalog.decode(pg_catalog.repeat('53', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('63', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('73', 32), 'hex'),
    '00000000-0000-4000-8000-000000014403',
    'Expired cancelled connector',
    '6.0.0',
    'linux',
    'x86_64',
    pg_catalog.statement_timestamp() - INTERVAL '20 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '10 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000014504',
    pg_catalog.decode(pg_catalog.repeat('54', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('64', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('74', 32), 'hex'),
    '00000000-0000-4000-8000-000000014404',
    'Live pending connector',
    '6.0.0',
    'linux',
    'x86_64',
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp() + INTERVAL '5 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000014505',
    pg_catalog.decode(pg_catalog.repeat('55', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('65', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('75', 32), 'hex'),
    '00000000-0000-4000-8000-000000014405',
    'Activated connector',
    '6.0.0',
    'linux',
    'x86_64',
    pg_catalog.statement_timestamp() - INTERVAL '20 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '5 minutes'
  );

UPDATE viberacing_private.pairing_transactions
SET
  state = 'approved',
  approved_profile_id = '00000000-0000-4000-8000-000000014101',
  source_choice = 'existing',
  approved_source_id = 'src_' || pg_catalog.repeat('J', 22),
  approved_by_session_id = '00000000-0000-4000-8000-000000014201',
  approved_by_passkey_id = '00000000-0000-4000-8000-000000014301',
  approved_at = pg_catalog.statement_timestamp() - INTERVAL '20 minutes'
WHERE pairing_id = '00000000-0000-4000-8000-000000014502';

UPDATE viberacing_private.pairing_transactions
SET state = 'cancelled'
WHERE pairing_id = '00000000-0000-4000-8000-000000014503';

UPDATE viberacing_private.pairing_transactions
SET
  state = 'approved',
  approved_profile_id = '00000000-0000-4000-8000-000000014101',
  source_choice = 'existing',
  approved_source_id = 'src_' || pg_catalog.repeat('J', 22),
  approved_by_session_id = '00000000-0000-4000-8000-000000014201',
  approved_by_passkey_id = '00000000-0000-4000-8000-000000014301',
  approved_at = pg_catalog.statement_timestamp() - INTERVAL '15 minutes'
WHERE pairing_id = '00000000-0000-4000-8000-000000014505';

UPDATE viberacing_private.device_keys
SET
  state = 'active',
  source_id = 'src_' || pg_catalog.repeat('J', 22),
  device_id = 'dev_' || pg_catalog.repeat('J', 22),
  activated_at = pg_catalog.statement_timestamp() - INTERVAL '10 minutes'
WHERE device_key_id = '00000000-0000-4000-8000-000000014405';

UPDATE viberacing_private.pairing_transactions
SET
  state = 'activated',
  activated_device_id = 'dev_' || pg_catalog.repeat('J', 22),
  activated_at = pg_catalog.statement_timestamp() - INTERVAL '10 minutes'
WHERE pairing_id = '00000000-0000-4000-8000-000000014505';

INSERT INTO viberacing_private.auth_challenges (
  challenge_id,
  profile_id,
  session_id,
  purpose,
  challenge_digest,
  context_digest,
  created_at,
  expires_at,
  authorized_pairing_id,
  authorized_source_choice,
  authorized_source_id
)
VALUES (
  '00000000-0000-4000-8000-000000014601',
  '00000000-0000-4000-8000-000000014101',
  '00000000-0000-4000-8000-000000014201',
  'pairing_approval',
  pg_catalog.decode(pg_catalog.repeat('81', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
  pg_catalog.statement_timestamp() - INTERVAL '20 minutes',
  pg_catalog.statement_timestamp() - INTERVAL '15 minutes',
  '00000000-0000-4000-8000-000000014502',
  'existing',
  'src_' || pg_catalog.repeat('J', 22)
);

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_record
    JOIN pg_catalog.pg_class AS index_relation
      ON index_relation.oid = index_record.indexrelid
    WHERE index_relation.relname = 'pairing_transactions_expiry_idx'
      AND pg_catalog.pg_get_expr(index_record.indpred, index_record.indrelid) LIKE '%cancelled%'
  ),
  'the bounded expiry index includes cancelled pairings'
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT deleted_pairings = 2 AND deleted_pending_keys = 2
    FROM viberacing_api.cleanup_expired_pairing_state(2)
  ),
  'the first batch removes the two oldest expired pairings and pending keys'
);

SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM viberacing_private.auth_challenges
    WHERE challenge_id = '00000000-0000-4000-8000-000000014601'
  ),
  'approval challenge state cascades with its expired pairing'
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT deleted_pairings = 1 AND deleted_pending_keys = 1
    FROM viberacing_api.cleanup_expired_pairing_state(2)
  ),
  'the second batch removes the expired cancelled pairing and pending key'
);

SELECT pg_temp.assert_true(
  (
    SELECT deleted_pairings = 0 AND deleted_pending_keys = 0
    FROM viberacing_api.cleanup_expired_pairing_state(2)
  ),
  'pairing cleanup is idempotent after expired removable state is gone'
);

SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '00000000-0000-4000-8000-000000014504'
      AND state = 'pending'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.device_keys
    WHERE device_key_id = '00000000-0000-4000-8000-000000014404'
      AND state = 'pending'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '00000000-0000-4000-8000-000000014505'
      AND state = 'activated'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.device_keys
    WHERE device_key_id = '00000000-0000-4000-8000-000000014405'
      AND state = 'active'
  ),
  'live pending and activated pairing authority remain untouched'
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_pairing_state(NULL)$sql$,
  'a null pairing cleanup batch fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_pairing_state(0)$sql$,
  'a zero pairing cleanup batch fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_pairing_state(1001)$sql$,
  'an oversized pairing cleanup batch fails closed'
);

SET LOCAL ROLE viberacing_web;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_pairing_state(1)$sql$,
  'Web cannot run pairing cleanup'
);
SET LOCAL ROLE viberacing_ingest;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_pairing_state(1)$sql$,
  'Ingest cannot run pairing cleanup'
);
SET LOCAL ROLE viberacing_admin;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_pairing_state(1)$sql$,
  'Admin cannot run pairing cleanup'
);

SET LOCAL ROLE viberacing_owner;
DELETE FROM viberacing_private.maintenance_locks
WHERE capability = 'pairing_retention_cleanup';
SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_pairing_state(1)$sql$,
  'a missing private pairing cleanup mutex fails closed'
);

ROLLBACK;
