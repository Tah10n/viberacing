\set ON_ERROR_STOP on

-- cspell:ignore indexdef indexrelid relname indpred indnkeyatts

-- Deterministic synthetic evidence for bounded revoked-device history cleanup. The transaction is
-- rolled back and does not imply scheduling, backup purge, or deletion of active/raw authority.

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
  '00000000-0000-4000-8000-000000040101',
  900000000000040101,
  'revoked-device-test',
  'active'
);

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES (
  'src_' || pg_catalog.repeat('D', 22),
  '00000000-0000-4000-8000-000000040101'
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
  '00000000-0000-4000-8000-000000040501',
  '00000000-0000-4000-8000-000000040101',
  pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('42', 64), 'hex'),
  'Revoked device retention passkey',
  pg_catalog.statement_timestamp() - INTERVAL '250 days'
);

INSERT INTO viberacing_private.sessions (
  session_id,
  profile_id,
  verifier_digest,
  state,
  created_at,
  expires_at,
  authentication_kind,
  authenticated_by_passkey_id
)
VALUES (
  '00000000-0000-4000-8000-000000040601',
  '00000000-0000-4000-8000-000000040101',
  pg_catalog.decode(pg_catalog.repeat('43', 32), 'hex'),
  'active',
  pg_catalog.statement_timestamp() - INTERVAL '250 days',
  pg_catalog.statement_timestamp() + INTERVAL '1 day',
  'passkey',
  '00000000-0000-4000-8000-000000040501'
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
SELECT
  ('00000000-0000-4000-8000-000000040' || pg_catalog.lpad((200 + item)::text, 3, '0'))::uuid,
  pg_catalog.decode(pg_catalog.lpad(pg_catalog.to_hex(40200 + item), 64, '0'), 'hex'),
  'Revoked device retention ' || item,
  '10.0.' || item,
  'linux',
  'x86_64',
  pg_catalog.statement_timestamp() - INTERVAL '240 days'
FROM pg_catalog.generate_series(1, 10) AS generated_item(item);

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
SELECT
  ('00000000-0000-4000-8000-000000040' || pg_catalog.lpad((300 + item)::text, 3, '0'))::uuid,
  pg_catalog.decode(pg_catalog.lpad(pg_catalog.to_hex(40300 + item), 64, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad(pg_catalog.to_hex(40400 + item), 64, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad(pg_catalog.to_hex(40500 + item), 64, '0'), 'hex'),
  ('00000000-0000-4000-8000-000000040' || pg_catalog.lpad((200 + item)::text, 3, '0'))::uuid,
  'Revoked device retention ' || item,
  '10.0.' || item,
  'linux',
  'x86_64',
  pg_catalog.statement_timestamp() - INTERVAL '240 days',
  pg_catalog.statement_timestamp() - INTERVAL '220 days'
FROM pg_catalog.generate_series(1, 10) AS generated_item(item);

UPDATE viberacing_private.pairing_transactions
SET
  state = 'approved',
  approved_profile_id = '00000000-0000-4000-8000-000000040101',
  source_choice = 'existing',
  approved_source_id = 'src_' || pg_catalog.repeat('D', 22),
  approved_by_session_id = '00000000-0000-4000-8000-000000040601',
  approved_by_passkey_id = '00000000-0000-4000-8000-000000040501',
  approved_at = pg_catalog.statement_timestamp() - INTERVAL '235 days'
WHERE pairing_id BETWEEN
  '00000000-0000-4000-8000-000000040301' AND '00000000-0000-4000-8000-000000040310';

UPDATE viberacing_private.device_keys AS device_record
SET
  state = 'active',
  source_id = 'src_' || pg_catalog.repeat('D', 22),
  device_id = 'dev_' || pg_catalog.lpad(device_number.item::text, 22, '0'),
  activated_at = pg_catalog.statement_timestamp() - INTERVAL '230 days'
FROM pg_catalog.generate_series(1, 10) AS device_number(item)
WHERE device_record.device_key_id = (
  '00000000-0000-4000-8000-000000040'
  || pg_catalog.lpad((200 + device_number.item)::text, 3, '0')
)::uuid;

UPDATE viberacing_private.pairing_transactions AS pairing_record
SET
  state = 'activated',
  activated_device_id = 'dev_' || pg_catalog.lpad(pairing_number.item::text, 22, '0'),
  activated_at = pg_catalog.statement_timestamp() - INTERVAL '230 days'
FROM pg_catalog.generate_series(1, 10) AS pairing_number(item)
WHERE pairing_record.pairing_id = (
  '00000000-0000-4000-8000-000000040'
  || pg_catalog.lpad((300 + pairing_number.item)::text, 3, '0')
)::uuid;

UPDATE viberacing_private.device_keys
SET
  state = 'revoked',
  revoked_at = pg_catalog.statement_timestamp() - (
    CASE device_key_id
      WHEN '00000000-0000-4000-8000-000000040201' THEN 220
      WHEN '00000000-0000-4000-8000-000000040202' THEN 200
      WHEN '00000000-0000-4000-8000-000000040203' THEN 180
      WHEN '00000000-0000-4000-8000-000000040204' THEN 179
      ELSE 200
    END
  ) * INTERVAL '1 day'
WHERE device_key_id IN (
  '00000000-0000-4000-8000-000000040201',
  '00000000-0000-4000-8000-000000040202',
  '00000000-0000-4000-8000-000000040203',
  '00000000-0000-4000-8000-000000040204',
  '00000000-0000-4000-8000-000000040206',
  '00000000-0000-4000-8000-000000040207',
  '00000000-0000-4000-8000-000000040208',
  '00000000-0000-4000-8000-000000040209',
  '00000000-0000-4000-8000-000000040210'
);

UPDATE viberacing_private.pairing_transactions
SET
  approved_by_session_id = NULL,
  approved_by_passkey_id = NULL
WHERE pairing_id IN (
  '00000000-0000-4000-8000-000000040301',
  '00000000-0000-4000-8000-000000040302',
  '00000000-0000-4000-8000-000000040303',
  '00000000-0000-4000-8000-000000040304',
  '00000000-0000-4000-8000-000000040305',
  '00000000-0000-4000-8000-000000040307',
  '00000000-0000-4000-8000-000000040308',
  '00000000-0000-4000-8000-000000040309'
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
  authorized_pairing_id,
  authorized_source_choice,
  authorized_source_id
)
VALUES (
  '00000000-0000-4000-8000-000000040401',
  '00000000-0000-4000-8000-000000040101',
  '00000000-0000-4000-8000-000000040601',
  'pairing_approval',
  pg_catalog.decode(pg_catalog.repeat('44', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('45', 32), 'hex'),
  pg_catalog.statement_timestamp() - INTERVAL '200 days',
  pg_catalog.statement_timestamp() - INTERVAL '199 days',
  '00000000-0000-4000-8000-000000040307',
  'existing',
  'src_' || pg_catalog.repeat('D', 22)
);

INSERT INTO viberacing_private.device_nonces (
  device_key_id,
  nonce_digest,
  received_at,
  expires_at
)
VALUES (
  '00000000-0000-4000-8000-000000040208',
  pg_catalog.decode(pg_catalog.repeat('46', 32), 'hex'),
  pg_catalog.statement_timestamp() - INTERVAL '200 days',
  pg_catalog.statement_timestamp() - INTERVAL '199 days'
);

INSERT INTO viberacing_private.usage_snapshots (
  usage_snapshot_id,
  device_key_id,
  device_id,
  source_id,
  sync_id,
  observed_at,
  connector_version,
  codex_version,
  body_digest,
  signature,
  nonce_digest,
  outcome,
  quarantine_reason,
  entry_count,
  received_at,
  retention_expires_at
)
VALUES (
  '00000000-0000-4000-8000-000000040701',
  '00000000-0000-4000-8000-000000040209',
  'dev_' || pg_catalog.lpad('9', 22, '0'),
  'src_' || pg_catalog.repeat('D', 22),
  'syn_' || pg_catalog.repeat('D', 22),
  pg_catalog.statement_timestamp() - INTERVAL '200 days',
  '10.0.9',
  '0.144.5',
  pg_catalog.decode(pg_catalog.repeat('47', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('48', 64), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('49', 32), 'hex'),
  'accepted',
  NULL,
  1,
  pg_catalog.statement_timestamp() - INTERVAL '200 days',
  pg_catalog.statement_timestamp() - INTERVAL '170 days'
);

INSERT INTO viberacing_private.usage_snapshot_entries (
  usage_snapshot_id,
  codex_reported_date,
  tokens
)
VALUES (
  '00000000-0000-4000-8000-000000040701',
  DATE '2026-01-01',
  100
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(index_record.indpred IS NOT NULL)
      AND pg_catalog.bool_and(index_record.indnkeyatts = 2)
      AND pg_catalog.bool_and(
        pg_catalog.pg_get_indexdef(index_record.indexrelid, 1, false) = 'revoked_at'
      )
      AND pg_catalog.bool_and(
        pg_catalog.pg_get_indexdef(index_record.indexrelid, 2, false) = 'device_key_id'
      )
    FROM pg_catalog.pg_index AS index_record
    JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index_record.indexrelid
    JOIN pg_catalog.pg_namespace AS index_namespace
      ON index_namespace.oid = index_relation.relnamespace
    WHERE index_namespace.nspname = 'viberacing_private'
      AND index_relation.relname = 'device_keys_revoked_retention_idx'
  ),
  'revoked devices have one ordered partial retention index'
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT deleted_pairings = 1 AND deleted_device_keys = 1
    FROM viberacing_api.cleanup_aged_revoked_devices(1)
  ),
  'the first batch deletes only the oldest fully minimized revoked device history'
);

SET LOCAL ROLE viberacing_owner;
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM viberacing_private.device_keys
    WHERE device_key_id = '00000000-0000-4000-8000-000000040201'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '00000000-0000-4000-8000-000000040301'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.device_keys
    WHERE device_key_id = '00000000-0000-4000-8000-000000040202'
  ),
  'revoked-device cleanup deletes the exact oldest pairing and key together'
);

SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.assert_true(
  (
    SELECT deleted_pairings = 2 AND deleted_device_keys = 2
    FROM viberacing_api.cleanup_aged_revoked_devices(1000)
  ),
  'the next batch deletes remaining cutoff-eligible minimized device history'
);
SELECT pg_temp.assert_true(
  (
    SELECT deleted_pairings = 0 AND deleted_device_keys = 0
    FROM viberacing_api.cleanup_aged_revoked_devices(1000)
  ),
  'revoked-device cleanup is idempotent after eligible history is removed'
);

SET LOCAL ROLE viberacing_owner;
SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 7
    FROM viberacing_private.device_keys
    WHERE device_key_id BETWEEN
      '00000000-0000-4000-8000-000000040204'
      AND '00000000-0000-4000-8000-000000040210'
  )
  AND (
    SELECT pg_catalog.count(*) = 7
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id BETWEEN
      '00000000-0000-4000-8000-000000040304'
      AND '00000000-0000-4000-8000-000000040310'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.device_keys
    WHERE device_key_id = '00000000-0000-4000-8000-000000040204'
      AND state = 'revoked'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.device_keys
    WHERE device_key_id = '00000000-0000-4000-8000-000000040205'
      AND state = 'active'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '00000000-0000-4000-8000-000000040306'
      AND approved_by_session_id = '00000000-0000-4000-8000-000000040601'
      AND approved_by_passkey_id = '00000000-0000-4000-8000-000000040501'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.auth_challenges
    WHERE authorized_pairing_id = '00000000-0000-4000-8000-000000040307'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.device_nonces
    WHERE device_key_id = '00000000-0000-4000-8000-000000040208'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.usage_snapshots
    WHERE device_key_id = '00000000-0000-4000-8000-000000040209'
  ),
  'recent, active, provenance, challenge, nonce, and raw-snapshot history remains intact'
);

UPDATE viberacing_private.pairing_transactions
SET
  approved_by_session_id = NULL,
  approved_by_passkey_id = NULL
WHERE pairing_id = '00000000-0000-4000-8000-000000040310';

CREATE FUNCTION pg_temp.skip_revoked_device_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.device_key_id = '00000000-0000-4000-8000-000000040210' THEN
    RETURN NULL;
  END IF;
  RETURN OLD;
END
$function$;

CREATE TRIGGER test_skip_revoked_device_delete
BEFORE DELETE ON viberacing_private.device_keys
FOR EACH ROW
EXECUTE FUNCTION pg_temp.skip_revoked_device_delete();

SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_aged_revoked_devices(1)$sql$,
  'a non-exact device delete rolls back its pairing delete'
);

SET LOCAL ROLE viberacing_owner;
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM viberacing_private.device_keys
    WHERE device_key_id = '00000000-0000-4000-8000-000000040210'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '00000000-0000-4000-8000-000000040310'
  ),
  'revoked-device cleanup rolls back both rows when paired deletion is not exact'
);

SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_aged_revoked_devices(NULL)$sql$,
  'a null revoked-device batch fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_aged_revoked_devices(0)$sql$,
  'a zero revoked-device batch fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_aged_revoked_devices(1001)$sql$,
  'an oversized revoked-device batch fails closed'
);

SET LOCAL ROLE viberacing_web;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_aged_revoked_devices(1)$sql$,
  'Web cannot delete revoked device history'
);
SET LOCAL ROLE viberacing_ingest;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_aged_revoked_devices(1)$sql$,
  'Ingest cannot delete revoked device history'
);
SET LOCAL ROLE viberacing_admin;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_aged_revoked_devices(1)$sql$,
  'Admin cannot delete revoked device history'
);

SET LOCAL ROLE viberacing_owner;
DELETE FROM viberacing_private.maintenance_locks
WHERE capability = 'ingest_retention_cleanup';
SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_aged_revoked_devices(1)$sql$,
  'a missing ingest mutex fails revoked-device cleanup closed'
);

SET LOCAL ROLE viberacing_owner;
INSERT INTO viberacing_private.maintenance_locks (capability)
VALUES ('ingest_retention_cleanup');
DELETE FROM viberacing_private.maintenance_locks
WHERE capability = 'pairing_retention_cleanup';
SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_aged_revoked_devices(1)$sql$,
  'a missing pairing mutex fails revoked-device cleanup closed'
);

ROLLBACK;
