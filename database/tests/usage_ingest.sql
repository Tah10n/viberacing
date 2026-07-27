\set ON_ERROR_STOP on

-- Every value below is a deterministic synthetic fixture. The transaction is always rolled back.
-- Application-layer canonical-body and Ed25519 verification remain outside this database test;
-- this file exercises the exact procedure boundary that receives their verified result.

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

CREATE FUNCTION pg_temp.expect_integrity_failure(statement text, label text)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  BEGIN
    EXECUTE statement;
    SET CONSTRAINTS ALL IMMEDIATE;
  EXCEPTION
    WHEN integrity_constraint_violation THEN
      RETURN;
  END;

  RAISE EXCEPTION 'expected integrity failure: %', label;
END
$function$;

CREATE FUNCTION pg_temp.submit_fixture(
  p_device_key_id uuid,
  p_device_id text,
  p_source_id text,
  p_usage_snapshot_id uuid,
  p_sync_id text,
  p_observed_at timestamptz,
  p_body_seed text,
  p_signature_seed text,
  p_nonce_seed text,
  p_dates text[],
  p_tokens bigint[]
)
RETURNS TABLE (outcome text, accepted_entries integer)
LANGUAGE sql
AS $function$
  SELECT *
  FROM viberacing_api.submit_usage_sync(
    p_device_key_id,
    p_device_id,
    p_source_id,
    'codex',
    'codex_daily_usage_buckets_v1',
    p_usage_snapshot_id,
    p_sync_id,
    p_observed_at,
    '1.2.3',
    '4.5.6',
    pg_catalog.decode(pg_catalog.lpad(p_body_seed, 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad(p_signature_seed, 128, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad(p_nonce_seed, 64, '0'), 'hex'),
    p_dates,
    p_tokens
  )
$function$;

CREATE FUNCTION pg_temp.submit_usage_fixture(
  p_device_key_id uuid,
  p_device_id text,
  p_source_id text,
  p_provider text,
  p_accounting_revision text,
  p_usage_snapshot_id uuid,
  p_sync_id text,
  p_observed_at timestamptz,
  p_body_seed text,
  p_signature_seed text,
  p_nonce_seed text,
  p_dates text[],
  p_tokens bigint[]
)
RETURNS TABLE (outcome text, accepted_entries integer)
LANGUAGE sql
AS $function$
  SELECT *
  FROM viberacing_api.submit_usage_sync(
    p_device_key_id,
    p_device_id,
    p_source_id,
    p_provider,
    p_accounting_revision,
    p_usage_snapshot_id,
    p_sync_id,
    p_observed_at,
    '0.0.0',
    '0.144.5',
    pg_catalog.decode(pg_catalog.lpad(p_body_seed, 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad(p_signature_seed, 128, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad(p_nonce_seed, 64, '0'), 'hex'),
    p_dates,
    p_tokens
  )
$function$;

CREATE FUNCTION pg_temp.current_week_date(p_day_offset integer)
RETURNS text
LANGUAGE sql
STABLE
AS $function$
  SELECT pg_catalog.to_char(
    pg_catalog.current_setting('viberacing.test_week_start')::date + p_day_offset,
    'YYYY-MM-DD'
  )
$function$;

SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (
  profile_id,
  github_user_id,
  handle,
  state,
  hidden_at,
  deletion_requested_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000010101',
    900000000000010101,
    'ingest-active',
    'active',
    NULL,
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000010102',
    900000000000010102,
    'ingest-hidden',
    'hidden',
    pg_catalog.statement_timestamp(),
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000010103',
    900000000000010103,
    'ingest-deleting',
    'deletion_pending',
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp()
  );

INSERT INTO viberacing_private.codex_sources (source_id, profile_id, state)
VALUES
  (
    'src_' || pg_catalog.repeat('A', 22),
    '00000000-0000-4000-8000-000000010101',
    'active'
  ),
  (
    'src_' || pg_catalog.repeat('P', 22),
    '00000000-0000-4000-8000-000000010101',
    'paused'
  ),
  (
    'src_' || pg_catalog.repeat('Q', 22),
    '00000000-0000-4000-8000-000000010101',
    'quarantined'
  ),
  (
    'src_' || pg_catalog.repeat('H', 22),
    '00000000-0000-4000-8000-000000010102',
    'active'
  ),
  (
    'src_' || pg_catalog.repeat('D', 22),
    '00000000-0000-4000-8000-000000010103',
    'active'
  ),
  (
    'src_' || pg_catalog.repeat('U', 22),
    '00000000-0000-4000-8000-000000010101',
    'active'
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
  activated_at,
  revoked_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000010401',
    'dev_' || pg_catalog.repeat('A', 22),
    'src_' || pg_catalog.repeat('A', 22),
    pg_catalog.decode(pg_catalog.lpad('10401', 64, '0'), 'hex'),
    'Ingest active connector A',
    '1.2.3',
    'linux',
    'x86_64',
    'active',
    pg_catalog.statement_timestamp(),
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000010402',
    'dev_' || pg_catalog.repeat('B', 22),
    'src_' || pg_catalog.repeat('A', 22),
    pg_catalog.decode(pg_catalog.lpad('10402', 64, '0'), 'hex'),
    'Ingest active connector B',
    '1.2.3',
    'linux',
    'aarch64',
    'active',
    pg_catalog.statement_timestamp(),
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000010403',
    'dev_' || pg_catalog.repeat('P', 22),
    'src_' || pg_catalog.repeat('P', 22),
    pg_catalog.decode(pg_catalog.lpad('10403', 64, '0'), 'hex'),
    'Ingest paused-source connector',
    '1.2.3',
    'windows',
    'x86_64',
    'active',
    pg_catalog.statement_timestamp(),
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000010404',
    'dev_' || pg_catalog.repeat('Q', 22),
    'src_' || pg_catalog.repeat('Q', 22),
    pg_catalog.decode(pg_catalog.lpad('10404', 64, '0'), 'hex'),
    'Ingest quarantined-source connector',
    '1.2.3',
    'macos',
    'aarch64',
    'active',
    pg_catalog.statement_timestamp(),
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000010405',
    'dev_' || pg_catalog.repeat('H', 22),
    'src_' || pg_catalog.repeat('H', 22),
    pg_catalog.decode(pg_catalog.lpad('10405', 64, '0'), 'hex'),
    'Ingest hidden-profile connector',
    '1.2.3',
    'linux',
    'x86_64',
    'active',
    pg_catalog.statement_timestamp(),
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000010406',
    'dev_' || pg_catalog.repeat('D', 22),
    'src_' || pg_catalog.repeat('D', 22),
    pg_catalog.decode(pg_catalog.lpad('10406', 64, '0'), 'hex'),
    'Ingest deleting-profile connector',
    '1.2.3',
    'linux',
    'x86_64',
    'active',
    pg_catalog.statement_timestamp(),
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000010407',
    'dev_' || pg_catalog.repeat('R', 22),
    'src_' || pg_catalog.repeat('A', 22),
    pg_catalog.decode(pg_catalog.lpad('10407', 64, '0'), 'hex'),
    'Ingest revoked connector',
    '1.2.3',
    'linux',
    'x86_64',
    'revoked',
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000010408',
    'dev_' || pg_catalog.repeat('U', 22),
    'src_' || pg_catalog.repeat('U', 22),
    pg_catalog.decode(pg_catalog.lpad('10408', 64, '0'), 'hex'),
    'Usage Sync connector',
    '0.0.0',
    'windows',
    'x86_64',
    'active',
    pg_catalog.statement_timestamp(),
    NULL
  );

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 6
      AND pg_catalog.bool_and(provider = 'codex')
      AND pg_catalog.bool_and(accounting_revision = 'codex_daily_usage_buckets_v1')
    FROM viberacing_private.codex_sources
    WHERE source_id IN (
      'src_' || pg_catalog.repeat('A', 22),
      'src_' || pg_catalog.repeat('P', 22),
      'src_' || pg_catalog.repeat('Q', 22),
      'src_' || pg_catalog.repeat('H', 22),
      'src_' || pg_catalog.repeat('D', 22),
      'src_' || pg_catalog.repeat('U', 22)
    )
  ),
  'every source has one closed provider and accounting revision'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    UPDATE viberacing_private.codex_sources
    SET provider = 'other'
    WHERE source_id = 'src_' || pg_catalog.repeat('U', 22)
  $sql$,
  'source provider attribution is immutable'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    UPDATE viberacing_private.codex_sources
    SET accounting_revision = 'other'
    WHERE source_id = 'src_' || pg_catalog.repeat('U', 22)
  $sql$,
  'source accounting revision is immutable'
);

RESET ROLE;
SET LOCAL ROLE viberacing_ingest;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(
        device_key_id = '00000000-0000-4000-8000-000000010401'
        AND source_id = 'src_' || pg_catalog.repeat('A', 22)
        AND public_key = pg_catalog.decode(pg_catalog.lpad('10401', 64, '0'), 'hex')
        AND provider = 'codex'
        AND accounting_revision = 'codex_daily_usage_buckets_v1'
      )
    FROM viberacing_api.read_device_verification_material(
      'dev_' || pg_catalog.repeat('A', 22)
    )
  ),
  'ingest reads only the exact active device verification material'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
    FROM viberacing_api.read_device_verification_material(
      'dev_' || pg_catalog.repeat('H', 22)
    )
  )
  AND (
    SELECT pg_catalog.count(*) = 1
    FROM viberacing_api.read_device_verification_material(
      'dev_' || pg_catalog.repeat('Q', 22)
    )
  ),
  'hidden profiles and quarantined sources retain device verification capability'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 0
    FROM viberacing_api.read_device_verification_material(
      'dev_' || pg_catalog.repeat('P', 22)
    )
  )
  AND (
    SELECT pg_catalog.count(*) = 0
    FROM viberacing_api.read_device_verification_material(
      'dev_' || pg_catalog.repeat('R', 22)
    )
  )
  AND (
    SELECT pg_catalog.count(*) = 0
    FROM viberacing_api.read_device_verification_material(
      'dev_' || pg_catalog.repeat('D', 22)
    )
  )
  AND (
    SELECT pg_catalog.count(*) = 0
    FROM viberacing_api.read_device_verification_material(
      'dev_' || pg_catalog.repeat('Z', 22)
    )
  ),
  'paused, revoked, deleting, and unknown bindings disclose no verification material'
);

SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.read_device_verification_material('bad-device')$sql$,
  'malformed device lookup fails closed'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT * FROM pg_temp.submit_usage_fixture(
      '00000000-0000-4000-8000-000000010408',
      'dev_' || pg_catalog.repeat('U', 22),
      'src_' || pg_catalog.repeat('U', 22),
      'other',
      'codex_daily_usage_buckets_v1',
      '00000000-0000-4000-8000-000000010525',
      'syn_' || pg_catalog.repeat('5', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.transaction_timestamp()),
      '20525', '21525', '22525',
      ARRAY[pg_temp.current_week_date(2)], ARRAY[525]::bigint[]
    )
  $sql$,
  'caller-supplied provider cannot override the source attribution'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT * FROM pg_temp.submit_usage_fixture(
      '00000000-0000-4000-8000-000000010408',
      'dev_' || pg_catalog.repeat('U', 22),
      'src_' || pg_catalog.repeat('U', 22),
      'codex',
      'other',
      '00000000-0000-4000-8000-000000010526',
      'syn_' || pg_catalog.repeat('6', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.transaction_timestamp()),
      '20526', '21526', '22526',
      ARRAY[pg_temp.current_week_date(2)], ARRAY[526]::bigint[]
    )
  $sql$,
  'caller-supplied accounting revision cannot override the source attribution'
);

SELECT pg_temp.assert_true(
  (
    SELECT outcome = 'accepted' AND accepted_entries = 1
    FROM pg_temp.submit_usage_fixture(
      '00000000-0000-4000-8000-000000010408',
      'dev_' || pg_catalog.repeat('U', 22),
      'src_' || pg_catalog.repeat('U', 22),
      'codex',
      'codex_daily_usage_buckets_v1',
      '00000000-0000-4000-8000-000000010524',
      'syn_' || pg_catalog.repeat('4', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.transaction_timestamp()),
      '20524', '21524', '22524',
      ARRAY[pg_temp.current_week_date(2)], ARRAY[524]::bigint[]
    )
  ),
  'provider-attributed Usage Sync is accepted through its separate bounded procedure'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.min(connector_version) = '0.0.0'
      AND pg_catalog.min(codex_version) = '0.144.5'
      AND pg_catalog.min(entry_count) = 1
      AND pg_catalog.min(outcome) = 'accepted'
    FROM viberacing_private.usage_snapshots
    WHERE usage_snapshot_id = '00000000-0000-4000-8000-000000010524'
  )
  AND (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.min(tokens) = 524
      AND pg_catalog.min(codex_reported_date) = pg_temp.current_week_date(2)::date
    FROM viberacing_private.usage_snapshot_entries
    WHERE usage_snapshot_id = '00000000-0000-4000-8000-000000010524'
  )
  AND (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.min(tokens) = 524
    FROM viberacing_private.source_day_values
    WHERE source_id = 'src_' || pg_catalog.repeat('U', 22)
      AND codex_reported_date = pg_temp.current_week_date(2)::date
  ),
  'Usage Sync maps generic client, agent, date, and total fields to the mature storage path'
);

RESET ROLE;
SET LOCAL ROLE viberacing_ingest;

SELECT pg_temp.assert_true(
  (
    SELECT outcome = 'accepted' AND accepted_entries = 2
    FROM pg_temp.submit_fixture(
      '00000000-0000-4000-8000-000000010401',
      'dev_' || pg_catalog.repeat('A', 22),
      'src_' || pg_catalog.repeat('A', 22),
      '00000000-0000-4000-8000-000000010501',
      'syn_' || pg_catalog.repeat('A', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.transaction_timestamp()),
      '10501',
      '11501',
      '12501',
      ARRAY[pg_temp.current_week_date(0), pg_temp.current_week_date(1)],
      ARRAY[100, 200]::bigint[]
    )
  ),
  'first bounded snapshot is accepted'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.min(outcome) = 'accepted'
      AND pg_catalog.min(quarantine_reason) IS NULL
      AND pg_catalog.min(entry_count) = 2
      AND pg_catalog.min(retention_expires_at - received_at) = INTERVAL '30 days'
    FROM viberacing_private.usage_snapshots
    WHERE usage_snapshot_id = '00000000-0000-4000-8000-000000010501'
  )
  AND (
    SELECT pg_catalog.count(*) = 2
      AND pg_catalog.sum(tokens) = 300
    FROM viberacing_private.usage_snapshot_entries
    WHERE usage_snapshot_id = '00000000-0000-4000-8000-000000010501'
  )
  AND (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.min(expires_at - received_at) = INTERVAL '15 minutes'
    FROM viberacing_private.device_nonces
    WHERE device_key_id = '00000000-0000-4000-8000-000000010401'
  )
  AND (
    SELECT pg_catalog.count(*) = 2
      AND pg_catalog.sum(tokens) = 300
    FROM viberacing_private.source_day_values
    WHERE source_id = 'src_' || pg_catalog.repeat('A', 22)
  ),
  'accepted input persists bounded raw, replay, and current source-day state'
);

RESET ROLE;
SET LOCAL ROLE viberacing_ingest;

SELECT pg_temp.assert_true(
  (
    SELECT outcome = 'duplicate' AND accepted_entries = 0
    FROM pg_temp.submit_fixture(
      '00000000-0000-4000-8000-000000010401',
      'dev_' || pg_catalog.repeat('A', 22),
      'src_' || pg_catalog.repeat('A', 22),
      '00000000-0000-4000-8000-000000010501',
      'syn_' || pg_catalog.repeat('A', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.transaction_timestamp()),
      '10501',
      '11501',
      '12501',
      ARRAY[pg_temp.current_week_date(0), pg_temp.current_week_date(1)],
      ARRAY[100, 200]::bigint[]
    )
  ),
  'exact retry is idempotently acknowledged as duplicate'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT * FROM pg_temp.submit_fixture(
      '00000000-0000-4000-8000-000000010401',
      'dev_' || pg_catalog.repeat('A', 22),
      'src_' || pg_catalog.repeat('A', 22),
      '00000000-0000-4000-8000-000000010599',
      'syn_' || pg_catalog.repeat('A', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.transaction_timestamp()),
      '20501', '11501', '12501',
      ARRAY[pg_temp.current_week_date(0)], ARRAY[100]::bigint[]
    )
  $sql$,
  'mutated idempotency replay fails closed'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT * FROM pg_temp.submit_fixture(
      '00000000-0000-4000-8000-000000010401',
      'dev_' || pg_catalog.repeat('A', 22),
      'src_' || pg_catalog.repeat('A', 22),
      '00000000-0000-4000-8000-000000010502',
      'syn_' || pg_catalog.repeat('B', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.transaction_timestamp()),
      '10502', '11502', '12501',
      ARRAY[pg_temp.current_week_date(0)], ARRAY[100]::bigint[]
    )
  $sql$,
  'nonce replay under a new sync identifier fails closed'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT * FROM pg_temp.submit_fixture(
      '00000000-0000-4000-8000-000000010401',
      'dev_' || pg_catalog.repeat('B', 22),
      'src_' || pg_catalog.repeat('A', 22),
      '00000000-0000-4000-8000-000000010503',
      'syn_' || pg_catalog.repeat('C', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.transaction_timestamp()),
      '10503', '11503', '12503',
      ARRAY[pg_temp.current_week_date(0)], ARRAY[100]::bigint[]
    )
  $sql$,
  'device key and public device identifier must be the same binding'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT * FROM pg_temp.submit_fixture(
      '00000000-0000-4000-8000-000000010401',
      'dev_' || pg_catalog.repeat('A', 22),
      'src_' || pg_catalog.repeat('Q', 22),
      '00000000-0000-4000-8000-000000010504',
      'syn_' || pg_catalog.repeat('D', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.transaction_timestamp()),
      '10504', '11504', '12504',
      ARRAY[pg_temp.current_week_date(0)], ARRAY[100]::bigint[]
    )
  $sql$,
  'a device cannot submit for another source'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT * FROM pg_temp.submit_fixture(
      '00000000-0000-4000-8000-000000010401',
      'dev_' || pg_catalog.repeat('A', 22),
      'src_' || pg_catalog.repeat('A', 22),
      '00000000-0000-4000-8000-000000010505',
      'syn_' || pg_catalog.repeat('E', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.transaction_timestamp()),
      '10505', '11505', '12505',
      ARRAY[pg_temp.current_week_date(0)], ARRAY[100, 200]::bigint[]
    )
  $sql$,
  'date and token arrays must have equal length'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT * FROM pg_temp.submit_fixture(
      '00000000-0000-4000-8000-000000010401',
      'dev_' || pg_catalog.repeat('A', 22),
      'src_' || pg_catalog.repeat('A', 22),
      '00000000-0000-4000-8000-000000010506',
      'syn_' || pg_catalog.repeat('F', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.transaction_timestamp()),
      '10506', '11506', '12506',
      ARRAY[pg_temp.current_week_date(0), pg_temp.current_week_date(0)],
      ARRAY[100, 100]::bigint[]
    )
  $sql$,
  'duplicate dates in one snapshot fail closed'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT * FROM pg_temp.submit_fixture(
      '00000000-0000-4000-8000-000000010401',
      'dev_' || pg_catalog.repeat('A', 22),
      'src_' || pg_catalog.repeat('A', 22),
      '00000000-0000-4000-8000-000000010507',
      'syn_' || pg_catalog.repeat('G', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.transaction_timestamp()),
      '10507', '11507', '12507',
      ARRAY['2026-02-30'], ARRAY[100]::bigint[]
    )
  $sql$,
  'nonexistent Codex-reported date fails closed'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT * FROM pg_temp.submit_fixture(
      '00000000-0000-4000-8000-000000010401',
      'dev_' || pg_catalog.repeat('A', 22),
      'src_' || pg_catalog.repeat('A', 22),
      '00000000-0000-4000-8000-000000010508',
      'syn_' || pg_catalog.repeat('H', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.transaction_timestamp()),
      '10508', '11508', '12508',
      ARRAY[pg_temp.current_week_date(0)], ARRAY[-1]::bigint[]
    )
  $sql$,
  'negative token value fails closed'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT * FROM pg_temp.submit_fixture(
      '00000000-0000-4000-8000-000000010401',
      'dev_' || pg_catalog.repeat('A', 22),
      'src_' || pg_catalog.repeat('A', 22),
      '00000000-0000-4000-8000-000000010509',
      'syn_' || pg_catalog.repeat('I', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.transaction_timestamp()),
      '10509', '11509', '12509',
      ARRAY[pg_temp.current_week_date(0)], ARRAY[9007199254740992]::bigint[]
    )
  $sql$,
  'token serialization overflow fails closed'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT * FROM pg_temp.submit_fixture(
      '00000000-0000-4000-8000-000000010401',
      'dev_' || pg_catalog.repeat('A', 22),
      'src_' || pg_catalog.repeat('A', 22),
      '00000000-0000-4000-8000-000000010510',
      'syn_' || pg_catalog.repeat('J', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.transaction_timestamp()),
      '10510', '11510', '12510',
      ARRAY[]::text[], ARRAY[]::bigint[]
    )
  $sql$,
  'empty snapshot fails closed'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT * FROM pg_temp.submit_fixture(
      '00000000-0000-4000-8000-000000010401',
      'dev_' || pg_catalog.repeat('A', 22),
      'src_' || pg_catalog.repeat('A', 22),
      '00000000-0000-4000-8000-000000010511',
      'syn_' || pg_catalog.repeat('K', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.transaction_timestamp()),
      '10511', '11511', '12511',
      ARRAY(
        SELECT pg_catalog.to_char('2026-01-01'::date + offset_value, 'YYYY-MM-DD')
        FROM pg_catalog.generate_series(0, 31) AS generated(offset_value)
      ),
      ARRAY(
        SELECT offset_value::bigint
        FROM pg_catalog.generate_series(0, 31) AS generated(offset_value)
      )
    )
  $sql$,
  'snapshot with more than 31 entries fails closed'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT * FROM pg_temp.submit_fixture(
      '00000000-0000-4000-8000-000000010401',
      'dev_' || pg_catalog.repeat('A', 22),
      'src_' || pg_catalog.repeat('A', 22),
      '00000000-0000-4000-8000-000000010512',
      'syn_' || pg_catalog.repeat('L', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.transaction_timestamp()) - INTERVAL '15 minutes 1 millisecond',
      '10512', '11512', '12512',
      ARRAY[pg_temp.current_week_date(0)], ARRAY[100]::bigint[]
    )
  $sql$,
  'stale observedAt cannot reopen the replay window'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT * FROM pg_temp.submit_fixture(
      '00000000-0000-4000-8000-000000010401',
      'dev_' || pg_catalog.repeat('A', 22),
      'src_' || pg_catalog.repeat('A', 22),
      '00000000-0000-4000-8000-000000010513',
      'syn_' || pg_catalog.repeat('M', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()) + INTERVAL '2 minutes 1 second',
      '10513', '11513', '12513',
      ARRAY[pg_temp.current_week_date(0)], ARRAY[100]::bigint[]
    )
  $sql$,
  'future observedAt outside clock skew fails closed'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT * FROM pg_temp.submit_fixture(
      '00000000-0000-4000-8000-000000010401',
      'dev_' || pg_catalog.repeat('A', 22),
      'src_' || pg_catalog.repeat('A', 22),
      '00000000-0000-4000-8000-000000010514',
      'syn_' || pg_catalog.repeat('N', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.transaction_timestamp()) + INTERVAL '1 microsecond',
      '10514', '11514', '12514',
      ARRAY[pg_temp.current_week_date(0)], ARRAY[100]::bigint[]
    )
  $sql$,
  'observedAt must retain canonical millisecond precision'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT * FROM viberacing_api.submit_usage_sync(
      '00000000-0000-4000-8000-000000010401',
      'dev_' || pg_catalog.repeat('A', 22),
      'src_' || pg_catalog.repeat('A', 22),
      'codex',
      'codex_daily_usage_buckets_v1',
      '00000000-0000-4000-8000-000000010515',
      'syn_' || pg_catalog.repeat('O', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.transaction_timestamp()),
      'not-semver', '4.5.6',
      pg_catalog.decode(pg_catalog.lpad('10515', 64, '0'), 'hex'),
      pg_catalog.decode(pg_catalog.lpad('11515', 128, '0'), 'hex'),
      pg_catalog.decode(pg_catalog.lpad('12515', 64, '0'), 'hex'),
      ARRAY[pg_temp.current_week_date(0)], ARRAY[100]::bigint[]
    )
  $sql$,
  'invalid client version fails closed'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT * FROM viberacing_api.submit_usage_sync(
      '00000000-0000-4000-8000-000000010401',
      'dev_' || pg_catalog.repeat('A', 22),
      'src_' || pg_catalog.repeat('A', 22),
      'codex',
      'codex_daily_usage_buckets_v1',
      '00000000-0000-4000-8000-000000010516',
      'syn_' || pg_catalog.repeat('R', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.transaction_timestamp()),
      '1.2.3', '4.5.6',
      pg_catalog.decode('00', 'hex'),
      pg_catalog.decode(pg_catalog.lpad('11516', 128, '0'), 'hex'),
      pg_catalog.decode(pg_catalog.lpad('12516', 64, '0'), 'hex'),
      ARRAY[pg_temp.current_week_date(0)], ARRAY[100]::bigint[]
    )
  $sql$,
  'invalid digest length fails closed'
);

SELECT pg_temp.assert_true(
  (
    SELECT outcome = 'quarantined' AND accepted_entries = 0
    FROM pg_temp.submit_fixture(
      '00000000-0000-4000-8000-000000010401',
      'dev_' || pg_catalog.repeat('A', 22),
      'src_' || pg_catalog.repeat('A', 22),
      '00000000-0000-4000-8000-000000010517',
      'syn_' || pg_catalog.repeat('S', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.transaction_timestamp()),
      '10517', '11517', '12517',
      ARRAY[pg_temp.current_week_date(0), pg_temp.current_week_date(1)],
      ARRAY[99, 250]::bigint[]
    )
  ),
  'one decreasing value quarantines the complete snapshot'
);

SELECT pg_temp.assert_true(
  (
    SELECT outcome = 'accepted' AND accepted_entries = 2
    FROM pg_temp.submit_fixture(
      '00000000-0000-4000-8000-000000010402',
      'dev_' || pg_catalog.repeat('B', 22),
      'src_' || pg_catalog.repeat('A', 22),
      '00000000-0000-4000-8000-000000010518',
      'syn_' || pg_catalog.repeat('T', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.transaction_timestamp()),
      '10518', '11518', '12518',
      ARRAY[pg_temp.current_week_date(0), pg_temp.current_week_date(1)],
      ARRAY[100, 250]::bigint[]
    )
  ),
  'second device advances but never sums same-source current values'
);

SELECT pg_temp.assert_true(
  (
    SELECT outcome = 'quarantined' AND accepted_entries = 0
    FROM pg_temp.submit_fixture(
      '00000000-0000-4000-8000-000000010404',
      'dev_' || pg_catalog.repeat('Q', 22),
      'src_' || pg_catalog.repeat('Q', 22),
      '00000000-0000-4000-8000-000000010519',
      'syn_' || pg_catalog.repeat('U', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.transaction_timestamp()),
      '10519', '11519', '12519',
      ARRAY[pg_temp.current_week_date(0)], ARRAY[700]::bigint[]
    )
  ),
  'quarantined source snapshot is retained but excluded from current values'
);

SELECT pg_temp.assert_true(
  (
    SELECT outcome = 'accepted' AND accepted_entries = 1
    FROM pg_temp.submit_fixture(
      '00000000-0000-4000-8000-000000010405',
      'dev_' || pg_catalog.repeat('H', 22),
      'src_' || pg_catalog.repeat('H', 22),
      '00000000-0000-4000-8000-000000010520',
      'syn_' || pg_catalog.repeat('V', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.transaction_timestamp()),
      '10520', '11520', '12520',
      ARRAY[pg_temp.current_week_date(0)], ARRAY[800]::bigint[]
    )
  ),
  'hidden profile can continue private collection until deletion is requested'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT * FROM pg_temp.submit_fixture(
      '00000000-0000-4000-8000-000000010403',
      'dev_' || pg_catalog.repeat('P', 22),
      'src_' || pg_catalog.repeat('P', 22),
      '00000000-0000-4000-8000-000000010521',
      'syn_' || pg_catalog.repeat('W', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.transaction_timestamp()),
      '10521', '11521', '12521',
      ARRAY[pg_temp.current_week_date(0)], ARRAY[900]::bigint[]
    )
  $sql$,
  'paused source cannot submit'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT * FROM pg_temp.submit_fixture(
      '00000000-0000-4000-8000-000000010407',
      'dev_' || pg_catalog.repeat('R', 22),
      'src_' || pg_catalog.repeat('A', 22),
      '00000000-0000-4000-8000-000000010522',
      'syn_' || pg_catalog.repeat('X', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.transaction_timestamp()),
      '10522', '11522', '12522',
      ARRAY[pg_temp.current_week_date(0)], ARRAY[900]::bigint[]
    )
  $sql$,
  'revoked device cannot submit'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT * FROM pg_temp.submit_fixture(
      '00000000-0000-4000-8000-000000010406',
      'dev_' || pg_catalog.repeat('D', 22),
      'src_' || pg_catalog.repeat('D', 22),
      '00000000-0000-4000-8000-000000010523',
      'syn_' || pg_catalog.repeat('Y', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.transaction_timestamp()),
      '10523', '11523', '12523',
      ARRAY[pg_temp.current_week_date(0)], ARRAY[900]::bigint[]
    )
  $sql$,
  'deletion-pending profile cannot submit'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT outcome = 'quarantined'
      AND quarantine_reason = 'decrease'
      AND entry_count = 2
    FROM viberacing_private.usage_snapshots
    WHERE usage_snapshot_id = '00000000-0000-4000-8000-000000010517'
  )
  AND (
    SELECT pg_catalog.count(*) = 2
      AND pg_catalog.min(tokens) = 100
      AND pg_catalog.max(tokens) = 250
      AND pg_catalog.bool_and(
        accepted_snapshot_id = '00000000-0000-4000-8000-000000010518'
        AND accepted_device_id = 'dev_' || pg_catalog.repeat('B', 22)
      )
    FROM viberacing_private.source_day_values
    WHERE source_id = 'src_' || pg_catalog.repeat('A', 22)
  ),
  'decrease leaves current state untouched and later same-source device replaces without summing'
);

SELECT pg_temp.assert_true(
  (
    SELECT outcome = 'quarantined'
      AND quarantine_reason = 'source_state'
    FROM viberacing_private.usage_snapshots
    WHERE usage_snapshot_id = '00000000-0000-4000-8000-000000010519'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.source_day_values
    WHERE source_id = 'src_' || pg_catalog.repeat('Q', 22)
  )
  AND (
    SELECT tokens = 800
    FROM viberacing_private.source_day_values
    WHERE source_id = 'src_' || pg_catalog.repeat('H', 22)
      AND codex_reported_date = pg_temp.current_week_date(0)::date
  ),
  'source quarantine excludes current values while hidden profile state stays private and live'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    UPDATE viberacing_private.source_day_values
    SET tokens = tokens - 1
    WHERE source_id = 'src_' || pg_catalog.repeat('A', 22)
      AND codex_reported_date = pg_temp.current_week_date(1)::date
  $sql$,
  'current source-day tokens cannot decrease through direct owner mutation'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    UPDATE viberacing_private.source_day_values
    SET first_accepted_at = first_accepted_at + INTERVAL '1 second'
    WHERE source_id = 'src_' || pg_catalog.repeat('A', 22)
      AND codex_reported_date = pg_temp.current_week_date(1)::date
  $sql$,
  'first accepted timestamp is immutable'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    UPDATE viberacing_private.source_day_values
    SET accepted_sync_id = 'syn_' || pg_catalog.repeat('Z', 22)
    WHERE source_id = 'src_' || pg_catalog.repeat('A', 22)
      AND codex_reported_date = pg_temp.current_week_date(1)::date
  $sql$,
  'current source-day provenance must match its accepted snapshot and entry'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 6
    FROM viberacing_private.usage_snapshots
  )
  AND (
    SELECT pg_catalog.count(*) = 6
    FROM viberacing_private.device_nonces
  ),
  'rejected and duplicate requests create no extra persistent state'
);

DELETE FROM viberacing_private.usage_snapshots
WHERE usage_snapshot_id = '00000000-0000-4000-8000-000000010518';

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 2
      AND pg_catalog.sum(tokens) = 350
      AND pg_catalog.bool_and(accepted_snapshot_id IS NULL)
    FROM viberacing_private.source_day_values
    WHERE source_id = 'src_' || pg_catalog.repeat('A', 22)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.usage_snapshot_entries
    WHERE usage_snapshot_id = '00000000-0000-4000-8000-000000010518'
  ),
  'raw snapshot retention cleanup can preserve current values while clearing raw provenance links'
);

ROLLBACK;
