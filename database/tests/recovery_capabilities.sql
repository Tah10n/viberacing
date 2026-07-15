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

INSERT INTO viberacing_private.profiles (profile_id, github_user_id, handle, state)
VALUES
  (
    '00000000-0000-4000-8000-000000006101',
    900000000000006101,
    'recovery-alpha',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000006102',
    900000000000006102,
    'recovery-beta',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000006103',
    900000000000006103,
    'recovery-cap',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000006104',
    900000000000006104,
    'recovery-delete',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000006105',
    900000000000006105,
    'recovery-rotate',
    'active'
  );

INSERT INTO viberacing_private.passkeys (
  passkey_id,
  profile_id,
  credential_id,
  cose_public_key,
  label,
  sign_count,
  backup_eligible,
  backup_state
)
VALUES
  (
    '00000000-0000-4000-8000-000000006301',
    '00000000-0000-4000-8000-000000006101',
    pg_catalog.decode(pg_catalog.repeat('31', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('41', 64), 'hex'),
    'Alpha primary key',
    2,
    true,
    false
  ),
  (
    '00000000-0000-4000-8000-000000006302',
    '00000000-0000-4000-8000-000000006101',
    pg_catalog.decode(pg_catalog.repeat('32', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('42', 64), 'hex'),
    'Alpha backup key',
    1,
    false,
    false
  ),
  (
    '00000000-0000-4000-8000-000000006303',
    '00000000-0000-4000-8000-000000006102',
    pg_catalog.decode(pg_catalog.repeat('33', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('43', 64), 'hex'),
    'Beta key',
    0,
    false,
    false
  ),
  (
    '00000000-0000-4000-8000-000000006304',
    '00000000-0000-4000-8000-000000006104',
    pg_catalog.decode(pg_catalog.repeat('34', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('44', 64), 'hex'),
    'Deletion key',
    0,
    false,
    false
  ),
  (
    '00000000-0000-4000-8000-000000006305',
    '00000000-0000-4000-8000-000000006105',
    pg_catalog.decode(pg_catalog.repeat('35', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('45', 64), 'hex'),
    'Rotation key',
    0,
    false,
    false
  );

INSERT INTO viberacing_private.passkeys (
  passkey_id,
  profile_id,
  credential_id,
  cose_public_key,
  label,
  state,
  revoked_at
)
SELECT
  ('00000000-0000-4000-8063-' || pg_catalog.lpad(key_number::text, 12, '0'))::uuid,
  '00000000-0000-4000-8000-000000006103',
  pg_catalog.decode(pg_catalog.lpad(pg_catalog.to_hex(16000 + key_number), 32, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad(pg_catalog.to_hex(26000 + key_number), 64, '0'), 'hex'),
  'Recovery cap key ' || key_number,
  CASE WHEN key_number = 1 THEN 'active' ELSE 'revoked' END,
  CASE WHEN key_number = 1 THEN NULL ELSE pg_catalog.statement_timestamp() END
FROM pg_catalog.generate_series(1, 32) AS generated_key(key_number);

INSERT INTO viberacing_private.sessions (
  session_id,
  profile_id,
  verifier_digest,
  expires_at,
  authentication_kind,
  authenticated_by_passkey_id
)
VALUES
  (
    '00000000-0000-4000-8000-000000006201',
    '00000000-0000-4000-8000-000000006101',
    pg_catalog.decode(pg_catalog.repeat('51', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour',
    'passkey',
    '00000000-0000-4000-8000-000000006301'
  ),
  (
    '00000000-0000-4000-8000-000000006202',
    '00000000-0000-4000-8000-000000006102',
    pg_catalog.decode(pg_catalog.repeat('52', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour',
    'passkey',
    '00000000-0000-4000-8000-000000006303'
  ),
  (
    '00000000-0000-4000-8000-000000006204',
    '00000000-0000-4000-8000-000000006104',
    pg_catalog.decode(pg_catalog.repeat('54', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour',
    'passkey',
    '00000000-0000-4000-8000-000000006304'
  ),
  (
    '00000000-0000-4000-8000-000000006205',
    '00000000-0000-4000-8000-000000006105',
    pg_catalog.decode(pg_catalog.repeat('55', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour',
    'passkey',
    '00000000-0000-4000-8000-000000006305'
  );

INSERT INTO viberacing_private.codex_sources (
  source_id,
  profile_id,
  state
)
VALUES (
  'src_' || pg_catalog.repeat('R', 22),
  '00000000-0000-4000-8000-000000006101',
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
  activated_at
)
VALUES (
  '00000000-0000-4000-8000-000000006401',
  'dev_' || pg_catalog.repeat('R', 22),
  'src_' || pg_catalog.repeat('R', 22),
  pg_catalog.decode(pg_catalog.repeat('61', 32), 'hex'),
  'Activated recovery fixture',
  '0.0.0-test',
  'linux',
  'x86_64',
  'active',
  pg_catalog.statement_timestamp()
);

INSERT INTO viberacing_private.device_keys (
  device_key_id,
  public_key,
  label,
  connector_version,
  os_family,
  architecture
)
VALUES (
  '00000000-0000-4000-8000-000000006402',
  pg_catalog.decode(pg_catalog.repeat('62', 32), 'hex'),
  'Pending recovery fixture',
  '0.0.0-test',
  'linux',
  'x86_64'
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
  expires_at,
  approved_at
)
VALUES (
  '00000000-0000-4000-8000-000000006501',
  pg_catalog.decode(pg_catalog.repeat('71', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('72', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('73', 32), 'hex'),
  '00000000-0000-4000-8000-000000006402',
  'Pending recovery fixture',
  '0.0.0-test',
  'linux',
  'x86_64',
  'approved',
  '00000000-0000-4000-8000-000000006101',
  'existing',
  'src_' || pg_catalog.repeat('R', 22),
  '00000000-0000-4000-8000-000000006201',
  '00000000-0000-4000-8000-000000006301',
  pg_catalog.statement_timestamp() + INTERVAL '5 minutes',
  pg_catalog.statement_timestamp()
);

INSERT INTO viberacing_private.auth_challenges (
  challenge_id,
  profile_id,
  session_id,
  purpose,
  challenge_digest,
  context_digest,
  authorized_passkey_action,
  expires_at
)
VALUES (
  '00000000-0000-4000-8000-000000006809',
  '00000000-0000-4000-8000-000000006101',
  '00000000-0000-4000-8000-000000006201',
  'passkey_change',
  pg_catalog.decode(pg_catalog.repeat('74', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('75', 32), 'hex'),
  'add',
  pg_catalog.statement_timestamp() + INTERVAL '5 minutes'
);

INSERT INTO viberacing_private.recovery_codes (
  recovery_code_id,
  profile_id,
  batch_id,
  position,
  verifier_phc
)
VALUES
  (
    '00000000-0000-4000-8000-000000006701',
    '00000000-0000-4000-8000-000000006101',
    '00000000-0000-4000-8000-000000006601',
    0,
    '$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$' || pg_catalog.repeat('a', 32)
  ),
  (
    '00000000-0000-4000-8000-000000006702',
    '00000000-0000-4000-8000-000000006102',
    '00000000-0000-4000-8000-000000006602',
    0,
    '$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$' || pg_catalog.repeat('b', 32)
  ),
  (
    '00000000-0000-4000-8000-000000006703',
    '00000000-0000-4000-8000-000000006103',
    '00000000-0000-4000-8000-000000006603',
    0,
    '$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$' || pg_catalog.repeat('c', 32)
  ),
  (
    '00000000-0000-4000-8000-000000006704',
    '00000000-0000-4000-8000-000000006104',
    '00000000-0000-4000-8000-000000006604',
    0,
    '$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$' || pg_catalog.repeat('d', 32)
  ),
  (
    '00000000-0000-4000-8000-000000006705',
    '00000000-0000-4000-8000-000000006105',
    '00000000-0000-4000-8000-000000006605',
    0,
    '$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$' || pg_catalog.repeat('e', 32)
  ),
  (
    '00000000-0000-4000-8000-000000006706',
    '00000000-0000-4000-8000-000000006105',
    '00000000-0000-4000-8000-000000006605',
    1,
    '$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$' || pg_catalog.repeat('f', 32)
  );

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT viberacing_api.create_recovery_change_challenge(
  '00000000-0000-4000-8000-000000006201',
  pg_catalog.decode(pg_catalog.repeat('51', 32), 'hex'),
  '00000000-0000-4000-8000-000000006801',
  pg_catalog.decode(pg_catalog.repeat('81', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '5 minutes'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.consume_passkey_challenge(
      '00000000-0000-4000-8000-000000006201',
      pg_catalog.decode(pg_catalog.repeat('51', 32), 'hex'),
      '00000000-0000-4000-8000-000000006801',
      'recovery_change',
      pg_catalog.decode(pg_catalog.repeat('81', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
      '00000000-0000-4000-8000-000000006303',
      1,
      false
    )
  $sql$,
  'another profile passkey cannot authorize recovery-code replacement'
);

SELECT pg_temp.assert_true(
  viberacing_api.consume_passkey_challenge(
    '00000000-0000-4000-8000-000000006201',
    pg_catalog.decode(pg_catalog.repeat('51', 32), 'hex'),
    '00000000-0000-4000-8000-000000006801',
    'recovery_change',
    pg_catalog.decode(pg_catalog.repeat('81', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
    '00000000-0000-4000-8000-000000006302',
    2,
    false
  ),
  'an exact active passkey records fresh recovery-change provenance'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.replace_recovery_codes(
      '00000000-0000-4000-8000-000000006201',
      pg_catalog.decode(pg_catalog.repeat('51', 32), 'hex'),
      '00000000-0000-4000-8000-000000006801',
      pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
      '00000000-0000-4000-8000-000000006602',
      ARRAY(
        SELECT ('00000000-0000-4000-8006-' || pg_catalog.lpad((7100 + value)::text, 12, '0'))::uuid
        FROM pg_catalog.generate_series(1, 7) AS generated(value)
      ),
      ARRAY(
        SELECT '$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$' || pg_catalog.repeat('g', 31) || value
        FROM pg_catalog.generate_series(1, 7) AS generated(value)
      ),
      '00000000-0000-4000-8000-000000006901',
      'req_' || pg_catalog.repeat('A', 22)
    )
  $sql$,
  'recovery-code batches below the public minimum fail before claiming step-up'
);

SELECT viberacing_api.replace_recovery_codes(
  '00000000-0000-4000-8000-000000006201',
  pg_catalog.decode(pg_catalog.repeat('51', 32), 'hex'),
  '00000000-0000-4000-8000-000000006801',
  pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
  '00000000-0000-4000-8000-000000006607',
  ARRAY(
    SELECT ('00000000-0000-4000-8006-' || pg_catalog.lpad((7100 + value)::text, 12, '0'))::uuid
    FROM pg_catalog.generate_series(1, 8) AS generated(value)
  ),
  ARRAY(
    SELECT '$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$' || pg_catalog.repeat('h', 31) || value
    FROM pg_catalog.generate_series(1, 8) AS generated(value)
  ),
  '00000000-0000-4000-8000-000000006902',
  'req_' || pg_catalog.repeat('B', 22)
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 8
      AND pg_catalog.min(position) = 0
      AND pg_catalog.max(position) = 7
      AND pg_catalog.bool_and(verifier_phc IS NOT NULL AND used_at IS NULL)
    FROM viberacing_private.recovery_codes
    WHERE profile_id = '00000000-0000-4000-8000-000000006101'
      AND batch_id = '00000000-0000-4000-8000-000000006607'
  )
    AND NOT EXISTS (
      SELECT 1
      FROM viberacing_private.recovery_codes
      WHERE recovery_code_id = '00000000-0000-4000-8000-000000006701'
    ),
  'fresh step-up atomically replaces the complete bounded recovery-code batch'
);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.replace_recovery_codes(
      '00000000-0000-4000-8000-000000006201',
      pg_catalog.decode(pg_catalog.repeat('51', 32), 'hex'),
      '00000000-0000-4000-8000-000000006801',
      pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
      '00000000-0000-4000-8000-000000006608',
      ARRAY(
        SELECT ('00000000-0000-4000-8006-' || pg_catalog.lpad((7200 + value)::text, 12, '0'))::uuid
        FROM pg_catalog.generate_series(1, 8) AS generated(value)
      ),
      ARRAY(
        SELECT '$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$' || pg_catalog.repeat('i', 31) || value
        FROM pg_catalog.generate_series(1, 8) AS generated(value)
      ),
      '00000000-0000-4000-8000-000000006903',
      'req_' || pg_catalog.repeat('C', 22)
    )
  $sql$,
  'recovery-code replacement authorization is one-time'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(
        recovery_code_id = '00000000-0000-4000-8006-000000007101'
        AND verifier_phc = '$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$' || pg_catalog.repeat('h', 31) || '1'
      )
    FROM viberacing_api.read_recovery_code_verification_material(
      '00000000-0000-4000-8006-000000007101'
    )
  )
    AND NOT EXISTS (
      SELECT 1
      FROM viberacing_api.read_recovery_code_verification_material(
        '00000000-0000-4000-8000-000000009999'
      )
    ),
  'verification lookup returns only the selected unused opaque code and PHC material'
);

SELECT viberacing_api.start_recovery(
  '00000000-0000-4000-8006-000000007101',
  '00000000-0000-4000-8000-000000006911',
  pg_catalog.decode(pg_catalog.repeat('91', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('92', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('93', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '5 minutes',
  '00000000-0000-4000-8000-000000006904',
  'req_' || pg_catalog.repeat('D', 22)
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM viberacing_private.recovery_codes
    WHERE recovery_code_id = '00000000-0000-4000-8006-000000007101'
      AND used_at IS NOT NULL
      AND verifier_phc IS NULL
  )
    AND EXISTS (
      SELECT 1
      FROM viberacing_private.recovery_authorities
      WHERE recovery_authority_id = '00000000-0000-4000-8000-000000006911'
        AND profile_id = '00000000-0000-4000-8000-000000006101'
        AND source_recovery_code_id = '00000000-0000-4000-8006-000000007101'
        AND state = 'active'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM viberacing_private.sessions
      WHERE session_id = '00000000-0000-4000-8000-000000006911'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM viberacing_api.read_recovery_code_verification_material(
        '00000000-0000-4000-8006-000000007101'
      )
    ),
  'recovery start scrubs one code and creates only restricted short-lived authority'
);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.start_recovery(
      '00000000-0000-4000-8006-000000007101',
      '00000000-0000-4000-8000-000000006912',
      pg_catalog.decode(pg_catalog.repeat('94', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('95', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('96', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '5 minutes',
      '00000000-0000-4000-8000-000000006905',
      'req_' || pg_catalog.repeat('E', 22)
    )
  $sql$,
  'one recovery code cannot start a second authority'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.complete_recovery_registration(
      '00000000-0000-4000-8000-000000006911',
      pg_catalog.decode(pg_catalog.repeat('91', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('92', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('ff', 32), 'hex'),
      '00000000-0000-4000-8000-000000006311',
      pg_catalog.decode(pg_catalog.repeat('36', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('46', 64), 'hex'),
      'Unbound recovery key',
      0,
      false,
      false,
      '00000000-0000-4000-8000-000000006211',
      pg_catalog.decode(pg_catalog.repeat('56', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '1 hour',
      '00000000-0000-4000-8000-000000006906',
      'req_' || pg_catalog.repeat('F', 22)
    )
  $sql$,
  'recovery completion requires the exact bound ceremony context'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM viberacing_private.passkeys
    WHERE passkey_id = '00000000-0000-4000-8000-000000006311'
  )
    AND NOT EXISTS (
      SELECT 1
      FROM viberacing_private.sessions
      WHERE session_id = '00000000-0000-4000-8000-000000006211'
    )
    AND EXISTS (
      SELECT 1
      FROM viberacing_private.recovery_authorities
      WHERE recovery_authority_id = '00000000-0000-4000-8000-000000006911'
        AND state = 'active'
    ),
  'failed recovery completion leaves no partial passkey or session state'
);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT pg_temp.assert_true(
  viberacing_api.complete_recovery_registration(
    '00000000-0000-4000-8000-000000006911',
    pg_catalog.decode(pg_catalog.repeat('91', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('92', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('93', 32), 'hex'),
    '00000000-0000-4000-8000-000000006312',
    pg_catalog.decode(pg_catalog.repeat('37', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('47', 64), 'hex'),
    'Recovered passkey',
    0,
    true,
    false,
    '00000000-0000-4000-8000-000000006212',
    pg_catalog.decode(pg_catalog.repeat('57', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour',
    '00000000-0000-4000-8000-000000006907',
    'req_' || pg_catalog.repeat('G', 22)
  ) = '00000000-0000-4000-8000-000000006101',
  'verified recovery registration atomically returns the recovered profile'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(
        passkey_id = '00000000-0000-4000-8000-000000006312'
        AND state = 'active'
      )
    FROM viberacing_private.passkeys
    WHERE profile_id = '00000000-0000-4000-8000-000000006101'
      AND state = 'active'
  )
    AND (
      SELECT pg_catalog.count(*) = 1
        AND pg_catalog.bool_and(
          session_id = '00000000-0000-4000-8000-000000006212'
          AND authentication_kind = 'passkey'
          AND authenticated_by_passkey_id = '00000000-0000-4000-8000-000000006312'
        )
      FROM viberacing_private.sessions
      WHERE profile_id = '00000000-0000-4000-8000-000000006101'
        AND state = 'active'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM viberacing_private.recovery_codes
      WHERE profile_id = '00000000-0000-4000-8000-000000006101'
    )
    AND EXISTS (
      SELECT 1
      FROM viberacing_private.recovery_authorities
      WHERE recovery_authority_id = '00000000-0000-4000-8000-000000006911'
        AND state = 'completed'
        AND completed_at IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM viberacing_private.auth_challenges
      WHERE challenge_id = '00000000-0000-4000-8000-000000006809'
    )
    AND EXISTS (
      SELECT 1
      FROM viberacing_private.pairing_transactions
      WHERE pairing_id = '00000000-0000-4000-8000-000000006501'
        AND state = 'cancelled'
    )
    AND EXISTS (
      SELECT 1
      FROM viberacing_private.device_keys
      WHERE device_key_id = '00000000-0000-4000-8000-000000006401'
        AND state = 'active'
    ),
  'completion replaces browser authority, cancels pending approval, and preserves activated device authority'
);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT viberacing_api.start_recovery(
  '00000000-0000-4000-8000-000000006705',
  '00000000-0000-4000-8000-000000006915',
  pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('a2', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('a3', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '5 minutes',
  '00000000-0000-4000-8000-000000006908',
  'req_' || pg_catalog.repeat('H', 22)
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  viberacing_private.authenticate_session(
    '00000000-0000-4000-8000-000000006205',
    pg_catalog.decode(pg_catalog.repeat('55', 32), 'hex'),
    ARRAY['active', 'hidden']
  ) = '00000000-0000-4000-8000-000000006105'
    AND EXISTS (
      SELECT 1
      FROM viberacing_private.passkeys
      WHERE passkey_id = '00000000-0000-4000-8000-000000006305'
        AND state = 'active'
    ),
  'starting restricted recovery does not disturb the possessed browser and passkey session'
);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT viberacing_api.create_recovery_change_challenge(
  '00000000-0000-4000-8000-000000006205',
  pg_catalog.decode(pg_catalog.repeat('55', 32), 'hex'),
  '00000000-0000-4000-8000-000000006805',
  pg_catalog.decode(pg_catalog.repeat('a4', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('a5', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '5 minutes'
);

SELECT pg_temp.assert_true(
  viberacing_api.consume_passkey_challenge(
    '00000000-0000-4000-8000-000000006205',
    pg_catalog.decode(pg_catalog.repeat('55', 32), 'hex'),
    '00000000-0000-4000-8000-000000006805',
    'recovery_change',
    pg_catalog.decode(pg_catalog.repeat('a4', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('a5', 32), 'hex'),
    '00000000-0000-4000-8000-000000006305',
    1,
    false
  ),
  'recovery rotation requires a separate exact passkey step-up'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.replace_recovery_codes(
      '00000000-0000-4000-8000-000000006205',
      pg_catalog.decode(pg_catalog.repeat('55', 32), 'hex'),
      '00000000-0000-4000-8000-000000006805',
      pg_catalog.decode(pg_catalog.repeat('a5', 32), 'hex'),
      '00000000-0000-4000-8000-000000006609',
      ARRAY(
        SELECT ('00000000-0000-4000-8006-' || pg_catalog.lpad((7300 + value)::text, 12, '0'))::uuid
        FROM pg_catalog.generate_series(1, 8) AS generated(value)
      ),
      ARRAY(
        SELECT CASE
          WHEN value = 1 THEN '$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$' || pg_catalog.repeat('A', 300)
          ELSE '$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$' || pg_catalog.repeat('j', 31) || value
        END
        FROM pg_catalog.generate_series(1, 8) AS generated(value)
      ),
      '00000000-0000-4000-8000-000000006909',
      'req_' || pg_catalog.repeat('I', 22)
    )
  $sql$,
  'oversized recovery verifier material fails closed before database insertion'
);

SELECT viberacing_api.replace_recovery_codes(
  '00000000-0000-4000-8000-000000006205',
  pg_catalog.decode(pg_catalog.repeat('55', 32), 'hex'),
  '00000000-0000-4000-8000-000000006805',
  pg_catalog.decode(pg_catalog.repeat('a5', 32), 'hex'),
  '00000000-0000-4000-8000-000000006610',
  ARRAY(
    SELECT ('00000000-0000-4000-8006-' || pg_catalog.lpad((7400 + value)::text, 12, '0'))::uuid
    FROM pg_catalog.generate_series(1, 8) AS generated(value)
  ),
  ARRAY(
    SELECT '$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$' || pg_catalog.repeat('k', 31) || value
    FROM pg_catalog.generate_series(1, 8) AS generated(value)
  ),
  '00000000-0000-4000-8000-000000006910',
  'req_' || pg_catalog.repeat('J', 22)
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM viberacing_private.recovery_authorities
    WHERE recovery_authority_id = '00000000-0000-4000-8000-000000006915'
      AND state = 'revoked'
  )
    AND NOT EXISTS (
      SELECT 1
      FROM viberacing_private.recovery_codes
      WHERE recovery_code_id IN (
        '00000000-0000-4000-8000-000000006705',
        '00000000-0000-4000-8000-000000006706'
      )
    ),
  'fresh passkey-protected code rotation revokes every authority derived from the old batch'
);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT viberacing_api.start_recovery(
  '00000000-0000-4000-8000-000000006704',
  '00000000-0000-4000-8000-000000006914',
  pg_catalog.decode(pg_catalog.repeat('b1', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('b2', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('b3', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '5 minutes',
  '00000000-0000-4000-8000-000000006912',
  'req_' || pg_catalog.repeat('K', 22)
);

SELECT viberacing_api.start_recovery(
  '00000000-0000-4000-8000-000000006703',
  '00000000-0000-4000-8000-000000006913',
  pg_catalog.decode(pg_catalog.repeat('c1', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('c2', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('c3', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '5 minutes',
  '00000000-0000-4000-8000-000000006913',
  'req_' || pg_catalog.repeat('L', 22)
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.complete_recovery_registration(
      '00000000-0000-4000-8000-000000006913',
      pg_catalog.decode(pg_catalog.repeat('c1', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('c2', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('c3', 32), 'hex'),
      '00000000-0000-4000-8000-000000006313',
      pg_catalog.decode(pg_catalog.repeat('38', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('48', 64), 'hex'),
      'Cap recovery key',
      0,
      false,
      false,
      '00000000-0000-4000-8000-000000006213',
      pg_catalog.decode(pg_catalog.repeat('58', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '1 hour',
      '00000000-0000-4000-8000-000000006914',
      'req_' || pg_catalog.repeat('M', 22)
    )
  $sql$,
  'recovery fails closed at the lifetime passkey provenance ceiling'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 32
    FROM viberacing_private.passkeys
    WHERE profile_id = '00000000-0000-4000-8000-000000006103'
  )
    AND EXISTS (
      SELECT 1
      FROM viberacing_private.recovery_authorities
      WHERE recovery_authority_id = '00000000-0000-4000-8000-000000006913'
        AND state = 'active'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM viberacing_private.sessions
      WHERE session_id = '00000000-0000-4000-8000-000000006213'
    ),
  'failed capped recovery preserves the restricted authority without partial login state'
);

UPDATE viberacing_private.profiles
SET
  state = 'deletion_pending',
  hidden_at = pg_catalog.statement_timestamp(),
  deletion_requested_at = pg_catalog.statement_timestamp()
WHERE profile_id = '00000000-0000-4000-8000-000000006104';

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM viberacing_private.recovery_authorities
    WHERE recovery_authority_id = '00000000-0000-4000-8000-000000006914'
      AND state = 'revoked'
      AND revoked_at IS NOT NULL
  ),
  'profile deletion state revokes active recovery authority defensively'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    UPDATE viberacing_private.recovery_codes
    SET used_at = used_at
    WHERE recovery_code_id = '00000000-0000-4000-8000-000000006703'
  $sql$,
  'consumed recovery code state is terminal'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    UPDATE viberacing_private.recovery_authorities
    SET verifier_digest = pg_catalog.decode(pg_catalog.repeat('dd', 32), 'hex')
    WHERE recovery_authority_id = '00000000-0000-4000-8000-000000006913'
  $sql$,
  'restricted authority binding is immutable'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    UPDATE viberacing_private.recovery_authorities
    SET state = 'active', completed_at = NULL
    WHERE recovery_authority_id = '00000000-0000-4000-8000-000000006911'
  $sql$,
  'completed recovery authority cannot be reopened'
);

DELETE FROM viberacing_private.profiles
WHERE profile_id = '00000000-0000-4000-8000-000000006104';

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM viberacing_private.audit_events
    WHERE event_type = 'recovery.started'
      AND request_id = 'req_' || pg_catalog.repeat('K', 22)
      AND actor_kind = 'recovery'
      AND profile_id IS NULL
  )
    AND (
      SELECT pg_catalog.count(*) = 7
      FROM viberacing_private.audit_events
      WHERE event_type IN (
        'recovery.codes_replaced',
        'recovery.started',
        'recovery.completed'
      )
    ),
  'recovery audit is bounded and profile linkage redacts safely on profile purge'
);

ROLLBACK;
