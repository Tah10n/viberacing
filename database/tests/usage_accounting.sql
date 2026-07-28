\set ON_ERROR_STOP on

BEGIN;

SET LOCAL ROLE viberacing_owner;

UPDATE viberacing_private.agent_providers
SET state = 'supported'
WHERE provider_code = 'codex';

UPDATE viberacing_private.agent_accounting_revisions
SET enabled_for_new_accounts = true
WHERE provider_code = 'codex'
  AND accounting_revision = 1;

INSERT INTO viberacing_private.profiles (
  profile_id,
  github_user_id,
  handle,
  locale,
  hidden_at
)
VALUES (
  '40000000-0000-4000-8000-000000000001',
  930000000000001,
  'usage-accounting',
  'en',
  pg_catalog.transaction_timestamp()
);

UPDATE viberacing_private.profiles
SET state = 'active'
WHERE profile_id = '40000000-0000-4000-8000-000000000001';

INSERT INTO viberacing_private.agent_accounts (
  agent_account_id,
  profile_id,
  provider_code,
  accounting_revision,
  scope_kind,
  fingerprint_kind,
  account_fingerprint_digest,
  private_label,
  identity_assurance
)
VALUES (
  'acc_AAAAAAAAAAAAAAAAAAAAAA',
  '40000000-0000-4000-8000-000000000001',
  'codex',
  1,
  'agent_account',
  'stable_opaque',
  pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
  'Usage fixture',
  'community_local'
);

INSERT INTO viberacing_private.connector_installations (
  installation_id,
  profile_id,
  installation_public_key,
  label,
  connector_version,
  os_family,
  architecture,
  state,
  activated_at,
  last_seen_at
)
VALUES
  (
    'ins_AAAAAAAAAAAAAAAAAAAAAA',
    '40000000-0000-4000-8000-000000000001',
    pg_catalog.decode(pg_catalog.repeat('42', 32), 'hex'),
    'Primary usage fixture',
    '0.0.0',
    'windows',
    'x86_64',
    'active',
    pg_catalog.transaction_timestamp(),
    pg_catalog.transaction_timestamp()
  ),
  (
    'ins_BBBBBBBBBBBBBBBBBBBBBB',
    '40000000-0000-4000-8000-000000000001',
    pg_catalog.decode(pg_catalog.repeat('43', 32), 'hex'),
    'Secondary usage fixture',
    '0.0.0',
    'linux',
    'aarch64',
    'active',
    pg_catalog.transaction_timestamp(),
    pg_catalog.transaction_timestamp()
  );

INSERT INTO viberacing_private.device_keys (
  device_key_id,
  device_id,
  profile_id,
  installation_id,
  agent_account_id,
  public_key
)
VALUES
  (
    'key_AAAAAAAAAAAAAAAAAAAAAA',
    'dev_AAAAAAAAAAAAAAAAAAAAAA',
    '40000000-0000-4000-8000-000000000001',
    'ins_AAAAAAAAAAAAAAAAAAAAAA',
    'acc_AAAAAAAAAAAAAAAAAAAAAA',
    pg_catalog.decode(pg_catalog.repeat('44', 32), 'hex')
  ),
  (
    'key_BBBBBBBBBBBBBBBBBBBBBB',
    'dev_BBBBBBBBBBBBBBBBBBBBBB',
    '40000000-0000-4000-8000-000000000001',
    'ins_BBBBBBBBBBBBBBBBBBBBBB',
    'acc_AAAAAAAAAAAAAAAAAAAAAA',
    pg_catalog.decode(pg_catalog.repeat('45', 32), 'hex')
  );

CREATE FUNCTION pg_temp.submit_usage_fixture(
  p_marker text,
  p_device_marker text,
  p_sync_marker text,
  p_origin_hex text,
  p_device_nonce_hex text,
  p_body_hex text,
  p_signature_hex text,
  p_observed_at timestamptz,
  p_usage_dates date[],
  p_totals text[]
)
RETURNS TABLE (
  outcome text,
  accepted_entries integer,
  recovery_action text
)
LANGUAGE sql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT *
  FROM viberacing_api.submit_usage_sync(
    'obs_' || pg_catalog.repeat(p_marker, 22),
    'evt_' || pg_catalog.repeat(p_marker, 22),
    'edge_test',
    pg_catalog.decode(pg_catalog.repeat(p_origin_hex, 32), 'hex'),
    pg_catalog.transaction_timestamp() + interval '30 seconds',
    'key_' || pg_catalog.repeat(p_device_marker, 22),
    'dev_' || pg_catalog.repeat(p_device_marker, 22),
    'acc_AAAAAAAAAAAAAAAAAAAAAA',
    'syn_' || pg_catalog.repeat(p_sync_marker, 22),
    p_observed_at,
    '0.0.0',
    'codex_app_server_0_144_5_v1',
    pg_catalog.decode(pg_catalog.repeat(p_body_hex, 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat(p_signature_hex, 64), 'hex'),
    pg_catalog.decode(pg_catalog.repeat(p_device_nonce_hex, 32), 'hex'),
    p_usage_dates,
    p_totals
  )
$function$;

RESET ROLE;
SET LOCAL ROLE viberacing_ingest;

DO $material_assertion$
DECLARE
  v_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
  INTO v_count
  FROM viberacing_api.read_usage_device_verification_material(
    'dev_AAAAAAAAAAAAAAAAAAAAAA'
  ) AS material
  WHERE material.device_key_id = 'key_AAAAAAAAAAAAAAAAAAAAAA'
    AND material.agent_account_id = 'acc_AAAAAAAAAAAAAAAAAAAAAA'
    AND material.provider_code = 'codex'
    AND material.accounting_revision = 1
    AND material.reader_version = 'codex_app_server_0_144_5_v1'
    AND material.scope_kind = 'agent_account'
    AND material.maximum_backfill_days = 35
    AND material.identity_assurance = 'community_local'
    AND pg_catalog.octet_length(material.public_key) = 32;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'active device verification material is invalid';
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO v_count
  FROM viberacing_api.read_usage_device_verification_material(
    'dev_ZZZZZZZZZZZZZZZZZZZZZZ'
  );
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'unknown device unexpectedly returned verification material';
  END IF;
END
$material_assertion$;

DO $ingest_capability_assertion$
BEGIN
  BEGIN
    PERFORM pg_catalog.count(*)
    FROM viberacing_private.usage_observations;
    RAISE EXCEPTION 'Ingest unexpectedly read a private table directly';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  BEGIN
    PERFORM *
    FROM viberacing_api.submit_usage_sync(
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL
    );
    RAISE EXCEPTION 'invalid Ingest submit unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;
END
$ingest_capability_assertion$;

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

DO $accounting_assertion$
DECLARE
  v_before_counts bigint[];
  v_current_date date := (
    pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC'
  )::date;
  v_outcome text;
  v_entries integer;
  v_recovery text;
BEGIN
  SELECT result.outcome, result.accepted_entries, result.recovery_action
  INTO v_outcome, v_entries, v_recovery
  FROM pg_temp.submit_usage_fixture(
    'A',
    'A',
    'A',
    '01',
    '11',
    '21',
    '31',
    pg_catalog.transaction_timestamp(),
    ARRAY[v_current_date, v_current_date - 1, v_current_date - 35],
    ARRAY['9007199254740993', '42', '7']
  ) AS result;
  IF v_outcome <> 'accepted' OR v_entries <> 3 OR v_recovery IS NOT NULL THEN
    RAISE EXCEPTION 'first exact-decimal usage snapshot was not accepted';
  END IF;

  SELECT ARRAY[
    (SELECT pg_catalog.count(*) FROM viberacing_private.origin_nonces),
    (SELECT pg_catalog.count(*) FROM viberacing_private.device_nonces),
    (SELECT pg_catalog.count(*) FROM viberacing_private.usage_idempotency_records),
    (SELECT pg_catalog.count(*) FROM viberacing_private.usage_observations),
    (SELECT pg_catalog.count(*) FROM viberacing_private.agent_account_day_totals),
    (SELECT pg_catalog.count(*) FROM viberacing_private.ranking_refresh_outbox),
    (SELECT pg_catalog.count(*) FROM viberacing_private.ranking_events)
  ]
  INTO v_before_counts;

  SELECT result.outcome, result.accepted_entries, result.recovery_action
  INTO v_outcome, v_entries, v_recovery
  FROM pg_temp.submit_usage_fixture(
    'Z',
    'A',
    'A',
    '02',
    '11',
    '21',
    '31',
    pg_catalog.transaction_timestamp(),
    ARRAY[v_current_date, v_current_date - 1, v_current_date - 35],
    ARRAY['9007199254740993', '42', '7']
  ) AS result;
  IF v_outcome <> 'duplicate' OR v_entries <> 0 OR v_recovery IS NOT NULL THEN
    RAISE EXCEPTION 'exact ambiguous-response retry was not a no-write duplicate';
  END IF;
  IF v_before_counts <> ARRAY[
    (SELECT pg_catalog.count(*) FROM viberacing_private.origin_nonces),
    (SELECT pg_catalog.count(*) FROM viberacing_private.device_nonces),
    (SELECT pg_catalog.count(*) FROM viberacing_private.usage_idempotency_records),
    (SELECT pg_catalog.count(*) FROM viberacing_private.usage_observations),
    (SELECT pg_catalog.count(*) FROM viberacing_private.agent_account_day_totals),
    (SELECT pg_catalog.count(*) FROM viberacing_private.ranking_refresh_outbox),
    (SELECT pg_catalog.count(*) FROM viberacing_private.ranking_events)
  ] THEN
    RAISE EXCEPTION 'exact retry mutated persistent state';
  END IF;

  BEGIN
    PERFORM *
    FROM pg_temp.submit_usage_fixture(
      'Z',
      'A',
      'A',
      '02',
      '11',
      '22',
      '31',
      pg_catalog.transaction_timestamp(),
      ARRAY[v_current_date, v_current_date - 1, v_current_date - 35],
      ARRAY['9007199254740993', '42', '7']
    );
    RAISE EXCEPTION 'same sync ID with changed body unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  BEGIN
    PERFORM *
    FROM pg_temp.submit_usage_fixture(
      'Z',
      'A',
      'A',
      '02',
      '11',
      '21',
      '31',
      pg_catalog.transaction_timestamp() + interval '1 second',
      ARRAY[v_current_date, v_current_date - 1, v_current_date - 35],
      ARRAY['9007199254740993', '42', '7']
    );
    RAISE EXCEPTION 'same sync ID with changed observedAt unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  SELECT result.outcome, result.accepted_entries
  INTO v_outcome, v_entries
  FROM pg_temp.submit_usage_fixture(
    'B',
    'A',
    'B',
    '03',
    '12',
    '22',
    '32',
    pg_catalog.transaction_timestamp(),
    ARRAY[v_current_date, v_current_date - 1, v_current_date - 35],
    ARRAY['9007199254740993', '42', '7']
  ) AS result;
  IF v_outcome <> 'duplicate' OR v_entries <> 0 THEN
    RAISE EXCEPTION 'same cumulative values under a new sync were not a no-op duplicate';
  END IF;

  SELECT result.outcome, result.accepted_entries
  INTO v_outcome, v_entries
  FROM pg_temp.submit_usage_fixture(
    'C',
    'B',
    'C',
    '04',
    '13',
    '23',
    '33',
    pg_catalog.transaction_timestamp(),
    ARRAY[v_current_date],
    ARRAY['9007199254741993']
  ) AS result;
  IF v_outcome <> 'accepted' OR v_entries <> 1 THEN
    RAISE EXCEPTION 'higher cumulative value from a second device was not accepted';
  END IF;

  SELECT result.outcome, result.accepted_entries, result.recovery_action
  INTO v_outcome, v_entries, v_recovery
  FROM pg_temp.submit_usage_fixture(
    'D',
    'A',
    'D',
    '05',
    '14',
    '24',
    '34',
    pg_catalog.transaction_timestamp(),
    ARRAY[v_current_date, v_current_date - 1],
    ARRAY['1', '100']
  ) AS result;
  IF v_outcome <> 'quarantined'
    OR v_entries <> 0
    OR v_recovery <> 'contact_support'
  THEN
    RAISE EXCEPTION 'mixed lower batch was not wholly quarantined';
  END IF;

  IF (
    SELECT cumulative_token_total::text
    FROM viberacing_private.agent_account_day_totals
    WHERE agent_account_id = 'acc_AAAAAAAAAAAAAAAAAAAAAA'
      AND usage_date = v_current_date
  ) <> '9007199254741993' OR (
    SELECT cumulative_token_total::text
    FROM viberacing_private.agent_account_day_totals
    WHERE agent_account_id = 'acc_AAAAAAAAAAAAAAAAAAAAAA'
      AND usage_date = v_current_date - 1
  ) <> '42' THEN
    RAISE EXCEPTION 'lower mixed batch changed an accepted account/day total';
  END IF;

  v_before_counts := ARRAY[
    (SELECT pg_catalog.count(*) FROM viberacing_private.origin_nonces),
    (SELECT pg_catalog.count(*) FROM viberacing_private.device_nonces),
    (SELECT pg_catalog.count(*) FROM viberacing_private.usage_idempotency_records),
    (SELECT pg_catalog.count(*) FROM viberacing_private.usage_observations),
    (SELECT pg_catalog.count(*) FROM viberacing_private.agent_account_day_totals),
    (SELECT pg_catalog.count(*) FROM viberacing_private.ranking_refresh_outbox),
    (SELECT pg_catalog.count(*) FROM viberacing_private.ranking_events)
  ];

  BEGIN
    PERFORM *
    FROM pg_temp.submit_usage_fixture(
      'E',
      'A',
      'E',
      '06',
      '15',
      '25',
      '35',
      pg_catalog.transaction_timestamp(),
      ARRAY[v_current_date + 1],
      ARRAY['10']
    );
    RAISE EXCEPTION 'tomorrow unexpectedly passed the database UTC date window';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  BEGIN
    PERFORM *
    FROM pg_temp.submit_usage_fixture(
      'E',
      'A',
      'E',
      '06',
      '15',
      '25',
      '35',
      pg_catalog.transaction_timestamp(),
      ARRAY[v_current_date - 36],
      ARRAY['10']
    );
    RAISE EXCEPTION 'one day beyond maximum backfill unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  BEGIN
    PERFORM *
    FROM pg_temp.submit_usage_fixture(
      'E',
      'A',
      'E',
      '06',
      '15',
      '25',
      '35',
      pg_catalog.transaction_timestamp() - interval '15 minutes 1 second',
      ARRAY[v_current_date],
      ARRAY['10']
    );
    RAISE EXCEPTION 'stale observedAt unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  BEGIN
    PERFORM *
    FROM pg_temp.submit_usage_fixture(
      'E',
      'A',
      'E',
      '06',
      '15',
      '25',
      '35',
      pg_catalog.transaction_timestamp() + interval '2 minutes 1 second',
      ARRAY[v_current_date],
      ARRAY['10']
    );
    RAISE EXCEPTION 'future observedAt unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  BEGIN
    PERFORM *
    FROM pg_temp.submit_usage_fixture(
      'E',
      'A',
      'E',
      '06',
      '15',
      '25',
      '35',
      pg_catalog.transaction_timestamp(),
      ARRAY[v_current_date, v_current_date],
      ARRAY['10', '10']
    );
    RAISE EXCEPTION 'duplicate usage dates unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  IF v_before_counts <> ARRAY[
    (SELECT pg_catalog.count(*) FROM viberacing_private.origin_nonces),
    (SELECT pg_catalog.count(*) FROM viberacing_private.device_nonces),
    (SELECT pg_catalog.count(*) FROM viberacing_private.usage_idempotency_records),
    (SELECT pg_catalog.count(*) FROM viberacing_private.usage_observations),
    (SELECT pg_catalog.count(*) FROM viberacing_private.agent_account_day_totals),
    (SELECT pg_catalog.count(*) FROM viberacing_private.ranking_refresh_outbox),
    (SELECT pg_catalog.count(*) FROM viberacing_private.ranking_events)
  ] THEN
    RAISE EXCEPTION 'date/timestamp rejection left partial persistent state';
  END IF;
END
$accounting_assertion$;

DO $numeric_and_replay_assertion$
DECLARE
  v_bad_total text;
  v_before_counts bigint[];
  v_current_date date := (
    pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC'
  )::date;
BEGIN
  v_before_counts := ARRAY[
    (SELECT pg_catalog.count(*) FROM viberacing_private.origin_nonces),
    (SELECT pg_catalog.count(*) FROM viberacing_private.device_nonces),
    (SELECT pg_catalog.count(*) FROM viberacing_private.usage_idempotency_records),
    (SELECT pg_catalog.count(*) FROM viberacing_private.usage_observations),
    (SELECT pg_catalog.count(*) FROM viberacing_private.ranking_events)
  ];

  FOREACH v_bad_total IN ARRAY ARRAY[
    '01',
    '1e3',
    '-1',
    ' 1',
    '1000000000000000000000000000000'
  ]
  LOOP
    BEGIN
      PERFORM *
      FROM pg_temp.submit_usage_fixture(
        'E',
        'A',
        'E',
        '06',
        '15',
        '25',
        '35',
        pg_catalog.transaction_timestamp(),
        ARRAY[v_current_date],
        ARRAY[v_bad_total]
      );
      RAISE EXCEPTION 'non-canonical or overflowing decimal unexpectedly succeeded: %',
        v_bad_total;
    EXCEPTION
      WHEN SQLSTATE 'P0001' THEN
        NULL;
    END;
  END LOOP;

  BEGIN
    PERFORM *
    FROM pg_temp.submit_usage_fixture(
      'E',
      'A',
      'E',
      '01',
      '16',
      '26',
      '36',
      pg_catalog.transaction_timestamp(),
      ARRAY[v_current_date],
      ARRAY['9007199254741993']
    );
    RAISE EXCEPTION 'origin nonce replay unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  BEGIN
    PERFORM *
    FROM pg_temp.submit_usage_fixture(
      'E',
      'A',
      'E',
      '07',
      '11',
      '26',
      '36',
      pg_catalog.transaction_timestamp(),
      ARRAY[v_current_date],
      ARRAY['9007199254741993']
    );
    RAISE EXCEPTION 'device nonce replay unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  IF EXISTS (
    SELECT 1
    FROM viberacing_private.origin_nonces
    WHERE nonce_digest = pg_catalog.decode(pg_catalog.repeat('07', 32), 'hex')
  ) THEN
    RAISE EXCEPTION 'device nonce conflict failed to roll back the new origin nonce';
  END IF;

  IF v_before_counts <> ARRAY[
    (SELECT pg_catalog.count(*) FROM viberacing_private.origin_nonces),
    (SELECT pg_catalog.count(*) FROM viberacing_private.device_nonces),
    (SELECT pg_catalog.count(*) FROM viberacing_private.usage_idempotency_records),
    (SELECT pg_catalog.count(*) FROM viberacing_private.usage_observations),
    (SELECT pg_catalog.count(*) FROM viberacing_private.ranking_events)
  ] THEN
    RAISE EXCEPTION 'numeric/replay failure left partial state';
  END IF;
END
$numeric_and_replay_assertion$;

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

DELETE FROM viberacing_private.origin_nonces
WHERE nonce_digest = pg_catalog.decode(pg_catalog.repeat('01', 32), 'hex');

DELETE FROM viberacing_private.device_nonces
WHERE device_key_id = 'key_AAAAAAAAAAAAAAAAAAAAAA'
  AND nonce_digest = pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex');

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

DO $long_idempotency_assertion$
DECLARE
  v_current_date date := (
    pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC'
  )::date;
  v_entries integer;
  v_outcome text;
BEGIN
  SELECT result.outcome, result.accepted_entries
  INTO v_outcome, v_entries
  FROM pg_temp.submit_usage_fixture(
    'Z',
    'A',
    'A',
    '08',
    '11',
    '21',
    '31',
    pg_catalog.transaction_timestamp(),
    ARRAY[v_current_date, v_current_date - 1, v_current_date - 35],
    ARRAY['9007199254740993', '42', '7']
  ) AS result;
  IF v_outcome <> 'duplicate' OR v_entries <> 0 THEN
    RAISE EXCEPTION 'idempotency did not survive short nonce cleanup';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM viberacing_private.origin_nonces
    WHERE nonce_digest = pg_catalog.decode(pg_catalog.repeat('08', 32), 'hex')
  ) OR EXISTS (
    SELECT 1
    FROM viberacing_private.device_nonces
    WHERE device_key_id = 'key_AAAAAAAAAAAAAAAAAAAAAA'
      AND nonce_digest = pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex')
  ) THEN
    RAISE EXCEPTION 'exact retry after nonce cleanup performed replay writes';
  END IF;
END
$long_idempotency_assertion$;

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

UPDATE viberacing_private.agent_accounts
SET state = 'paused'
WHERE agent_account_id = 'acc_AAAAAAAAAAAAAAAAAAAAAA';

RESET ROLE;
SET LOCAL ROLE viberacing_ingest;

DO $paused_assertion$
DECLARE
  v_current_date date := (
    pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC'
  )::date;
BEGIN
  BEGIN
    PERFORM *
    FROM pg_temp.submit_usage_fixture(
      'E',
      'A',
      'E',
      '09',
      '19',
      '29',
      '39',
      pg_catalog.transaction_timestamp(),
      ARRAY[v_current_date],
      ARRAY['9007199254742993']
    );
    RAISE EXCEPTION 'paused account unexpectedly accepted usage';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;
END
$paused_assertion$;

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

UPDATE viberacing_private.agent_accounts
SET state = 'active'
WHERE agent_account_id = 'acc_AAAAAAAAAAAAAAAAAAAAAA';

UPDATE viberacing_private.device_keys
SET state = 'revoked',
    revoked_at = pg_catalog.transaction_timestamp()
WHERE device_key_id = 'key_BBBBBBBBBBBBBBBBBBBBBB';

RESET ROLE;
SET LOCAL ROLE viberacing_ingest;

DO $revoked_device_assertion$
DECLARE
  v_current_date date := (
    pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC'
  )::date;
BEGIN
  BEGIN
    PERFORM *
    FROM pg_temp.submit_usage_fixture(
      'E',
      'B',
      'E',
      '0a',
      '1a',
      '2a',
      '3a',
      pg_catalog.transaction_timestamp(),
      ARRAY[v_current_date],
      ARRAY['9007199254742993']
    );
    RAISE EXCEPTION 'revoked device unexpectedly accepted usage';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;
END
$revoked_device_assertion$;

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

UPDATE viberacing_private.agent_providers
SET state = 'disabled'
WHERE provider_code = 'codex';

RESET ROLE;
SET LOCAL ROLE viberacing_ingest;

DO $disabled_provider_assertion$
DECLARE
  v_current_date date := (
    pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC'
  )::date;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM viberacing_api.read_usage_device_verification_material(
      'dev_AAAAAAAAAAAAAAAAAAAAAA'
    )
  ) THEN
    RAISE EXCEPTION 'disabled provider returned verification material';
  END IF;

  BEGIN
    PERFORM *
    FROM pg_temp.submit_usage_fixture(
      'E',
      'A',
      'E',
      '0c',
      '1c',
      '2c',
      '3c',
      pg_catalog.transaction_timestamp(),
      ARRAY[v_current_date],
      ARRAY['9007199254742993']
    );
    RAISE EXCEPTION 'disabled provider unexpectedly accepted usage';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;
END
$disabled_provider_assertion$;

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

UPDATE viberacing_private.agent_providers
SET state = 'supported'
WHERE provider_code = 'codex';

UPDATE viberacing_private.agent_accounting_revisions
SET enabled_for_new_accounts = false
WHERE provider_code = 'codex'
  AND accounting_revision = 1;

RESET ROLE;
SET LOCAL ROLE viberacing_ingest;

DO $disabled_revision_assertion$
DECLARE
  v_current_date date := (
    pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC'
  )::date;
BEGIN
  BEGIN
    PERFORM *
    FROM pg_temp.submit_usage_fixture(
      'E',
      'A',
      'E',
      '0d',
      '1d',
      '2d',
      '3d',
      pg_catalog.transaction_timestamp(),
      ARRAY[v_current_date],
      ARRAY['9007199254742993']
    );
    RAISE EXCEPTION 'disabled accounting revision unexpectedly accepted usage';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;
END
$disabled_revision_assertion$;

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

UPDATE viberacing_private.agent_accounting_revisions
SET enabled_for_new_accounts = true
WHERE provider_code = 'codex'
  AND accounting_revision = 1;

RESET ROLE;
SET LOCAL ROLE viberacing_ingest;

DO $server_owned_binding_assertion$
DECLARE
  v_current_date date := (
    pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC'
  )::date;
BEGIN
  BEGIN
    PERFORM *
    FROM viberacing_api.submit_usage_sync(
      'obs_EEEEEEEEEEEEEEEEEEEEEE',
      'evt_EEEEEEEEEEEEEEEEEEEEEE',
      'edge_test',
      pg_catalog.decode(pg_catalog.repeat('0e', 32), 'hex'),
      pg_catalog.transaction_timestamp() + interval '30 seconds',
      'key_AAAAAAAAAAAAAAAAAAAAAA',
      'dev_AAAAAAAAAAAAAAAAAAAAAA',
      'acc_BBBBBBBBBBBBBBBBBBBBBB',
      'syn_EEEEEEEEEEEEEEEEEEEEEE',
      pg_catalog.transaction_timestamp(),
      '0.0.0',
      'codex_app_server_0_144_5_v1',
      pg_catalog.decode(pg_catalog.repeat('2e', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('3e', 64), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('1e', 32), 'hex'),
      ARRAY[v_current_date],
      ARRAY['9007199254742993']
    );
    RAISE EXCEPTION 'wrong AgentAccount binding unexpectedly accepted usage';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  BEGIN
    PERFORM *
    FROM viberacing_api.submit_usage_sync(
      'obs_EEEEEEEEEEEEEEEEEEEEEE',
      'evt_EEEEEEEEEEEEEEEEEEEEEE',
      'edge_test',
      pg_catalog.decode(pg_catalog.repeat('0f', 32), 'hex'),
      pg_catalog.transaction_timestamp() + interval '30 seconds',
      'key_AAAAAAAAAAAAAAAAAAAAAA',
      'dev_AAAAAAAAAAAAAAAAAAAAAA',
      'acc_AAAAAAAAAAAAAAAAAAAAAA',
      'syn_EEEEEEEEEEEEEEEEEEEEEE',
      pg_catalog.transaction_timestamp(),
      '0.0.0',
      'unknown_reader_v2',
      pg_catalog.decode(pg_catalog.repeat('2f', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('3f', 64), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('1f', 32), 'hex'),
      ARRAY[v_current_date],
      ARRAY['9007199254742993']
    );
    RAISE EXCEPTION 'reader/accounting revision mismatch unexpectedly accepted usage';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;
END
$server_owned_binding_assertion$;

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

DO $late_failure_assertion$
DECLARE
  v_before_counts bigint[];
  v_current_date date := (
    pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC'
  )::date;
  v_current_total text;
BEGIN
  v_before_counts := ARRAY[
    (SELECT pg_catalog.count(*) FROM viberacing_private.origin_nonces),
    (SELECT pg_catalog.count(*) FROM viberacing_private.device_nonces),
    (SELECT pg_catalog.count(*) FROM viberacing_private.usage_idempotency_records),
    (SELECT pg_catalog.count(*) FROM viberacing_private.usage_observations),
    (SELECT pg_catalog.count(*) FROM viberacing_private.ranking_events)
  ];
  SELECT cumulative_token_total::text
  INTO v_current_total
  FROM viberacing_private.agent_account_day_totals
  WHERE agent_account_id = 'acc_AAAAAAAAAAAAAAAAAAAAAA'
    AND usage_date = v_current_date;

  BEGIN
    PERFORM *
    FROM viberacing_api.submit_usage_sync(
      'obs_FFFFFFFFFFFFFFFFFFFFFF',
      'evt_AAAAAAAAAAAAAAAAAAAAAA',
      'edge_test',
      pg_catalog.decode(pg_catalog.repeat('0b', 32), 'hex'),
      pg_catalog.transaction_timestamp() + interval '30 seconds',
      'key_AAAAAAAAAAAAAAAAAAAAAA',
      'dev_AAAAAAAAAAAAAAAAAAAAAA',
      'acc_AAAAAAAAAAAAAAAAAAAAAA',
      'syn_FFFFFFFFFFFFFFFFFFFFFF',
      pg_catalog.transaction_timestamp(),
      '0.0.0',
      'codex_app_server_0_144_5_v1',
      pg_catalog.decode(pg_catalog.repeat('2b', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('3b', 64), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('1b', 32), 'hex'),
      ARRAY[v_current_date],
      ARRAY['9007199254743993']
    );
    RAISE EXCEPTION 'late event collision unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  IF v_before_counts <> ARRAY[
    (SELECT pg_catalog.count(*) FROM viberacing_private.origin_nonces),
    (SELECT pg_catalog.count(*) FROM viberacing_private.device_nonces),
    (SELECT pg_catalog.count(*) FROM viberacing_private.usage_idempotency_records),
    (SELECT pg_catalog.count(*) FROM viberacing_private.usage_observations),
    (SELECT pg_catalog.count(*) FROM viberacing_private.ranking_events)
  ] OR (
    SELECT cumulative_token_total::text
    FROM viberacing_private.agent_account_day_totals
    WHERE agent_account_id = 'acc_AAAAAAAAAAAAAAAAAAAAAA'
      AND usage_date = v_current_date
  ) <> v_current_total THEN
    RAISE EXCEPTION 'late database failure left partial transaction state';
  END IF;

  BEGIN
    UPDATE viberacing_private.usage_observations
    SET outcome = 'duplicate'
    WHERE observation_id = 'obs_AAAAAAAAAAAAAAAAAAAAAA';
    RAISE EXCEPTION 'observation mutation unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  BEGIN
    UPDATE viberacing_private.agent_account_day_totals
    SET cumulative_token_total = cumulative_token_total - 1
    WHERE agent_account_id = 'acc_AAAAAAAAAAAAAAAAAAAAAA'
      AND usage_date = v_current_date;
    RAISE EXCEPTION 'direct account/day decrease unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  IF (
    SELECT retention_expires_at - created_at
    FROM viberacing_private.usage_idempotency_records
    WHERE device_key_id = 'key_AAAAAAAAAAAAAAAAAAAAAA'
      AND sync_id = 'syn_AAAAAAAAAAAAAAAAAAAAAA'
  ) < interval '45 days' THEN
    RAISE EXCEPTION 'idempotency retention is shorter than backfill plus safety margin';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM viberacing_private.ranking_events AS current_event
    LEFT JOIN viberacing_private.ranking_events AS previous_event
      ON previous_event.event_digest = current_event.previous_event_digest
    WHERE current_event.agent_account_id = 'acc_AAAAAAAAAAAAAAAAAAAAAA'
      AND current_event.previous_event_digest IS NOT NULL
      AND previous_event.event_id IS NULL
  ) THEN
    RAISE EXCEPTION 'ranking event digest chain is broken';
  END IF;
END
$late_failure_assertion$;

ROLLBACK;
