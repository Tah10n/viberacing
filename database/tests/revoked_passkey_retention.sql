\set ON_ERROR_STOP on

-- cspell:ignore indexdef indexrelid relname indpred indnkeyatts

-- Deterministic synthetic evidence for bounded revoked-passkey cleanup. The transaction is rolled
-- back and does not imply scheduling, backup purge, or deletion of referenced credential history.

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
  '00000000-0000-4000-8000-000000038101',
  900000000000038101,
  'revoked-passkey-test',
  'active'
);

INSERT INTO viberacing_private.passkeys (
  passkey_id,
  profile_id,
  credential_id,
  cose_public_key,
  label,
  state,
  created_at,
  revoked_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000038201',
    '00000000-0000-4000-8000-000000038101',
    pg_catalog.decode(pg_catalog.lpad('38201', 32, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('38211', 64, '0'), 'hex'),
    'Oldest revoked passkey',
    'revoked',
    pg_catalog.statement_timestamp() - INTERVAL '230 days',
    pg_catalog.statement_timestamp() - INTERVAL '220 days'
  ),
  (
    '00000000-0000-4000-8000-000000038202',
    '00000000-0000-4000-8000-000000038101',
    pg_catalog.decode(pg_catalog.lpad('38202', 32, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('38212', 64, '0'), 'hex'),
    'Second revoked passkey',
    'revoked',
    pg_catalog.statement_timestamp() - INTERVAL '210 days',
    pg_catalog.statement_timestamp() - INTERVAL '200 days'
  ),
  (
    '00000000-0000-4000-8000-000000038203',
    '00000000-0000-4000-8000-000000038101',
    pg_catalog.decode(pg_catalog.lpad('38203', 32, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('38213', 64, '0'), 'hex'),
    'Boundary revoked passkey',
    'revoked',
    pg_catalog.statement_timestamp() - INTERVAL '190 days',
    pg_catalog.statement_timestamp() - INTERVAL '180 days'
  ),
  (
    '00000000-0000-4000-8000-000000038204',
    '00000000-0000-4000-8000-000000038101',
    pg_catalog.decode(pg_catalog.lpad('38204', 32, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('38214', 64, '0'), 'hex'),
    'Recent revoked passkey',
    'revoked',
    pg_catalog.statement_timestamp() - INTERVAL '189 days',
    pg_catalog.statement_timestamp() - INTERVAL '179 days'
  ),
  (
    '00000000-0000-4000-8000-000000038205',
    '00000000-0000-4000-8000-000000038101',
    pg_catalog.decode(pg_catalog.lpad('38205', 32, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('38215', 64, '0'), 'hex'),
    'Session referenced passkey',
    'active',
    pg_catalog.statement_timestamp() - INTERVAL '210 days',
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000038206',
    '00000000-0000-4000-8000-000000038101',
    pg_catalog.decode(pg_catalog.lpad('38206', 32, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('38216', 64, '0'), 'hex'),
    'Verification referenced passkey',
    'active',
    pg_catalog.statement_timestamp() - INTERVAL '210 days',
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000038207',
    '00000000-0000-4000-8000-000000038101',
    pg_catalog.decode(pg_catalog.lpad('38207', 32, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('38217', 64, '0'), 'hex'),
    'Action referenced passkey',
    'active',
    pg_catalog.statement_timestamp() - INTERVAL '210 days',
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000038208',
    '00000000-0000-4000-8000-000000038101',
    pg_catalog.decode(pg_catalog.lpad('38208', 32, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('38218', 64, '0'), 'hex'),
    'Pairing referenced passkey',
    'active',
    pg_catalog.statement_timestamp() - INTERVAL '210 days',
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000038209',
    '00000000-0000-4000-8000-000000038101',
    pg_catalog.decode(pg_catalog.lpad('38209', 32, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('38219', 64, '0'), 'hex'),
    'Current active passkey',
    'active',
    pg_catalog.statement_timestamp() - INTERVAL '230 days',
    NULL
  );

INSERT INTO viberacing_private.sessions (
  session_id,
  profile_id,
  verifier_digest,
  state,
  created_at,
  expires_at,
  ended_at,
  authentication_kind,
  authenticated_by_passkey_id
)
VALUES
  (
    '00000000-0000-4000-8000-000000038301',
    '00000000-0000-4000-8000-000000038101',
    pg_catalog.decode(pg_catalog.lpad('38301', 64, '0'), 'hex'),
    'revoked',
    pg_catalog.statement_timestamp() - INTERVAL '210 days',
    pg_catalog.statement_timestamp() - INTERVAL '205 days',
    pg_catalog.statement_timestamp() - INTERVAL '200 days',
    'passkey',
    '00000000-0000-4000-8000-000000038205'
  ),
  (
    '00000000-0000-4000-8000-000000038302',
    '00000000-0000-4000-8000-000000038101',
    pg_catalog.decode(pg_catalog.lpad('38302', 64, '0'), 'hex'),
    'active',
    pg_catalog.statement_timestamp() - INTERVAL '1 day',
    pg_catalog.statement_timestamp() + INTERVAL '1 day',
    NULL,
    'passkey',
    '00000000-0000-4000-8000-000000038209'
  ),
  (
    '00000000-0000-4000-8000-000000038303',
    '00000000-0000-4000-8000-000000038101',
    pg_catalog.decode(pg_catalog.lpad('38303', 64, '0'), 'hex'),
    'active',
    pg_catalog.statement_timestamp() - INTERVAL '1 day',
    pg_catalog.statement_timestamp() + INTERVAL '1 day',
    NULL,
    'passkey',
    '00000000-0000-4000-8000-000000038209'
  );

INSERT INTO viberacing_private.auth_challenges (
  challenge_id,
  profile_id,
  session_id,
  purpose,
  challenge_digest,
  context_digest,
  created_at,
  expires_at,
  consumed_at,
  verified_by_passkey_id,
  authorized_passkey_action,
  authorized_passkey_id
)
VALUES
  (
    '00000000-0000-4000-8000-000000038401',
    '00000000-0000-4000-8000-000000038101',
    '00000000-0000-4000-8000-000000038302',
    'recovery_change',
    pg_catalog.decode(pg_catalog.lpad('38401', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('38411', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp() - INTERVAL '200 days',
    pg_catalog.statement_timestamp() - INTERVAL '199 days',
    pg_catalog.statement_timestamp() - INTERVAL '199 days 12 hours',
    '00000000-0000-4000-8000-000000038206',
    NULL,
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000038402',
    '00000000-0000-4000-8000-000000038101',
    '00000000-0000-4000-8000-000000038302',
    'passkey_change',
    pg_catalog.decode(pg_catalog.lpad('38402', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('38412', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp() - INTERVAL '200 days',
    pg_catalog.statement_timestamp() - INTERVAL '199 days',
    pg_catalog.statement_timestamp() - INTERVAL '199 days 12 hours',
    '00000000-0000-4000-8000-000000038209',
    'revoke',
    '00000000-0000-4000-8000-000000038207'
  );

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES (
  'src_' || pg_catalog.repeat('R', 22),
  '00000000-0000-4000-8000-000000038101'
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
  '00000000-0000-4000-8000-000000038501',
  pg_catalog.decode(pg_catalog.lpad('38501', 64, '0'), 'hex'),
  'Retained pairing device',
  '10.0.0',
  'linux',
  'x86_64',
  pg_catalog.statement_timestamp() - INTERVAL '205 days'
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
  '00000000-0000-4000-8000-000000038601',
  pg_catalog.decode(pg_catalog.lpad('38601', 64, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('38611', 64, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('38621', 64, '0'), 'hex'),
  '00000000-0000-4000-8000-000000038501',
  'Retained pairing device',
  '10.0.0',
  'linux',
  'x86_64',
  pg_catalog.statement_timestamp() - INTERVAL '205 days',
  pg_catalog.statement_timestamp() - INTERVAL '202 days'
);

UPDATE viberacing_private.pairing_transactions
SET
  state = 'approved',
  approved_profile_id = '00000000-0000-4000-8000-000000038101',
  source_choice = 'existing',
  approved_source_id = 'src_' || pg_catalog.repeat('R', 22),
  approved_by_session_id = '00000000-0000-4000-8000-000000038303',
  approved_by_passkey_id = '00000000-0000-4000-8000-000000038208',
  approved_at = pg_catalog.statement_timestamp() - INTERVAL '204 days'
WHERE pairing_id = '00000000-0000-4000-8000-000000038601';

UPDATE viberacing_private.device_keys
SET
  state = 'active',
  source_id = 'src_' || pg_catalog.repeat('R', 22),
  device_id = 'dev_' || pg_catalog.repeat('R', 22),
  activated_at = pg_catalog.statement_timestamp() - INTERVAL '203 days'
WHERE device_key_id = '00000000-0000-4000-8000-000000038501';

UPDATE viberacing_private.pairing_transactions
SET
  state = 'activated',
  activated_device_id = 'dev_' || pg_catalog.repeat('R', 22),
  activated_at = pg_catalog.statement_timestamp() - INTERVAL '203 days'
WHERE pairing_id = '00000000-0000-4000-8000-000000038601';

UPDATE viberacing_private.passkeys
SET
  state = 'revoked',
  revoked_at = pg_catalog.statement_timestamp() - INTERVAL '200 days'
WHERE passkey_id BETWEEN
  '00000000-0000-4000-8000-000000038205' AND '00000000-0000-4000-8000-000000038208';

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(index_record.indpred IS NOT NULL)
      AND pg_catalog.bool_and(index_record.indnkeyatts = 2)
      AND pg_catalog.bool_and(
        pg_catalog.pg_get_indexdef(index_record.indexrelid, 1, false) = 'revoked_at'
      )
      AND pg_catalog.bool_and(
        pg_catalog.pg_get_indexdef(index_record.indexrelid, 2, false) = 'passkey_id'
      )
    FROM pg_catalog.pg_index AS index_record
    JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index_record.indexrelid
    JOIN pg_catalog.pg_namespace AS index_namespace
      ON index_namespace.oid = index_relation.relnamespace
    WHERE index_namespace.nspname = 'viberacing_private'
      AND index_relation.relname = 'passkeys_revoked_retention_idx'
  ),
  'revoked passkeys have one ordered partial retention index'
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT deleted_passkeys = 1
    FROM viberacing_api.cleanup_aged_revoked_passkeys(1)
  ),
  'the first batch deletes only the oldest eligible revoked passkey'
);

SET LOCAL ROLE viberacing_owner;
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM viberacing_private.passkeys
    WHERE passkey_id = '00000000-0000-4000-8000-000000038201'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.passkeys
    WHERE passkey_id = '00000000-0000-4000-8000-000000038202'
  ),
  'revoked-passkey cleanup follows revocation time order'
);

SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.assert_true(
  (
    SELECT deleted_passkeys = 2
    FROM viberacing_api.cleanup_aged_revoked_passkeys(1000)
  ),
  'the next batch deletes remaining unreferenced passkeys at or beyond 180 days'
);
SELECT pg_temp.assert_true(
  (
    SELECT deleted_passkeys = 0
    FROM viberacing_api.cleanup_aged_revoked_passkeys(1000)
  ),
  'revoked-passkey cleanup is idempotent after eligible rows are removed'
);

SET LOCAL ROLE viberacing_owner;
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM viberacing_private.passkeys
    WHERE passkey_id = '00000000-0000-4000-8000-000000038204'
      AND state = 'revoked'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.passkeys
    WHERE passkey_id = '00000000-0000-4000-8000-000000038205'
      AND state = 'revoked'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.passkeys
    WHERE passkey_id = '00000000-0000-4000-8000-000000038206'
      AND state = 'revoked'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.passkeys
    WHERE passkey_id = '00000000-0000-4000-8000-000000038207'
      AND state = 'revoked'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.passkeys
    WHERE passkey_id = '00000000-0000-4000-8000-000000038208'
      AND state = 'revoked'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.passkeys
    WHERE passkey_id = '00000000-0000-4000-8000-000000038209'
      AND state = 'active'
  ),
  'recent, referenced, and active passkeys remain intact'
);

SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_aged_revoked_passkeys(NULL)$sql$,
  'a null revoked-passkey batch fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_aged_revoked_passkeys(0)$sql$,
  'a zero revoked-passkey batch fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_aged_revoked_passkeys(1001)$sql$,
  'an oversized revoked-passkey batch fails closed'
);

SET LOCAL ROLE viberacing_web;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_aged_revoked_passkeys(1)$sql$,
  'Web cannot delete revoked passkeys'
);
SET LOCAL ROLE viberacing_ingest;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_aged_revoked_passkeys(1)$sql$,
  'Ingest cannot delete revoked passkeys'
);
SET LOCAL ROLE viberacing_admin;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_aged_revoked_passkeys(1)$sql$,
  'Admin cannot delete revoked passkeys'
);

SET LOCAL ROLE viberacing_owner;
DELETE FROM viberacing_private.maintenance_locks
WHERE capability = 'auth_retention_cleanup';
SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_aged_revoked_passkeys(1)$sql$,
  'a missing authentication mutex fails revoked-passkey cleanup closed'
);

SET LOCAL ROLE viberacing_owner;
INSERT INTO viberacing_private.maintenance_locks (capability)
VALUES ('auth_retention_cleanup');
DELETE FROM viberacing_private.maintenance_locks
WHERE capability = 'pairing_retention_cleanup';
SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_aged_revoked_passkeys(1)$sql$,
  'a missing pairing mutex fails revoked-passkey cleanup closed'
);

ROLLBACK;
