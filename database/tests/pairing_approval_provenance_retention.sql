\set ON_ERROR_STOP on

-- cspell:ignore indexdef indexrelid relname indpred indnkeyatts

-- Deterministic synthetic evidence for bounded pairing approval-provenance redaction. The
-- transaction is rolled back and does not imply device-history deletion, scheduling, or deployment.

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

CREATE FUNCTION pg_temp.expect_integrity_failure(statement text, label text)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION
    WHEN integrity_constraint_violation THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected integrity failure: %', label;
END
$function$;

SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (profile_id, github_user_id, handle, state)
VALUES (
  '00000000-0000-4000-8000-000000037101',
  900000000000037101,
  'pairing-retention-test',
  'active'
);

INSERT INTO viberacing_private.passkeys (
  passkey_id,
  profile_id,
  credential_id,
  cose_public_key,
  label,
  created_at
)
VALUES (
  '00000000-0000-4000-8000-000000037201',
  '00000000-0000-4000-8000-000000037101',
  pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('22', 64), 'hex'),
  'Pairing provenance passkey',
  pg_catalog.statement_timestamp() - INTERVAL '230 days'
);

INSERT INTO viberacing_private.sessions (
  session_id,
  profile_id,
  verifier_digest,
  authentication_kind,
  authenticated_by_passkey_id,
  created_at,
  expires_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000037301',
    '00000000-0000-4000-8000-000000037101',
    pg_catalog.decode(pg_catalog.repeat('31', 32), 'hex'),
    'passkey',
    '00000000-0000-4000-8000-000000037201',
    pg_catalog.statement_timestamp() - INTERVAL '230 days',
    pg_catalog.statement_timestamp() - INTERVAL '210 days'
  ),
  (
    '00000000-0000-4000-8000-000000037302',
    '00000000-0000-4000-8000-000000037101',
    pg_catalog.decode(pg_catalog.repeat('32', 32), 'hex'),
    'passkey',
    '00000000-0000-4000-8000-000000037201',
    pg_catalog.statement_timestamp() - INTERVAL '210 days',
    pg_catalog.statement_timestamp() - INTERVAL '190 days'
  ),
  (
    '00000000-0000-4000-8000-000000037303',
    '00000000-0000-4000-8000-000000037101',
    pg_catalog.decode(pg_catalog.repeat('33', 32), 'hex'),
    'passkey',
    '00000000-0000-4000-8000-000000037201',
    pg_catalog.statement_timestamp() - INTERVAL '190 days',
    pg_catalog.statement_timestamp() - INTERVAL '170 days'
  ),
  (
    '00000000-0000-4000-8000-000000037304',
    '00000000-0000-4000-8000-000000037101',
    pg_catalog.decode(pg_catalog.repeat('34', 32), 'hex'),
    'passkey',
    '00000000-0000-4000-8000-000000037201',
    pg_catalog.statement_timestamp() - INTERVAL '189 days',
    pg_catalog.statement_timestamp() - INTERVAL '169 days'
  ),
  (
    '00000000-0000-4000-8000-000000037305',
    '00000000-0000-4000-8000-000000037101',
    pg_catalog.decode(pg_catalog.repeat('35', 32), 'hex'),
    'passkey',
    '00000000-0000-4000-8000-000000037201',
    pg_catalog.statement_timestamp() - INTERVAL '210 days',
    pg_catalog.statement_timestamp() - INTERVAL '190 days'
  );

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES (
  'src_' || pg_catalog.repeat('P', 22),
  '00000000-0000-4000-8000-000000037101'
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
    '00000000-0000-4000-8000-000000037401',
    pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
    'Oldest activated connector',
    '7.0.1',
    'linux',
    'x86_64',
    pg_catalog.statement_timestamp() - INTERVAL '222 days'
  ),
  (
    '00000000-0000-4000-8000-000000037402',
    pg_catalog.decode(pg_catalog.repeat('42', 32), 'hex'),
    'Second activated connector',
    '7.0.2',
    'windows',
    'x86_64',
    pg_catalog.statement_timestamp() - INTERVAL '202 days'
  ),
  (
    '00000000-0000-4000-8000-000000037403',
    pg_catalog.decode(pg_catalog.repeat('43', 32), 'hex'),
    'Boundary activated connector',
    '7.0.3',
    'macos',
    'aarch64',
    pg_catalog.statement_timestamp() - INTERVAL '182 days'
  ),
  (
    '00000000-0000-4000-8000-000000037404',
    pg_catalog.decode(pg_catalog.repeat('44', 32), 'hex'),
    'Recent activated connector',
    '7.0.4',
    'linux',
    'aarch64',
    pg_catalog.statement_timestamp() - INTERVAL '181 days'
  ),
  (
    '00000000-0000-4000-8000-000000037405',
    pg_catalog.decode(pg_catalog.repeat('45', 32), 'hex'),
    'Expired approved connector',
    '7.0.5',
    'windows',
    'aarch64',
    pg_catalog.statement_timestamp() - INTERVAL '202 days'
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
    '00000000-0000-4000-8000-000000037501',
    pg_catalog.decode(pg_catalog.repeat('51', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('61', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('71', 32), 'hex'),
    '00000000-0000-4000-8000-000000037401',
    'Oldest activated connector',
    '7.0.1',
    'linux',
    'x86_64',
    pg_catalog.statement_timestamp() - INTERVAL '222 days',
    pg_catalog.statement_timestamp() - INTERVAL '219 days'
  ),
  (
    '00000000-0000-4000-8000-000000037502',
    pg_catalog.decode(pg_catalog.repeat('52', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('62', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('72', 32), 'hex'),
    '00000000-0000-4000-8000-000000037402',
    'Second activated connector',
    '7.0.2',
    'windows',
    'x86_64',
    pg_catalog.statement_timestamp() - INTERVAL '202 days',
    pg_catalog.statement_timestamp() - INTERVAL '199 days'
  ),
  (
    '00000000-0000-4000-8000-000000037503',
    pg_catalog.decode(pg_catalog.repeat('53', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('63', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('73', 32), 'hex'),
    '00000000-0000-4000-8000-000000037403',
    'Boundary activated connector',
    '7.0.3',
    'macos',
    'aarch64',
    pg_catalog.statement_timestamp() - INTERVAL '182 days',
    pg_catalog.statement_timestamp() - INTERVAL '179 days'
  ),
  (
    '00000000-0000-4000-8000-000000037504',
    pg_catalog.decode(pg_catalog.repeat('54', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('64', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('74', 32), 'hex'),
    '00000000-0000-4000-8000-000000037404',
    'Recent activated connector',
    '7.0.4',
    'linux',
    'aarch64',
    pg_catalog.statement_timestamp() - INTERVAL '181 days',
    pg_catalog.statement_timestamp() - INTERVAL '178 days'
  ),
  (
    '00000000-0000-4000-8000-000000037505',
    pg_catalog.decode(pg_catalog.repeat('55', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('65', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('75', 32), 'hex'),
    '00000000-0000-4000-8000-000000037405',
    'Expired approved connector',
    '7.0.5',
    'windows',
    'aarch64',
    pg_catalog.statement_timestamp() - INTERVAL '202 days',
    pg_catalog.statement_timestamp() - INTERVAL '199 days'
  );

UPDATE viberacing_private.pairing_transactions
SET
  state = 'approved',
  approved_profile_id = '00000000-0000-4000-8000-000000037101',
  source_choice = 'existing',
  approved_source_id = 'src_' || pg_catalog.repeat('P', 22),
  approved_by_session_id = CASE pairing_id
    WHEN '00000000-0000-4000-8000-000000037501' THEN '00000000-0000-4000-8000-000000037301'::uuid
    WHEN '00000000-0000-4000-8000-000000037502' THEN '00000000-0000-4000-8000-000000037302'::uuid
    WHEN '00000000-0000-4000-8000-000000037503' THEN '00000000-0000-4000-8000-000000037303'::uuid
    WHEN '00000000-0000-4000-8000-000000037504' THEN '00000000-0000-4000-8000-000000037304'::uuid
    WHEN '00000000-0000-4000-8000-000000037505' THEN '00000000-0000-4000-8000-000000037305'::uuid
  END,
  approved_by_passkey_id = '00000000-0000-4000-8000-000000037201',
  approved_at = CASE pairing_id
    WHEN '00000000-0000-4000-8000-000000037501' THEN pg_catalog.statement_timestamp() - INTERVAL '221 days'
    WHEN '00000000-0000-4000-8000-000000037502' THEN pg_catalog.statement_timestamp() - INTERVAL '201 days'
    WHEN '00000000-0000-4000-8000-000000037503' THEN pg_catalog.statement_timestamp() - INTERVAL '181 days'
    WHEN '00000000-0000-4000-8000-000000037504' THEN pg_catalog.statement_timestamp() - INTERVAL '180 days'
    WHEN '00000000-0000-4000-8000-000000037505' THEN pg_catalog.statement_timestamp() - INTERVAL '200 days'
  END
WHERE pairing_id BETWEEN
  '00000000-0000-4000-8000-000000037501' AND '00000000-0000-4000-8000-000000037505';

UPDATE viberacing_private.device_keys
SET
  state = 'active',
  source_id = 'src_' || pg_catalog.repeat('P', 22),
  device_id = CASE device_key_id
    WHEN '00000000-0000-4000-8000-000000037401' THEN 'dev_' || pg_catalog.repeat('A', 22)
    WHEN '00000000-0000-4000-8000-000000037402' THEN 'dev_' || pg_catalog.repeat('B', 22)
    WHEN '00000000-0000-4000-8000-000000037403' THEN 'dev_' || pg_catalog.repeat('C', 22)
    WHEN '00000000-0000-4000-8000-000000037404' THEN 'dev_' || pg_catalog.repeat('D', 22)
  END,
  activated_at = CASE device_key_id
    WHEN '00000000-0000-4000-8000-000000037401' THEN pg_catalog.statement_timestamp() - INTERVAL '220 days'
    WHEN '00000000-0000-4000-8000-000000037402' THEN pg_catalog.statement_timestamp() - INTERVAL '200 days'
    WHEN '00000000-0000-4000-8000-000000037403' THEN pg_catalog.statement_timestamp() - INTERVAL '180 days'
    WHEN '00000000-0000-4000-8000-000000037404' THEN pg_catalog.statement_timestamp() - INTERVAL '179 days'
  END
WHERE device_key_id BETWEEN
  '00000000-0000-4000-8000-000000037401' AND '00000000-0000-4000-8000-000000037404';

UPDATE viberacing_private.pairing_transactions
SET
  state = 'activated',
  activated_device_id = CASE pairing_id
    WHEN '00000000-0000-4000-8000-000000037501' THEN 'dev_' || pg_catalog.repeat('A', 22)
    WHEN '00000000-0000-4000-8000-000000037502' THEN 'dev_' || pg_catalog.repeat('B', 22)
    WHEN '00000000-0000-4000-8000-000000037503' THEN 'dev_' || pg_catalog.repeat('C', 22)
    WHEN '00000000-0000-4000-8000-000000037504' THEN 'dev_' || pg_catalog.repeat('D', 22)
  END,
  activated_at = CASE pairing_id
    WHEN '00000000-0000-4000-8000-000000037501' THEN pg_catalog.statement_timestamp() - INTERVAL '220 days'
    WHEN '00000000-0000-4000-8000-000000037502' THEN pg_catalog.statement_timestamp() - INTERVAL '200 days'
    WHEN '00000000-0000-4000-8000-000000037503' THEN pg_catalog.statement_timestamp() - INTERVAL '180 days'
    WHEN '00000000-0000-4000-8000-000000037504' THEN pg_catalog.statement_timestamp() - INTERVAL '179 days'
  END
WHERE pairing_id BETWEEN
  '00000000-0000-4000-8000-000000037501' AND '00000000-0000-4000-8000-000000037504';

SELECT pg_temp.expect_integrity_failure(
  $sql$
    UPDATE viberacing_private.pairing_transactions
    SET approved_by_session_id = NULL
    WHERE pairing_id = '00000000-0000-4000-8000-000000037503'
  $sql$,
  'pairing provenance cannot be partially redacted'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    UPDATE viberacing_private.pairing_transactions
    SET
      approved_by_session_id = NULL,
      approved_by_passkey_id = NULL
    WHERE pairing_id = '00000000-0000-4000-8000-000000037505'
  $sql$,
  'approved pairing provenance cannot be redacted before activation'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    UPDATE viberacing_private.pairing_transactions
    SET
      approved_by_session_id = NULL,
      approved_by_passkey_id = NULL,
      approved_at = approved_at + INTERVAL '1 millisecond'
    WHERE pairing_id = '00000000-0000-4000-8000-000000037503'
  $sql$,
  'provenance redaction cannot change the immutable approval time'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(index_record.indpred IS NOT NULL)
      AND pg_catalog.bool_and(index_record.indnkeyatts = 2)
      AND pg_catalog.bool_and(
        pg_catalog.pg_get_indexdef(index_record.indexrelid, 1, false) = 'activated_at'
      )
      AND pg_catalog.bool_and(
        pg_catalog.pg_get_indexdef(index_record.indexrelid, 2, false) = 'pairing_id'
      )
    FROM pg_catalog.pg_index AS index_record
    JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index_record.indexrelid
    JOIN pg_catalog.pg_namespace AS index_namespace
      ON index_namespace.oid = index_relation.relnamespace
    WHERE index_namespace.nspname = 'viberacing_private'
      AND index_relation.relname = 'pairing_transactions_approval_provenance_retention_idx'
  ),
  'pairing provenance has one exact ordered partial retention index'
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT redacted_pairings = 1
    FROM viberacing_api.redact_aged_pairing_approval_provenance(1)
  ),
  'the first batch redacts only the oldest eligible pairing provenance'
);

SET LOCAL ROLE viberacing_owner;
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '00000000-0000-4000-8000-000000037501'
      AND state = 'activated'
      AND approved_profile_id = '00000000-0000-4000-8000-000000037101'
      AND approved_source_id = 'src_' || pg_catalog.repeat('P', 22)
      AND activated_device_id = 'dev_' || pg_catalog.repeat('A', 22)
      AND approved_by_session_id IS NULL
      AND approved_by_passkey_id IS NULL
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '00000000-0000-4000-8000-000000037502'
      AND approved_by_session_id = '00000000-0000-4000-8000-000000037302'
      AND approved_by_passkey_id = '00000000-0000-4000-8000-000000037201'
  ),
  'redaction preserves the activated device binding and follows activation time order'
);

SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.assert_true(
  (
    SELECT redacted_pairings = 2
    FROM viberacing_api.redact_aged_pairing_approval_provenance(10)
  ),
  'the next batch redacts remaining provenance at or beyond 180 days'
);
SELECT pg_temp.assert_true(
  (
    SELECT redacted_pairings = 0
    FROM viberacing_api.redact_aged_pairing_approval_provenance(10)
  ),
  'pairing provenance redaction is idempotent after eligible rows are minimized'
);

SET LOCAL ROLE viberacing_owner;
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '00000000-0000-4000-8000-000000037504'
      AND state = 'activated'
      AND approved_by_session_id = '00000000-0000-4000-8000-000000037304'
      AND approved_by_passkey_id = '00000000-0000-4000-8000-000000037201'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '00000000-0000-4000-8000-000000037505'
      AND state = 'approved'
      AND activated_at IS NULL
      AND approved_by_session_id = '00000000-0000-4000-8000-000000037305'
      AND approved_by_passkey_id = '00000000-0000-4000-8000-000000037201'
  ),
  'recent activated and non-activated approval provenance remains untouched'
);

SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.assert_true(
  (
    SELECT deleted_sessions = 3
    FROM viberacing_api.cleanup_expired_sessions(10)
  ),
  'existing session cleanup can remove only the newly unreferenced expired sessions'
);

SET LOCAL ROLE viberacing_owner;
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM viberacing_private.sessions
    WHERE session_id IN (
      '00000000-0000-4000-8000-000000037301',
      '00000000-0000-4000-8000-000000037302',
      '00000000-0000-4000-8000-000000037303'
    )
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.sessions
    WHERE session_id IN (
      '00000000-0000-4000-8000-000000037304',
      '00000000-0000-4000-8000-000000037305'
    )
    GROUP BY profile_id
    HAVING pg_catalog.count(*) = 2
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.passkeys
    WHERE passkey_id = '00000000-0000-4000-8000-000000037201'
      AND state = 'active'
  ),
  'redaction releases only eligible session references and never deletes the passkey'
);

SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.redact_aged_pairing_approval_provenance(NULL)$sql$,
  'a null pairing provenance batch fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.redact_aged_pairing_approval_provenance(0)$sql$,
  'a zero pairing provenance batch fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.redact_aged_pairing_approval_provenance(1001)$sql$,
  'an oversized pairing provenance batch fails closed'
);

SET LOCAL ROLE viberacing_web;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.redact_aged_pairing_approval_provenance(1)$sql$,
  'Web cannot redact pairing approval provenance'
);
SET LOCAL ROLE viberacing_ingest;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.redact_aged_pairing_approval_provenance(1)$sql$,
  'Ingest cannot redact pairing approval provenance'
);
SET LOCAL ROLE viberacing_admin;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.redact_aged_pairing_approval_provenance(1)$sql$,
  'Admin cannot redact pairing approval provenance'
);

SET LOCAL ROLE viberacing_owner;
DELETE FROM viberacing_private.maintenance_locks
WHERE capability = 'auth_retention_cleanup';
SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.redact_aged_pairing_approval_provenance(1)$sql$,
  'a missing authentication mutex fails provenance redaction closed'
);

SET LOCAL ROLE viberacing_owner;
INSERT INTO viberacing_private.maintenance_locks (capability)
VALUES ('auth_retention_cleanup');
DELETE FROM viberacing_private.maintenance_locks
WHERE capability = 'pairing_retention_cleanup';
SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.redact_aged_pairing_approval_provenance(1)$sql$,
  'a missing pairing mutex fails provenance redaction closed'
);

ROLLBACK;
