\set ON_ERROR_STOP on

-- Deterministic synthetic fixtures for cross-connection pairing races. This file commits only to
-- the isolated, portless, tmpfs-backed PostgreSQL integration project, which is destroyed in the
-- runner's finally block. It must never be pointed at a shared database.

BEGIN;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (
  profile_id,
  github_user_id,
  handle,
  state
)
VALUES
  (
    '00000000-0000-4000-8000-000000008101',
    900000000000008101,
    'race-alpha',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000008102',
    900000000000008102,
    'race-beta',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000008103',
    900000000000008103,
    'race-source-cap',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000008104',
    900000000000008104,
    'race-device-cap',
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
    '00000000-0000-4000-8000-000000008201',
    '00000000-0000-4000-8000-000000008101',
    pg_catalog.decode(pg_catalog.repeat('81', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour'
  ),
  (
    '00000000-0000-4000-8000-000000008202',
    '00000000-0000-4000-8000-000000008102',
    pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour'
  ),
  (
    '00000000-0000-4000-8000-000000008203',
    '00000000-0000-4000-8000-000000008103',
    pg_catalog.decode(pg_catalog.repeat('83', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour'
  ),
  (
    '00000000-0000-4000-8000-000000008204',
    '00000000-0000-4000-8000-000000008103',
    pg_catalog.decode(pg_catalog.repeat('84', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour'
  ),
  (
    '00000000-0000-4000-8000-000000008205',
    '00000000-0000-4000-8000-000000008104',
    pg_catalog.decode(pg_catalog.repeat('85', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour'
  ),
  (
    '00000000-0000-4000-8000-000000008206',
    '00000000-0000-4000-8000-000000008104',
    pg_catalog.decode(pg_catalog.repeat('86', 32), 'hex'),
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
    '00000000-0000-4000-8000-000000008301',
    '00000000-0000-4000-8000-000000008101',
    pg_catalog.decode(pg_catalog.repeat('b1', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('c1', 64), 'hex'),
    'Concurrency alpha passkey'
  ),
  (
    '00000000-0000-4000-8000-000000008302',
    '00000000-0000-4000-8000-000000008102',
    pg_catalog.decode(pg_catalog.repeat('b2', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('c2', 64), 'hex'),
    'Concurrency beta passkey'
  ),
  (
    '00000000-0000-4000-8000-000000008303',
    '00000000-0000-4000-8000-000000008103',
    pg_catalog.decode(pg_catalog.repeat('b3', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('c3', 64), 'hex'),
    'Source ceiling passkey'
  ),
  (
    '00000000-0000-4000-8000-000000008304',
    '00000000-0000-4000-8000-000000008104',
    pg_catalog.decode(pg_catalog.repeat('b4', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('c4', 64), 'hex'),
    'Device ceiling passkey'
  );

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
SELECT
  'src_Q' || pg_catalog.lpad(source_number::text, 21, '0'),
  '00000000-0000-4000-8000-000000008103'
FROM pg_catalog.generate_series(1, 31) AS generated_source(source_number);

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES (
  'src_' || pg_catalog.repeat('V', 22),
  '00000000-0000-4000-8000-000000008104'
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
SELECT
  (
    '00000000-0000-4000-8002-'
    || pg_catalog.lpad(device_number::text, 12, '0')
  )::uuid,
  'dev_V' || pg_catalog.lpad(device_number::text, 21, '0'),
  'src_' || pg_catalog.repeat('V', 22),
  pg_catalog.decode(
    pg_catalog.lpad(pg_catalog.to_hex(2000 + device_number), 64, '0'),
    'hex'
  ),
  'Concurrent capacity connector ' || device_number,
  '3.0.0',
  'linux',
  'x86_64',
  'active',
  pg_catalog.statement_timestamp()
FROM pg_catalog.generate_series(1, 63) AS generated_device(device_number);

-- This expired approval is deliberately retained. It has no activation authority and therefore
-- must not consume one of the 64 live authority slots.
INSERT INTO viberacing_private.device_keys (
  device_key_id,
  public_key,
  label,
  connector_version,
  os_family,
  architecture,
  state,
  created_at
)
VALUES (
  '00000000-0000-4000-8000-000000008490',
  pg_catalog.decode(pg_catalog.repeat('e0', 32), 'hex'),
  'Expired approval connector',
  '3.0.0',
  'linux',
  'x86_64',
  'pending',
  pg_catalog.statement_timestamp() - INTERVAL '10 minutes'
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
  state,
  approved_profile_id,
  source_choice,
  approved_source_id,
  approved_by_session_id,
  approved_by_passkey_id,
  created_at,
  expires_at,
  approved_at
)
VALUES (
  '00000000-0000-4000-8000-000000008491',
  pg_catalog.decode(pg_catalog.repeat('e1', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('e2', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('e3', 32), 'hex'),
  '00000000-0000-4000-8000-000000008490',
  'Expired approval connector',
  '3.0.0',
  'linux',
  'x86_64',
  'approved',
  '00000000-0000-4000-8000-000000008104',
  'existing',
  'src_' || pg_catalog.repeat('V', 22),
  '00000000-0000-4000-8000-000000008205',
  '00000000-0000-4000-8000-000000008304',
  pg_catalog.statement_timestamp() - INTERVAL '10 minutes',
  pg_catalog.statement_timestamp() - INTERVAL '5 minutes',
  pg_catalog.statement_timestamp() - INTERVAL '9 minutes'
);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT viberacing_api.start_pairing(
  '00000000-0000-4000-8000-000000008501',
  pg_catalog.decode(pg_catalog.repeat('01', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('02', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('03', 32), 'hex'),
  '00000000-0000-4000-8000-000000008601',
  pg_catalog.decode(pg_catalog.repeat('04', 32), 'hex'),
  'Competing race connector',
  '3.1.0',
  'macos',
  'aarch64',
  pg_catalog.statement_timestamp() + INTERVAL '9 minutes'
);

SELECT viberacing_api.start_pairing(
  '00000000-0000-4000-8000-000000008502',
  pg_catalog.decode(pg_catalog.repeat('05', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('06', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('07', 32), 'hex'),
  '00000000-0000-4000-8000-000000008602',
  pg_catalog.decode(pg_catalog.repeat('08', 32), 'hex'),
  'Source ceiling connector A',
  '3.1.0',
  'linux',
  'x86_64',
  pg_catalog.statement_timestamp() + INTERVAL '9 minutes'
);

SELECT viberacing_api.start_pairing(
  '00000000-0000-4000-8000-000000008503',
  pg_catalog.decode(pg_catalog.repeat('09', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('0a', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('0b', 32), 'hex'),
  '00000000-0000-4000-8000-000000008603',
  pg_catalog.decode(pg_catalog.repeat('0c', 32), 'hex'),
  'Source ceiling connector B',
  '3.1.0',
  'linux',
  'x86_64',
  pg_catalog.statement_timestamp() + INTERVAL '9 minutes'
);

SELECT viberacing_api.start_pairing(
  '00000000-0000-4000-8000-000000008504',
  pg_catalog.decode(pg_catalog.repeat('0d', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('0e', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('0f', 32), 'hex'),
  '00000000-0000-4000-8000-000000008604',
  pg_catalog.decode(pg_catalog.repeat('10', 32), 'hex'),
  'Device ceiling connector A',
  '3.1.0',
  'windows',
  'x86_64',
  pg_catalog.statement_timestamp() + INTERVAL '9 minutes'
);

SELECT viberacing_api.start_pairing(
  '00000000-0000-4000-8000-000000008505',
  pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('12', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('13', 32), 'hex'),
  '00000000-0000-4000-8000-000000008605',
  pg_catalog.decode(pg_catalog.repeat('14', 32), 'hex'),
  'Device ceiling connector B',
  '3.1.0',
  'windows',
  'x86_64',
  pg_catalog.statement_timestamp() + INTERVAL '9 minutes'
);

SELECT viberacing_api.create_pairing_approval_challenge(
  '00000000-0000-4000-8000-000000008201',
  pg_catalog.decode(pg_catalog.repeat('81', 32), 'hex'),
  '00000000-0000-4000-8000-000000008501',
  pg_catalog.decode(pg_catalog.repeat('02', 32), 'hex'),
  'new',
  'src_' || pg_catalog.repeat('A', 22),
  '00000000-0000-4000-8000-000000008701',
  pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('22', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
);

SELECT viberacing_api.create_pairing_approval_challenge(
  '00000000-0000-4000-8000-000000008202',
  pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
  '00000000-0000-4000-8000-000000008501',
  pg_catalog.decode(pg_catalog.repeat('02', 32), 'hex'),
  'new',
  'src_' || pg_catalog.repeat('B', 22),
  '00000000-0000-4000-8000-000000008702',
  pg_catalog.decode(pg_catalog.repeat('23', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('24', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
);

SELECT viberacing_api.create_pairing_approval_challenge(
  '00000000-0000-4000-8000-000000008203',
  pg_catalog.decode(pg_catalog.repeat('83', 32), 'hex'),
  '00000000-0000-4000-8000-000000008502',
  pg_catalog.decode(pg_catalog.repeat('06', 32), 'hex'),
  'new',
  'src_' || pg_catalog.repeat('X', 22),
  '00000000-0000-4000-8000-000000008703',
  pg_catalog.decode(pg_catalog.repeat('25', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('26', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
);

SELECT viberacing_api.create_pairing_approval_challenge(
  '00000000-0000-4000-8000-000000008204',
  pg_catalog.decode(pg_catalog.repeat('84', 32), 'hex'),
  '00000000-0000-4000-8000-000000008503',
  pg_catalog.decode(pg_catalog.repeat('0a', 32), 'hex'),
  'new',
  'src_' || pg_catalog.repeat('Y', 22),
  '00000000-0000-4000-8000-000000008704',
  pg_catalog.decode(pg_catalog.repeat('27', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('28', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
);

SELECT viberacing_api.create_pairing_approval_challenge(
  '00000000-0000-4000-8000-000000008205',
  pg_catalog.decode(pg_catalog.repeat('85', 32), 'hex'),
  '00000000-0000-4000-8000-000000008504',
  pg_catalog.decode(pg_catalog.repeat('0e', 32), 'hex'),
  'existing',
  'src_' || pg_catalog.repeat('V', 22),
  '00000000-0000-4000-8000-000000008705',
  pg_catalog.decode(pg_catalog.repeat('29', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('2a', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
);

SELECT viberacing_api.create_pairing_approval_challenge(
  '00000000-0000-4000-8000-000000008206',
  pg_catalog.decode(pg_catalog.repeat('86', 32), 'hex'),
  '00000000-0000-4000-8000-000000008505',
  pg_catalog.decode(pg_catalog.repeat('12', 32), 'hex'),
  'existing',
  'src_' || pg_catalog.repeat('V', 22),
  '00000000-0000-4000-8000-000000008706',
  pg_catalog.decode(pg_catalog.repeat('2b', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('2c', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
);

SELECT viberacing_api.consume_passkey_challenge(
  '00000000-0000-4000-8000-000000008201',
  pg_catalog.decode(pg_catalog.repeat('81', 32), 'hex'),
  '00000000-0000-4000-8000-000000008701',
  'pairing_approval',
  pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('22', 32), 'hex'),
  '00000000-0000-4000-8000-000000008301',
  0,
  false
);

SELECT viberacing_api.consume_passkey_challenge(
  '00000000-0000-4000-8000-000000008202',
  pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
  '00000000-0000-4000-8000-000000008702',
  'pairing_approval',
  pg_catalog.decode(pg_catalog.repeat('23', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('24', 32), 'hex'),
  '00000000-0000-4000-8000-000000008302',
  0,
  false
);

SELECT viberacing_api.consume_passkey_challenge(
  '00000000-0000-4000-8000-000000008203',
  pg_catalog.decode(pg_catalog.repeat('83', 32), 'hex'),
  '00000000-0000-4000-8000-000000008703',
  'pairing_approval',
  pg_catalog.decode(pg_catalog.repeat('25', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('26', 32), 'hex'),
  '00000000-0000-4000-8000-000000008303',
  0,
  false
);

SELECT viberacing_api.consume_passkey_challenge(
  '00000000-0000-4000-8000-000000008204',
  pg_catalog.decode(pg_catalog.repeat('84', 32), 'hex'),
  '00000000-0000-4000-8000-000000008704',
  'pairing_approval',
  pg_catalog.decode(pg_catalog.repeat('27', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('28', 32), 'hex'),
  '00000000-0000-4000-8000-000000008303',
  0,
  false
);

SELECT viberacing_api.consume_passkey_challenge(
  '00000000-0000-4000-8000-000000008205',
  pg_catalog.decode(pg_catalog.repeat('85', 32), 'hex'),
  '00000000-0000-4000-8000-000000008705',
  'pairing_approval',
  pg_catalog.decode(pg_catalog.repeat('29', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('2a', 32), 'hex'),
  '00000000-0000-4000-8000-000000008304',
  0,
  false
);

SELECT viberacing_api.consume_passkey_challenge(
  '00000000-0000-4000-8000-000000008206',
  pg_catalog.decode(pg_catalog.repeat('86', 32), 'hex'),
  '00000000-0000-4000-8000-000000008706',
  'pairing_approval',
  pg_catalog.decode(pg_catalog.repeat('2b', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('2c', 32), 'hex'),
  '00000000-0000-4000-8000-000000008304',
  0,
  false
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

DO $assertion$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.auth_challenges
    WHERE challenge_id IN (
      '00000000-0000-4000-8000-000000008701',
      '00000000-0000-4000-8000-000000008702',
      '00000000-0000-4000-8000-000000008703',
      '00000000-0000-4000-8000-000000008704',
      '00000000-0000-4000-8000-000000008705',
      '00000000-0000-4000-8000-000000008706'
    )
      AND consumed_at IS NOT NULL
      AND authorized_action_used_at IS NULL
  ) <> 6 THEN
    RAISE EXCEPTION 'concurrency setup did not consume every synthetic challenge';
  END IF;
END
$assertion$;

COMMIT;
