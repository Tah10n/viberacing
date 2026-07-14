\set ON_ERROR_STOP on

-- Every value below is a deterministic synthetic fixture. The transaction is always rolled back.

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

SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (
  profile_id,
  github_user_id,
  handle,
  state
)
VALUES
  (
    '00000000-0000-4000-8000-000000000101',
    900000000000000101,
    'alpha-pairing',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000000102',
    900000000000000102,
    'beta-pairing',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000000103',
    900000000000000103,
    'source-cap',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000000104',
    900000000000000104,
    'device-cap',
    'active'
  );

INSERT INTO viberacing_private.sessions (
  session_id,
  profile_id,
  verifier_digest,
  expires_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000101',
    pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour'
  ),
  (
    '00000000-0000-4000-8000-000000000202',
    '00000000-0000-4000-8000-000000000102',
    pg_catalog.decode(pg_catalog.repeat('a2', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour'
  ),
  (
    '00000000-0000-4000-8000-000000000203',
    '00000000-0000-4000-8000-000000000103',
    pg_catalog.decode(pg_catalog.repeat('a3', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour'
  ),
  (
    '00000000-0000-4000-8000-000000000204',
    '00000000-0000-4000-8000-000000000104',
    pg_catalog.decode(pg_catalog.repeat('a4', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour'
  );

INSERT INTO viberacing_private.passkeys (
  passkey_id,
  profile_id,
  credential_id,
  cose_public_key,
  label
)
VALUES
  (
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000101',
    pg_catalog.decode(pg_catalog.repeat('b1', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('c1', 64), 'hex'),
    'Alpha passkey'
  ),
  (
    '00000000-0000-4000-8000-000000000302',
    '00000000-0000-4000-8000-000000000102',
    pg_catalog.decode(pg_catalog.repeat('b2', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('c2', 64), 'hex'),
    'Beta passkey'
  ),
  (
    '00000000-0000-4000-8000-000000000303',
    '00000000-0000-4000-8000-000000000103',
    pg_catalog.decode(pg_catalog.repeat('b3', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('c3', 64), 'hex'),
    'Source cap passkey'
  ),
  (
    '00000000-0000-4000-8000-000000000304',
    '00000000-0000-4000-8000-000000000104',
    pg_catalog.decode(pg_catalog.repeat('b4', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('c4', 64), 'hex'),
    'Device cap passkey'
  );

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES
  (
    'src_' || pg_catalog.repeat('E', 22),
    '00000000-0000-4000-8000-000000000101'
  ),
  (
    'src_' || pg_catalog.repeat('D', 22),
    '00000000-0000-4000-8000-000000000104'
  );

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
SELECT
  'src_C' || pg_catalog.lpad(source_number::text, 21, '0'),
  '00000000-0000-4000-8000-000000000103'
FROM pg_catalog.generate_series(1, 32) AS generated_source(source_number);

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
SELECT
  (
    '00000000-0000-4000-8001-'
    || pg_catalog.lpad(device_number::text, 12, '0')
  )::uuid,
  'dev_' || pg_catalog.lpad(device_number::text, 22, '0'),
  'src_' || pg_catalog.repeat('D', 22),
  pg_catalog.decode(
    pg_catalog.lpad(pg_catalog.to_hex(1000 + device_number), 64, '0'),
    'hex'
  ),
  'Capacity connector ' || device_number,
  '1.0.0',
  'linux',
  'x86_64',
  'active',
  pg_catalog.statement_timestamp()
FROM pg_catalog.generate_series(1, 64) AS generated_device(device_number);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.start_pairing(
      '00000000-0000-4000-8000-000000009001',
      pg_catalog.decode(pg_catalog.repeat('90', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('91', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('92', 32), 'hex'),
      '00000000-0000-4000-8000-000000009002',
      pg_catalog.decode(pg_catalog.repeat('93', 32), 'hex'),
      'Oversized lifetime connector',
      '1.0.0',
      'linux',
      'x86_64',
      pg_catalog.statement_timestamp() + INTERVAL '11 minutes'
    )
  $sql$,
  'pairing lifetime has an absolute bound'
);

SELECT viberacing_api.start_pairing(
  '00000000-0000-4000-8000-000000001001',
  pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('12', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('13', 32), 'hex'),
  '00000000-0000-4000-8000-000000001101',
  pg_catalog.decode(pg_catalog.repeat('14', 32), 'hex'),
  'New source connector',
  '1.0.0',
  'linux',
  'x86_64',
  pg_catalog.statement_timestamp() + INTERVAL '10 minutes'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.start_pairing(
      '00000000-0000-4000-8000-000000009010',
      pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('9b', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('9c', 32), 'hex'),
      '00000000-0000-4000-8000-000000009011',
      pg_catalog.decode(pg_catalog.repeat('9d', 32), 'hex'),
      'Collision rollback connector',
      '1.0.0',
      'linux',
      'x86_64',
      pg_catalog.statement_timestamp() + INTERVAL '9 minutes'
    )
  $sql$,
  'a duplicate pairing verifier fails closed'
);

SELECT pg_temp.assert_true(
  (
    SELECT pairing_state = 'pending'
      AND source_id IS NULL
      AND device_id IS NULL
    FROM viberacing_api.poll_pairing_status(
      pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex')
    )
  ),
  'poll possession reveals only pending state before approval'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT *
    FROM viberacing_api.read_pairing_for_approval(
      '00000000-0000-4000-8000-000000000201',
      pg_catalog.decode(pg_catalog.repeat('ff', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('12', 32), 'hex')
    )
  $sql$,
  'pairing display requires possession of the exact active session'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(
        pairing_id = '00000000-0000-4000-8000-000000001001'
        AND device_label = 'New source connector'
        AND connector_version = '1.0.0'
        AND os_family = 'linux'
        AND architecture = 'x86_64'
        AND pg_catalog.octet_length(public_key) = 32
      )
    FROM viberacing_api.read_pairing_for_approval(
      '00000000-0000-4000-8000-000000000201',
      pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('12', 32), 'hex')
    )
  ),
  'authenticated display returns only bounded pending-key metadata'
);

SELECT viberacing_api.create_pairing_approval_challenge(
  '00000000-0000-4000-8000-000000000201',
  pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
  '00000000-0000-4000-8000-000000001001',
  pg_catalog.decode(pg_catalog.repeat('12', 32), 'hex'),
  'new',
  'src_' || pg_catalog.repeat('N', 22),
  '00000000-0000-4000-8000-000000001201',
  pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('22', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '5 minutes'
);

SELECT pg_temp.assert_true(
  NOT viberacing_api.consume_auth_challenge(
    '00000000-0000-4000-8000-000000000202',
    pg_catalog.decode(pg_catalog.repeat('a2', 32), 'hex'),
    '00000000-0000-4000-8000-000000001201',
    'pairing_approval',
    pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('22', 32), 'hex')
  ),
  'another profile session cannot consume the bound approval challenge'
);

SELECT pg_temp.assert_true(
  viberacing_api.consume_auth_challenge(
    '00000000-0000-4000-8000-000000000201',
    pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
    '00000000-0000-4000-8000-000000001201',
    'pairing_approval',
    pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('22', 32), 'hex')
  ),
  'the exact session consumes its pairing step-up once'
);

SELECT pg_temp.assert_true(
  NOT viberacing_api.consume_auth_challenge(
    '00000000-0000-4000-8000-000000000201',
    pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
    '00000000-0000-4000-8000-000000001201',
    'pairing_approval',
    pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('22', 32), 'hex')
  ),
  'pairing step-up replay is rejected'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.approve_pairing(
      '00000000-0000-4000-8000-000000000201',
      pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
      '00000000-0000-4000-8000-000000001001',
      '00000000-0000-4000-8000-000000001201',
      pg_catalog.decode(pg_catalog.repeat('ff', 32), 'hex'),
      '00000000-0000-4000-8000-000000001301',
      'req_' || pg_catalog.repeat('A', 22)
    )
  $sql$,
  'approval context cannot be swapped after WebAuthn verification'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT state = 'pending'
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '00000000-0000-4000-8000-000000001001'
  )
  AND (
    SELECT authorized_action_used_at IS NULL
    FROM viberacing_private.auth_challenges
    WHERE challenge_id = '00000000-0000-4000-8000-000000001201'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.codex_sources
    WHERE source_id = 'src_' || pg_catalog.repeat('N', 22)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.device_keys
    WHERE device_key_id = '00000000-0000-4000-8000-000000009011'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '00000000-0000-4000-8000-000000009010'
  ),
  'failed starts and approvals roll back keys, action claims, and source creation'
);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT viberacing_api.approve_pairing(
  '00000000-0000-4000-8000-000000000201',
  pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
  '00000000-0000-4000-8000-000000001001',
  '00000000-0000-4000-8000-000000001201',
  pg_catalog.decode(pg_catalog.repeat('22', 32), 'hex'),
  '00000000-0000-4000-8000-000000001301',
  'req_' || pg_catalog.repeat('A', 22)
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(
        pairing_id = '00000000-0000-4000-8000-000000001001'
        AND pairing_challenge = pg_catalog.decode(pg_catalog.repeat('13', 32), 'hex')
        AND public_key = pg_catalog.decode(pg_catalog.repeat('14', 32), 'hex')
      )
    FROM viberacing_api.read_pairing_verification_material(
      pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex')
    )
  ),
  'poll possession returns only the material needed for key-proof verification'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM viberacing_api.read_pairing_verification_material(
      pg_catalog.decode(pg_catalog.repeat('ff', 32), 'hex')
    )
  ),
  'wrong poll possession reveals no verification material'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.activate_pairing(
      pg_catalog.decode(pg_catalog.repeat('ff', 32), 'hex'),
      '00000000-0000-4000-8000-000000001001',
      'dev_' || pg_catalog.repeat('A', 22),
      '00000000-0000-4000-8000-000000001302',
      'req_' || pg_catalog.repeat('B', 22)
    )
  $sql$,
  'activation requires possession of the exact poll verifier'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.activate_pairing(
      pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex'),
      '00000000-0000-4000-8000-000000001001',
      'dev_' || pg_catalog.repeat('Q', 22),
      '00000000-0000-4000-8000-000000001301',
      'req_' || pg_catalog.repeat('Q', 22)
    )
  $sql$,
  'a duplicate audit reference rolls activation back atomically'
);

SELECT pg_temp.assert_true(
  (
    SELECT pairing_state = 'approved'
      AND source_id IS NULL
      AND device_id IS NULL
    FROM viberacing_api.poll_pairing_status(
      pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex')
    )
  ),
  'failed activation leaves the approved pairing without activation'
);

SELECT viberacing_api.activate_pairing(
  pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex'),
  '00000000-0000-4000-8000-000000001001',
  'dev_' || pg_catalog.repeat('A', 22),
  '00000000-0000-4000-8000-000000001302',
  'req_' || pg_catalog.repeat('B', 22)
);

SELECT pg_temp.assert_true(
  (
    SELECT pairing_state = 'activated'
      AND source_id = 'src_' || pg_catalog.repeat('N', 22)
      AND device_id = 'dev_' || pg_catalog.repeat('A', 22)
    FROM viberacing_api.poll_pairing_status(
      pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex')
    )
  ),
  'activated poll returns only the connector source and device identifiers'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.activate_pairing(
      pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex'),
      '00000000-0000-4000-8000-000000001001',
      'dev_' || pg_catalog.repeat('Z', 22),
      '00000000-0000-4000-8000-000000009011',
      'req_' || pg_catalog.repeat('Z', 22)
    )
  $sql$,
  'activated pairing cannot be replayed or rebound'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT state = 'active'
      AND source_id = 'src_' || pg_catalog.repeat('N', 22)
      AND device_id = 'dev_' || pg_catalog.repeat('A', 22)
    FROM viberacing_private.device_keys
    WHERE device_key_id = '00000000-0000-4000-8000-000000001101'
  )
  AND (
    SELECT state = 'activated'
      AND approved_profile_id = '00000000-0000-4000-8000-000000000101'
      AND approved_source_id = 'src_' || pg_catalog.repeat('N', 22)
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '00000000-0000-4000-8000-000000001001'
  ),
  'activation binds the exact pending key to one profile source and device'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    UPDATE viberacing_private.pairing_transactions
    SET approved_source_id = 'src_' || pg_catalog.repeat('E', 22)
    WHERE pairing_id = '00000000-0000-4000-8000-000000001001'
  $sql$,
  'approved pairing source binding is immutable after approval'
);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT viberacing_api.start_pairing(
  '00000000-0000-4000-8000-000000001002',
  pg_catalog.decode(pg_catalog.repeat('31', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('32', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('33', 32), 'hex'),
  '00000000-0000-4000-8000-000000001102',
  pg_catalog.decode(pg_catalog.repeat('34', 32), 'hex'),
  'Existing source connector',
  '1.0.1',
  'windows',
  'x86_64',
  pg_catalog.statement_timestamp() + INTERVAL '10 minutes'
);

SELECT viberacing_api.create_pairing_approval_challenge(
  '00000000-0000-4000-8000-000000000201',
  pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
  '00000000-0000-4000-8000-000000001002',
  pg_catalog.decode(pg_catalog.repeat('32', 32), 'hex'),
  'existing',
  'src_' || pg_catalog.repeat('E', 22),
  '00000000-0000-4000-8000-000000001202',
  pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('42', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '5 minutes'
);

SELECT pg_temp.assert_true(
  viberacing_api.consume_auth_challenge(
    '00000000-0000-4000-8000-000000000201',
    pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
    '00000000-0000-4000-8000-000000001202',
    'pairing_approval',
    pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('42', 32), 'hex')
  ),
  'existing-source approval challenge is consumed'
);

SELECT viberacing_api.approve_pairing(
  '00000000-0000-4000-8000-000000000201',
  pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
  '00000000-0000-4000-8000-000000001002',
  '00000000-0000-4000-8000-000000001202',
  pg_catalog.decode(pg_catalog.repeat('42', 32), 'hex'),
  '00000000-0000-4000-8000-000000001303',
  'req_' || pg_catalog.repeat('C', 22)
);

SELECT viberacing_api.activate_pairing(
  pg_catalog.decode(pg_catalog.repeat('31', 32), 'hex'),
  '00000000-0000-4000-8000-000000001002',
  'dev_' || pg_catalog.repeat('B', 22),
  '00000000-0000-4000-8000-000000001304',
  'req_' || pg_catalog.repeat('D', 22)
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 2
    FROM viberacing_private.codex_sources
    WHERE profile_id = '00000000-0000-4000-8000-000000000101'
  )
  AND (
    SELECT pg_catalog.count(*) = 1
    FROM viberacing_private.device_keys
    WHERE source_id = 'src_' || pg_catalog.repeat('E', 22)
      AND state = 'active'
  ),
  'another device can attach to an existing source without multiplying sources'
);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT viberacing_api.start_pairing(
  '00000000-0000-4000-8000-000000001003',
  pg_catalog.decode(pg_catalog.repeat('51', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('52', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('53', 32), 'hex'),
  '00000000-0000-4000-8000-000000001103',
  pg_catalog.decode(pg_catalog.repeat('54', 32), 'hex'),
  'Competing approval connector',
  '1.1.0',
  'macos',
  'aarch64',
  pg_catalog.statement_timestamp() + INTERVAL '10 minutes'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.create_pairing_approval_challenge(
      '00000000-0000-4000-8000-000000000202',
      pg_catalog.decode(pg_catalog.repeat('a2', 32), 'hex'),
      '00000000-0000-4000-8000-000000001003',
      pg_catalog.decode(pg_catalog.repeat('52', 32), 'hex'),
      'existing',
      'src_' || pg_catalog.repeat('E', 22),
      '00000000-0000-4000-8000-000000009021',
      pg_catalog.decode(pg_catalog.repeat('94', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('95', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '5 minutes'
    )
  $sql$,
  'a profile cannot select another profile source'
);

SELECT viberacing_api.create_pairing_approval_challenge(
  '00000000-0000-4000-8000-000000000201',
  pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
  '00000000-0000-4000-8000-000000001003',
  pg_catalog.decode(pg_catalog.repeat('52', 32), 'hex'),
  'new',
  'src_' || pg_catalog.repeat('R', 22),
  '00000000-0000-4000-8000-000000001203',
  pg_catalog.decode(pg_catalog.repeat('61', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('62', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '5 minutes'
);

SELECT viberacing_api.create_pairing_approval_challenge(
  '00000000-0000-4000-8000-000000000202',
  pg_catalog.decode(pg_catalog.repeat('a2', 32), 'hex'),
  '00000000-0000-4000-8000-000000001003',
  pg_catalog.decode(pg_catalog.repeat('52', 32), 'hex'),
  'new',
  'src_' || pg_catalog.repeat('S', 22),
  '00000000-0000-4000-8000-000000001204',
  pg_catalog.decode(pg_catalog.repeat('63', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('64', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '5 minutes'
);

SELECT pg_temp.assert_true(
  viberacing_api.consume_auth_challenge(
    '00000000-0000-4000-8000-000000000201',
    pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
    '00000000-0000-4000-8000-000000001203',
    'pairing_approval',
    pg_catalog.decode(pg_catalog.repeat('61', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('62', 32), 'hex')
  )
  AND viberacing_api.consume_auth_challenge(
    '00000000-0000-4000-8000-000000000202',
    pg_catalog.decode(pg_catalog.repeat('a2', 32), 'hex'),
    '00000000-0000-4000-8000-000000001204',
    'pairing_approval',
    pg_catalog.decode(pg_catalog.repeat('63', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('64', 32), 'hex')
  ),
  'competing profiles can each verify only their own step-up'
);

SELECT viberacing_api.approve_pairing(
  '00000000-0000-4000-8000-000000000201',
  pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
  '00000000-0000-4000-8000-000000001003',
  '00000000-0000-4000-8000-000000001203',
  pg_catalog.decode(pg_catalog.repeat('62', 32), 'hex'),
  '00000000-0000-4000-8000-000000001305',
  'req_' || pg_catalog.repeat('E', 22)
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.approve_pairing(
      '00000000-0000-4000-8000-000000000202',
      pg_catalog.decode(pg_catalog.repeat('a2', 32), 'hex'),
      '00000000-0000-4000-8000-000000001003',
      '00000000-0000-4000-8000-000000001204',
      pg_catalog.decode(pg_catalog.repeat('64', 32), 'hex'),
      '00000000-0000-4000-8000-000000009022',
      'req_' || pg_catalog.repeat('Y', 22)
    )
  $sql$,
  'only the first approved profile can win one pairing transaction'
);

SELECT viberacing_api.activate_pairing(
  pg_catalog.decode(pg_catalog.repeat('51', 32), 'hex'),
  '00000000-0000-4000-8000-000000001003',
  'dev_' || pg_catalog.repeat('C', 22),
  '00000000-0000-4000-8000-000000001306',
  'req_' || pg_catalog.repeat('F', 22)
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT approved_profile_id = '00000000-0000-4000-8000-000000000101'
      AND approved_source_id = 'src_' || pg_catalog.repeat('R', 22)
      AND state = 'activated'
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '00000000-0000-4000-8000-000000001003'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.codex_sources
    WHERE source_id = 'src_' || pg_catalog.repeat('S', 22)
  )
  AND (
    SELECT authorized_action_used_at IS NULL
    FROM viberacing_private.auth_challenges
    WHERE challenge_id = '00000000-0000-4000-8000-000000001204'
  ),
  'losing approval leaves no source, authority, or consumed action claim'
);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT viberacing_api.start_pairing(
  '00000000-0000-4000-8000-000000001004',
  pg_catalog.decode(pg_catalog.repeat('71', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('72', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('73', 32), 'hex'),
  '00000000-0000-4000-8000-000000001104',
  pg_catalog.decode(pg_catalog.repeat('74', 32), 'hex'),
  'Source cap connector',
  '2.0.0',
  'linux',
  'x86_64',
  pg_catalog.statement_timestamp() + INTERVAL '10 minutes'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.create_pairing_approval_challenge(
      '00000000-0000-4000-8000-000000000203',
      pg_catalog.decode(pg_catalog.repeat('a3', 32), 'hex'),
      '00000000-0000-4000-8000-000000001004',
      pg_catalog.decode(pg_catalog.repeat('72', 32), 'hex'),
      'new',
      'src_' || pg_catalog.repeat('T', 22),
      '00000000-0000-4000-8000-000000009031',
      pg_catalog.decode(pg_catalog.repeat('96', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('97', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '5 minutes'
    )
  $sql$,
  'the public absolute source ceiling is enforced'
);

SELECT viberacing_api.start_pairing(
  '00000000-0000-4000-8000-000000001005',
  pg_catalog.decode(pg_catalog.repeat('81', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('83', 32), 'hex'),
  '00000000-0000-4000-8000-000000001105',
  pg_catalog.decode(pg_catalog.repeat('84', 32), 'hex'),
  'Device cap connector',
  '2.0.0',
  'linux',
  'x86_64',
  pg_catalog.statement_timestamp() + INTERVAL '10 minutes'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.create_pairing_approval_challenge(
      '00000000-0000-4000-8000-000000000204',
      pg_catalog.decode(pg_catalog.repeat('a4', 32), 'hex'),
      '00000000-0000-4000-8000-000000001005',
      pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
      'existing',
      'src_' || pg_catalog.repeat('D', 22),
      '00000000-0000-4000-8000-000000009032',
      pg_catalog.decode(pg_catalog.repeat('98', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('99', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '5 minutes'
    )
  $sql$,
  'the public absolute active-device ceiling is enforced'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 6
      AND pg_catalog.count(*) FILTER (WHERE event_type = 'pairing.approved') = 3
      AND pg_catalog.count(*) FILTER (WHERE event_type = 'device.activated') = 3
    FROM viberacing_private.audit_events
  ),
  'each successful approval and activation has one bounded audit reference'
);

ROLLBACK;
