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
    '00000000-0000-4000-8000-000000005101',
    900000000000005101,
    'passkey-alpha',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000005102',
    900000000000005102,
    'passkey-beta',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000005103',
    900000000000005103,
    'passkey-hidden',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000005104',
    900000000000005104,
    'passkey-cap',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000005105',
    900000000000005105,
    'session-cap',
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
    '00000000-0000-4000-8000-000000005301',
    '00000000-0000-4000-8000-000000005101',
    pg_catalog.decode(pg_catalog.repeat('61', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('71', 64), 'hex'),
    'Alpha roaming key',
    5,
    true,
    false
  ),
  (
    '00000000-0000-4000-8000-000000005302',
    '00000000-0000-4000-8000-000000005101',
    pg_catalog.decode(pg_catalog.repeat('62', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('72', 64), 'hex'),
    'Alpha platform key',
    0,
    false,
    false
  ),
  (
    '00000000-0000-4000-8000-000000005303',
    '00000000-0000-4000-8000-000000005102',
    pg_catalog.decode(pg_catalog.repeat('63', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('73', 64), 'hex'),
    'Beta passkey',
    0,
    false,
    false
  ),
  (
    '00000000-0000-4000-8000-000000005304',
    '00000000-0000-4000-8000-000000005103',
    pg_catalog.decode(pg_catalog.repeat('64', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('74', 64), 'hex'),
    'Hidden profile passkey',
    0,
    false,
    false
  ),
  (
    '00000000-0000-4000-8000-000000005305',
    '00000000-0000-4000-8000-000000005105',
    pg_catalog.decode(pg_catalog.repeat('65', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('75', 64), 'hex'),
    'Session cap passkey',
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
  ('00000000-0000-4000-8005-' || pg_catalog.lpad(key_number::text, 12, '0'))::uuid,
  '00000000-0000-4000-8000-000000005104',
  pg_catalog.decode(pg_catalog.lpad(pg_catalog.to_hex(5000 + key_number), 32, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad(pg_catalog.to_hex(7000 + key_number), 64, '0'), 'hex'),
  'Lifetime cap key ' || key_number,
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
    '00000000-0000-4000-8000-000000005201',
    '00000000-0000-4000-8000-000000005101',
    pg_catalog.decode(pg_catalog.repeat('81', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour',
    'passkey',
    '00000000-0000-4000-8000-000000005301'
  ),
  (
    '00000000-0000-4000-8000-000000005202',
    '00000000-0000-4000-8000-000000005101',
    pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour',
    'passkey',
    '00000000-0000-4000-8000-000000005302'
  ),
  (
    '00000000-0000-4000-8000-000000005203',
    '00000000-0000-4000-8000-000000005101',
    pg_catalog.decode(pg_catalog.repeat('83', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour',
    'passkey',
    '00000000-0000-4000-8000-000000005301'
  ),
  (
    '00000000-0000-4000-8000-000000005204',
    '00000000-0000-4000-8000-000000005102',
    pg_catalog.decode(pg_catalog.repeat('84', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour',
    'passkey',
    '00000000-0000-4000-8000-000000005303'
  ),
  (
    '00000000-0000-4000-8000-000000005205',
    '00000000-0000-4000-8000-000000005103',
    pg_catalog.decode(pg_catalog.repeat('85', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour',
    'passkey',
    '00000000-0000-4000-8000-000000005304'
  ),
  (
    '00000000-0000-4000-8000-000000005206',
    '00000000-0000-4000-8000-000000005104',
    pg_catalog.decode(pg_catalog.repeat('86', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour',
    'passkey',
    '00000000-0000-4000-8005-000000000001'
  );

INSERT INTO viberacing_private.sessions (
  session_id,
  profile_id,
  verifier_digest,
  expires_at,
  authentication_kind,
  authenticated_by_passkey_id
)
SELECT
  ('00000000-0000-4000-8006-' || pg_catalog.lpad(session_number::text, 12, '0'))::uuid,
  '00000000-0000-4000-8000-000000005105',
  pg_catalog.decode(pg_catalog.lpad(pg_catalog.to_hex(9000 + session_number), 64, '0'), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '1 hour',
  'passkey',
  '00000000-0000-4000-8000-000000005305'
FROM pg_catalog.generate_series(1, 32) AS generated_session(session_number);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    INSERT INTO viberacing_private.sessions (
      session_id,
      profile_id,
      verifier_digest,
      expires_at,
      authentication_kind,
      authenticated_by_passkey_id
    ) VALUES (
      '00000000-0000-4000-8000-000000005299',
      '00000000-0000-4000-8000-000000005102',
      pg_catalog.decode(pg_catalog.repeat('99', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '1 hour',
      'passkey',
      '00000000-0000-4000-8000-000000005301'
    )
  $sql$,
  'session provenance cannot bind a passkey from another profile'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    UPDATE viberacing_private.passkeys
    SET sign_count = 4
    WHERE passkey_id = '00000000-0000-4000-8000-000000005301'
  $sql$,
  'stored WebAuthn sign state cannot move backward'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    UPDATE viberacing_private.passkeys
    SET credential_id = pg_catalog.decode(pg_catalog.repeat('ff', 32), 'hex')
    WHERE passkey_id = '00000000-0000-4000-8000-000000005301'
  $sql$,
  'passkey credential identity is immutable'
);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.create_passkey_login_challenge(
      '00000000-0000-4000-8000-000000005699',
      pg_catalog.decode(pg_catalog.repeat('a9', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('b9', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '6 minutes'
    )
  $sql$,
  'anonymous login challenge lifetime is absolutely bounded'
);

SELECT viberacing_api.create_passkey_login_challenge(
  '00000000-0000-4000-8000-000000005601',
  pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('b1', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(
        passkey_id = '00000000-0000-4000-8000-000000005301'
        AND sign_count = 5
        AND backup_eligible
        AND NOT backup_state
        AND pg_catalog.octet_length(cose_public_key) = 64
      )
    FROM viberacing_api.read_passkey_verification_material(
      pg_catalog.decode(pg_catalog.repeat('61', 32), 'hex')
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_api.read_passkey_verification_material(
      pg_catalog.decode(pg_catalog.repeat('ee', 32), 'hex')
    )
  ),
  'verification lookup returns minimal material for only an active known credential'
);

SELECT pg_temp.assert_true(
  pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'viberacing_api.read_passkey_verification_material(bytea)'::regprocedure
    ),
    'profile_id'
  ) = 0
  AND pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'viberacing_api.read_passkey_verification_material(bytea)'::regprocedure
    ),
    'credential_id'
  ) = 0,
  'verification result omits profile and credential identifiers'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.complete_passkey_login(
      '00000000-0000-4000-8000-000000005601',
      pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('b1', 32), 'hex'),
      '00000000-0000-4000-8000-000000005301',
      pg_catalog.decode(pg_catalog.repeat('62', 32), 'hex'),
      3,
      true,
      '00000000-0000-4000-8000-000000005211',
      pg_catalog.decode(pg_catalog.repeat('91', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '1 hour',
      '00000000-0000-4000-8000-000000005901',
      'req_' || pg_catalog.repeat('A', 22)
    )
  $sql$,
  'login requires the exact passkey and credential binding'
);

SELECT pg_temp.assert_true(
  viberacing_api.complete_passkey_login(
    '00000000-0000-4000-8000-000000005601',
    pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('b1', 32), 'hex'),
    '00000000-0000-4000-8000-000000005301',
    pg_catalog.decode(pg_catalog.repeat('61', 32), 'hex'),
    3,
    true,
    '00000000-0000-4000-8000-000000005211',
    pg_catalog.decode(pg_catalog.repeat('91', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour',
    '00000000-0000-4000-8000-000000005901',
    'req_' || pg_catalog.repeat('A', 22)
  ) = '00000000-0000-4000-8000-000000005101',
  'exact login creates a session for the credential-derived profile'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.complete_passkey_login(
      '00000000-0000-4000-8000-000000005601',
      pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('b1', 32), 'hex'),
      '00000000-0000-4000-8000-000000005301',
      pg_catalog.decode(pg_catalog.repeat('61', 32), 'hex'),
      6,
      true,
      '00000000-0000-4000-8000-000000005212',
      pg_catalog.decode(pg_catalog.repeat('92', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '1 hour',
      '00000000-0000-4000-8000-000000005902',
      'req_' || pg_catalog.repeat('B', 22)
    )
  $sql$,
  'login challenge replay is rejected'
);

SELECT pg_temp.assert_true(
  viberacing_api.rotate_session(
    '00000000-0000-4000-8000-000000005211',
    pg_catalog.decode(pg_catalog.repeat('91', 32), 'hex'),
    '00000000-0000-4000-8000-000000005212',
    pg_catalog.decode(pg_catalog.repeat('92', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour',
    '00000000-0000-4000-8000-000000005902',
    'req_' || pg_catalog.repeat('B', 22)
  ) = '00000000-0000-4000-8000-000000005101',
  'session rotation preserves authenticated identity'
);

SELECT viberacing_api.create_passkey_login_challenge(
  '00000000-0000-4000-8000-000000005602',
  pg_catalog.decode(pg_catalog.repeat('a2', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('b2', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.complete_passkey_login(
      '00000000-0000-4000-8000-000000005602',
      pg_catalog.decode(pg_catalog.repeat('a2', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('b2', 32), 'hex'),
      '00000000-0000-4000-8000-000000005301',
      pg_catalog.decode(pg_catalog.repeat('61', 32), 'hex'),
      7,
      true,
      '00000000-0000-4000-8000-000000005213',
      pg_catalog.decode(pg_catalog.repeat('93', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '1 hour',
      '00000000-0000-4000-8000-000000005901',
      'req_' || pg_catalog.repeat('C', 22)
    )
  $sql$,
  'duplicate audit identity rolls back an otherwise valid login'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM viberacing_private.sessions
    WHERE session_id = '00000000-0000-4000-8000-000000005213'
  )
  AND (
    SELECT consumed_at IS NULL AND authorized_action_used_at IS NULL
    FROM viberacing_private.auth_challenges
    WHERE challenge_id = '00000000-0000-4000-8000-000000005602'
  )
  AND (
    SELECT sign_count = 5 AND backup_state AND last_used_at IS NOT NULL
    FROM viberacing_private.passkeys
    WHERE passkey_id = '00000000-0000-4000-8000-000000005301'
  ),
  'failed login rolls back challenge, session, and passkey usage state atomically'
);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT pg_temp.assert_true(
  viberacing_api.complete_passkey_login(
    '00000000-0000-4000-8000-000000005602',
    pg_catalog.decode(pg_catalog.repeat('a2', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('b2', 32), 'hex'),
    '00000000-0000-4000-8000-000000005301',
    pg_catalog.decode(pg_catalog.repeat('61', 32), 'hex'),
    7,
    true,
    '00000000-0000-4000-8000-000000005213',
    pg_catalog.decode(pg_catalog.repeat('93', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour',
    '00000000-0000-4000-8000-000000005903',
    'req_' || pg_catalog.repeat('C', 22)
  ) = '00000000-0000-4000-8000-000000005101',
  'login can retry safely after an atomic rollback'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(
        profile_id = '00000000-0000-4000-8000-000000005101'
        AND handle = 'passkey-alpha'
        AND locale = 'en'
      )
    FROM viberacing_api.complete_passkey_login_session(
      '00000000-0000-4000-8000-000000005691',
      pg_catalog.decode(pg_catalog.repeat('c9', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('d9', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '4 minutes',
      '00000000-0000-4000-8000-000000005301',
      pg_catalog.decode(pg_catalog.repeat('61', 32), 'hex'),
      7,
      true,
      '00000000-0000-4000-8000-000000005291',
      pg_catalog.decode(pg_catalog.repeat('f9', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '1 hour',
      '00000000-0000-4000-8000-000000005991',
      'req_' || pg_catalog.repeat('Q', 22)
    )
  ),
  'post-proof login result returns only the exact profile cookie fields'
);

SELECT viberacing_api.create_passkey_login_challenge(
  '00000000-0000-4000-8000-000000005604',
  pg_catalog.decode(pg_catalog.repeat('a4', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('b4', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.complete_passkey_login(
      '00000000-0000-4000-8000-000000005604',
      pg_catalog.decode(pg_catalog.repeat('a4', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('b4', 32), 'hex'),
      '00000000-0000-4000-8000-000000005305',
      pg_catalog.decode(pg_catalog.repeat('65', 32), 'hex'),
      1,
      false,
      '00000000-0000-4000-8000-000000005214',
      pg_catalog.decode(pg_catalog.repeat('94', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '1 hour',
      '00000000-0000-4000-8000-000000005904',
      'req_' || pg_catalog.repeat('D', 22)
    )
  $sql$,
  'active session authority has a public database safety ceiling'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 2
    FROM viberacing_api.read_passkey_inventory(
      '00000000-0000-4000-8000-000000005202',
      pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex')
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_api.read_passkey_inventory(
      '00000000-0000-4000-8000-000000005202',
      pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex')
    )
    WHERE passkey_id = '00000000-0000-4000-8000-000000005303'
  ),
  'passkey inventory is session-derived and profile-isolated'
);

SELECT pg_temp.assert_true(
  pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'viberacing_api.read_passkey_inventory(uuid,bytea)'::regprocedure
    ),
    'credential_id'
  ) = 0
  AND pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'viberacing_api.read_passkey_inventory(uuid,bytea)'::regprocedure
    ),
    'cose_public_key'
  ) = 0
  AND pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'viberacing_api.read_passkey_inventory(uuid,bytea)'::regprocedure
    ),
    'profile_id'
  ) = 0
  AND pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'viberacing_api.read_passkey_inventory(uuid,bytea)'::regprocedure
    ),
    'sign_count'
  ) = 0,
  'inventory omits credential, public-key, profile, and sign-counter material'
);

SELECT viberacing_api.create_passkey_change_challenge(
  '00000000-0000-4000-8000-000000005202',
  pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
  'add',
  NULL,
  '00000000-0000-4000-8000-000000005605',
  pg_catalog.decode(pg_catalog.repeat('a5', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('b5', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.consume_passkey_challenge(
      '00000000-0000-4000-8000-000000005202',
      pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
      '00000000-0000-4000-8000-000000005605',
      'passkey_change',
      pg_catalog.decode(pg_catalog.repeat('a5', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('b5', 32), 'hex'),
      '00000000-0000-4000-8000-000000005303',
      1,
      false
    )
  $sql$,
  'step-up cannot use another profile passkey'
);

SELECT pg_temp.assert_true(
  viberacing_api.consume_passkey_challenge(
    '00000000-0000-4000-8000-000000005202',
    pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
    '00000000-0000-4000-8000-000000005605',
    'passkey_change',
    pg_catalog.decode(pg_catalog.repeat('a5', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('b5', 32), 'hex'),
    '00000000-0000-4000-8000-000000005302',
    2,
    false
  ),
  'exact owned passkey consumes the bound management step-up'
);

SELECT viberacing_api.add_passkey(
  '00000000-0000-4000-8000-000000005202',
  pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
  '00000000-0000-4000-8000-000000005605',
  pg_catalog.decode(pg_catalog.repeat('b5', 32), 'hex'),
  '00000000-0000-4000-8000-000000005306',
  pg_catalog.decode(pg_catalog.repeat('66', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('76', 64), 'hex'),
  'Alpha spare key',
  0,
  false,
  false,
  '00000000-0000-4000-8000-000000005905',
  'req_' || pg_catalog.repeat('E', 22)
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.add_passkey(
      '00000000-0000-4000-8000-000000005202',
      pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
      '00000000-0000-4000-8000-000000005605',
      pg_catalog.decode(pg_catalog.repeat('b5', 32), 'hex'),
      '00000000-0000-4000-8000-000000005307',
      pg_catalog.decode(pg_catalog.repeat('67', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('77', 64), 'hex'),
      'Replay key',
      0,
      false,
      false,
      '00000000-0000-4000-8000-000000005906',
      'req_' || pg_catalog.repeat('F', 22)
    )
  $sql$,
  'passkey addition authorization is one-time'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES (
  'src_' || pg_catalog.repeat('K', 22),
  '00000000-0000-4000-8000-000000005101'
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
  '00000000-0000-4000-8000-000000005401',
  pg_catalog.decode(pg_catalog.repeat('d1', 32), 'hex'),
  'Passkey revoke pending connector',
  '5.0.0',
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
  '00000000-0000-4000-8000-000000005501',
  pg_catalog.decode(pg_catalog.repeat('d2', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('d3', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('d4', 32), 'hex'),
  '00000000-0000-4000-8000-000000005401',
  'Passkey revoke pending connector',
  '5.0.0',
  'linux',
  'x86_64',
  'approved',
  '00000000-0000-4000-8000-000000005101',
  'existing',
  'src_' || pg_catalog.repeat('K', 22),
  '00000000-0000-4000-8000-000000005201',
  '00000000-0000-4000-8000-000000005301',
  pg_catalog.statement_timestamp() + INTERVAL '4 minutes',
  pg_catalog.statement_timestamp()
);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT viberacing_api.create_auth_challenge(
  '00000000-0000-4000-8000-000000005201',
  pg_catalog.decode(pg_catalog.repeat('81', 32), 'hex'),
  '00000000-0000-4000-8000-000000005608',
  'profile_deletion',
  pg_catalog.decode(pg_catalog.repeat('a8', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('b8', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
);

SELECT viberacing_api.create_passkey_change_challenge(
  '00000000-0000-4000-8000-000000005202',
  pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
  'revoke',
  '00000000-0000-4000-8000-000000005301',
  '00000000-0000-4000-8000-000000005606',
  pg_catalog.decode(pg_catalog.repeat('a6', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('b6', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
);

SELECT pg_temp.assert_true(
  viberacing_api.consume_passkey_challenge(
    '00000000-0000-4000-8000-000000005202',
    pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
    '00000000-0000-4000-8000-000000005606',
    'passkey_change',
    pg_catalog.decode(pg_catalog.repeat('a6', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('b6', 32), 'hex'),
    '00000000-0000-4000-8000-000000005302',
    3,
    false
  ),
  'revocation uses a fresh owned-passkey step-up'
);

SELECT viberacing_api.revoke_passkey(
  '00000000-0000-4000-8000-000000005202',
  pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
  '00000000-0000-4000-8000-000000005301',
  '00000000-0000-4000-8000-000000005606',
  pg_catalog.decode(pg_catalog.repeat('b6', 32), 'hex'),
  '00000000-0000-4000-8000-000000005906',
  'req_' || pg_catalog.repeat('F', 22)
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT state = 'revoked' AND revoked_at IS NOT NULL
    FROM viberacing_private.passkeys
    WHERE passkey_id = '00000000-0000-4000-8000-000000005301'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.sessions
    WHERE authenticated_by_passkey_id = '00000000-0000-4000-8000-000000005301'
      AND state = 'active'
  )
  AND (
    SELECT state = 'active'
    FROM viberacing_private.sessions
    WHERE session_id = '00000000-0000-4000-8000-000000005202'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.auth_challenges
    WHERE challenge_id = '00000000-0000-4000-8000-000000005608'
  )
  AND (
    SELECT state = 'cancelled'
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '00000000-0000-4000-8000-000000005501'
  ),
  'passkey revoke removes its sessions, stale challenges, and pending device authority'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    UPDATE viberacing_private.passkeys
    SET state = 'active', revoked_at = NULL
    WHERE passkey_id = '00000000-0000-4000-8000-000000005301'
  $sql$,
  'revoked passkey state is terminal'
);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM viberacing_api.read_passkey_verification_material(
      pg_catalog.decode(pg_catalog.repeat('61', 32), 'hex')
    )
  ),
  'revoked credential no longer exposes verification material'
);

SELECT viberacing_api.create_passkey_change_challenge(
  '00000000-0000-4000-8000-000000005202',
  pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
  'revoke',
  '00000000-0000-4000-8000-000000005306',
  '00000000-0000-4000-8000-000000005607',
  pg_catalog.decode(pg_catalog.repeat('a7', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('b7', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
);

SELECT pg_temp.assert_true(
  viberacing_api.consume_passkey_challenge(
    '00000000-0000-4000-8000-000000005202',
    pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
    '00000000-0000-4000-8000-000000005607',
    'passkey_change',
    pg_catalog.decode(pg_catalog.repeat('a7', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('b7', 32), 'hex'),
    '00000000-0000-4000-8000-000000005302',
    4,
    false
  ),
  'second revocation challenge is consumed'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.revoke_passkey(
      '00000000-0000-4000-8000-000000005202',
      pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
      '00000000-0000-4000-8000-000000005306',
      '00000000-0000-4000-8000-000000005607',
      pg_catalog.decode(pg_catalog.repeat('b7', 32), 'hex'),
      '00000000-0000-4000-8000-000000005906',
      'req_' || pg_catalog.repeat('G', 22)
    )
  $sql$,
  'duplicate audit identity rolls back passkey revocation'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT state = 'active' AND revoked_at IS NULL
    FROM viberacing_private.passkeys
    WHERE passkey_id = '00000000-0000-4000-8000-000000005306'
  )
  AND (
    SELECT authorized_action_used_at IS NULL
    FROM viberacing_private.auth_challenges
    WHERE challenge_id = '00000000-0000-4000-8000-000000005607'
  ),
  'failed revoke rolls back the authorization claim and passkey state'
);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT viberacing_api.revoke_passkey(
  '00000000-0000-4000-8000-000000005202',
  pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
  '00000000-0000-4000-8000-000000005306',
  '00000000-0000-4000-8000-000000005607',
  pg_catalog.decode(pg_catalog.repeat('b7', 32), 'hex'),
  '00000000-0000-4000-8000-000000005907',
  'req_' || pg_catalog.repeat('G', 22)
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.create_passkey_change_challenge(
      '00000000-0000-4000-8000-000000005202',
      pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
      'revoke',
      '00000000-0000-4000-8000-000000005302',
      '00000000-0000-4000-8000-000000005609',
      pg_catalog.decode(pg_catalog.repeat('aa', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('bb', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
    )
  $sql$,
  'the last active passkey cannot be revoked'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.create_passkey_change_challenge(
      '00000000-0000-4000-8000-000000005206',
      pg_catalog.decode(pg_catalog.repeat('86', 32), 'hex'),
      'add',
      NULL,
      '00000000-0000-4000-8000-000000005610',
      pg_catalog.decode(pg_catalog.repeat('ac', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('bc', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
    )
  $sql$,
  'lifetime passkey records have a public database safety ceiling'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT authentication_kind = 'passkey'
      AND authenticated_by_passkey_id = '00000000-0000-4000-8000-000000005301'
    FROM viberacing_private.sessions
    WHERE session_id = '00000000-0000-4000-8000-000000005212'
  )
  AND (
    SELECT sign_count = 4 AND last_used_at IS NOT NULL
    FROM viberacing_private.passkeys
    WHERE passkey_id = '00000000-0000-4000-8000-000000005302'
  )
  AND (
    SELECT pg_catalog.count(*) = 1
    FROM viberacing_private.passkeys
    WHERE profile_id = '00000000-0000-4000-8000-000000005101'
      AND state = 'active'
  )
  AND (
    SELECT pg_catalog.count(*) = 7
    FROM viberacing_private.audit_events
    WHERE profile_id = '00000000-0000-4000-8000-000000005101'
      AND event_type IN (
        'passkey.authenticated',
        'passkey.registered',
        'passkey.revoked',
        'session.rotated'
      )
      AND reason_code IS NULL
  ),
  'successful passkey operations preserve provenance, monotonic usage, and bounded audit records'
);

ROLLBACK;
