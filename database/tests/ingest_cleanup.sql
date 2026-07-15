\set ON_ERROR_STOP on

-- Every value below is a deterministic synthetic fixture. The transaction is always rolled back.
-- This file exercises only the reviewed Jobs procedure boundary; it does not imply a scheduler.

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

SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (profile_id, github_user_id, handle, state)
VALUES (
  '00000000-0000-4000-8000-000000012101',
  900000000000012101,
  'cleanup-static',
  'active'
);

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES (
  'src_' || pg_catalog.repeat('R', 22),
  '00000000-0000-4000-8000-000000012101'
);

INSERT INTO viberacing_private.device_keys (
  device_key_id,
  device_id,
  source_id,
  public_key,
  label,
  connector_version,
  os_family,
  architecture,
  state,
  activated_at
)
VALUES (
  '00000000-0000-4000-8000-000000012401',
  'dev_' || pg_catalog.repeat('R', 22),
  'src_' || pg_catalog.repeat('R', 22),
  pg_catalog.decode(pg_catalog.lpad('12401', 64, '0'), 'hex'),
  'Static cleanup connector',
  '1.2.3',
  'linux',
  'x86_64',
  'active',
  pg_catalog.statement_timestamp()
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
VALUES
  (
    '00000000-0000-4000-8000-000000012501',
    '00000000-0000-4000-8000-000000012401',
    'dev_' || pg_catalog.repeat('R', 22),
    'src_' || pg_catalog.repeat('R', 22),
    'syn_' || pg_catalog.repeat('1', 22),
    pg_catalog.statement_timestamp() - INTERVAL '33 days',
    '1.2.3',
    '4.5.6',
    pg_catalog.decode(pg_catalog.lpad('12501', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('22501', 128, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('32501', 64, '0'), 'hex'),
    'accepted',
    NULL,
    1,
    pg_catalog.statement_timestamp() - INTERVAL '33 days',
    pg_catalog.statement_timestamp() - INTERVAL '3 days'
  ),
  (
    '00000000-0000-4000-8000-000000012502',
    '00000000-0000-4000-8000-000000012401',
    'dev_' || pg_catalog.repeat('R', 22),
    'src_' || pg_catalog.repeat('R', 22),
    'syn_' || pg_catalog.repeat('2', 22),
    pg_catalog.statement_timestamp() - INTERVAL '32 days',
    '1.2.3',
    '4.5.6',
    pg_catalog.decode(pg_catalog.lpad('12502', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('22502', 128, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('32502', 64, '0'), 'hex'),
    'accepted',
    NULL,
    1,
    pg_catalog.statement_timestamp() - INTERVAL '32 days',
    pg_catalog.statement_timestamp() - INTERVAL '2 days'
  ),
  (
    '00000000-0000-4000-8000-000000012503',
    '00000000-0000-4000-8000-000000012401',
    'dev_' || pg_catalog.repeat('R', 22),
    'src_' || pg_catalog.repeat('R', 22),
    'syn_' || pg_catalog.repeat('3', 22),
    pg_catalog.statement_timestamp(),
    '1.2.3',
    '4.5.6',
    pg_catalog.decode(pg_catalog.lpad('12503', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('22503', 128, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('32503', 64, '0'), 'hex'),
    'accepted',
    NULL,
    1,
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp() + INTERVAL '30 days'
  );

INSERT INTO viberacing_private.usage_snapshot_entries (
  usage_snapshot_id,
  codex_reported_date,
  tokens
)
VALUES
  ('00000000-0000-4000-8000-000000012501', '2026-07-13', 100),
  ('00000000-0000-4000-8000-000000012502', '2026-07-14', 200),
  ('00000000-0000-4000-8000-000000012503', '2026-07-15', 300);

INSERT INTO viberacing_private.source_day_values (
  source_id,
  codex_reported_date,
  tokens,
  accepted_snapshot_id,
  accepted_sync_id,
  accepted_device_id,
  first_accepted_at,
  last_accepted_at
)
VALUES
  (
    'src_' || pg_catalog.repeat('R', 22),
    '2026-07-13',
    100,
    '00000000-0000-4000-8000-000000012501',
    'syn_' || pg_catalog.repeat('1', 22),
    'dev_' || pg_catalog.repeat('R', 22),
    pg_catalog.statement_timestamp() - INTERVAL '33 days',
    pg_catalog.statement_timestamp() - INTERVAL '33 days'
  ),
  (
    'src_' || pg_catalog.repeat('R', 22),
    '2026-07-14',
    200,
    '00000000-0000-4000-8000-000000012502',
    'syn_' || pg_catalog.repeat('2', 22),
    'dev_' || pg_catalog.repeat('R', 22),
    pg_catalog.statement_timestamp() - INTERVAL '32 days',
    pg_catalog.statement_timestamp() - INTERVAL '32 days'
  ),
  (
    'src_' || pg_catalog.repeat('R', 22),
    '2026-07-15',
    300,
    '00000000-0000-4000-8000-000000012503',
    'syn_' || pg_catalog.repeat('3', 22),
    'dev_' || pg_catalog.repeat('R', 22),
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp()
  );

INSERT INTO viberacing_private.device_nonces (
  device_key_id,
  nonce_digest,
  received_at,
  expires_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000012401',
    pg_catalog.decode(pg_catalog.lpad('42501', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp() - INTERVAL '1 hour',
    pg_catalog.statement_timestamp() - INTERVAL '30 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000012401',
    pg_catalog.decode(pg_catalog.lpad('42502', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp() - INTERVAL '45 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '15 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000012401',
    pg_catalog.decode(pg_catalog.lpad('42503', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp() + INTERVAL '15 minutes'
  );

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT deleted_nonces = 1 AND deleted_snapshots = 1
    FROM viberacing_api.cleanup_expired_ingest_state(1)
  ),
  'the first bounded cleanup removes exactly one expired nonce and snapshot'
);

SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM viberacing_private.usage_snapshots
    WHERE usage_snapshot_id = '00000000-0000-4000-8000-000000012501'
  ),
  'the oldest expired snapshot is selected first'
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT deleted_nonces = 1 AND deleted_snapshots = 1
    FROM viberacing_api.cleanup_expired_ingest_state(1)
  ),
  'a second bounded cleanup removes the remaining expired rows'
);

SELECT pg_temp.assert_true(
  (
    SELECT deleted_nonces = 0 AND deleted_snapshots = 0
    FROM viberacing_api.cleanup_expired_ingest_state(1)
  ),
  'cleanup is idempotent after no expired rows remain'
);

SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
    FROM viberacing_private.device_nonces
    WHERE device_key_id = '00000000-0000-4000-8000-000000012401'
  )
  AND (
    SELECT pg_catalog.count(*) = 1
    FROM viberacing_private.usage_snapshots
    WHERE device_key_id = '00000000-0000-4000-8000-000000012401'
  )
  AND (
    SELECT pg_catalog.count(*) = 1
    FROM viberacing_private.usage_snapshot_entries
    WHERE usage_snapshot_id = '00000000-0000-4000-8000-000000012503'
  ),
  'live nonce, snapshot, and entry remain after cleanup'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 2
    FROM viberacing_private.source_day_values
    WHERE source_id = 'src_' || pg_catalog.repeat('R', 22)
      AND accepted_snapshot_id IS NULL
  )
  AND (
    SELECT accepted_snapshot_id = '00000000-0000-4000-8000-000000012503'
    FROM viberacing_private.source_day_values
    WHERE source_id = 'src_' || pg_catalog.repeat('R', 22)
      AND codex_reported_date = '2026-07-15'
  ),
  'expired raw provenance is detached while current aggregates and live provenance remain'
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_ingest_state(NULL)$sql$,
  'a null cleanup batch fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_ingest_state(0)$sql$,
  'a zero cleanup batch fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_ingest_state(1001)$sql$,
  'an oversized cleanup batch fails closed'
);

SET LOCAL ROLE viberacing_owner;
DELETE FROM viberacing_private.maintenance_locks
WHERE capability = 'ingest_retention_cleanup';
SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_ingest_state(1)$sql$,
  'a missing private cleanup mutex fails closed'
);

ROLLBACK;
