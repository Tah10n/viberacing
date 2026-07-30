\set ON_ERROR_STOP on

BEGIN;

SET LOCAL ROLE viberacing_web;

SELECT *
FROM viberacing_api.open_github_profile(
  '10000000-0000-4000-8000-000000000001',
  900000000000001,
  'pending_1000000000004000',
  'en',
  '10000000-0000-4000-8000-000000000002',
  pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex'),
  pg_catalog.transaction_timestamp() + interval '20 minutes',
  NULL,
  NULL,
  false
);

SELECT viberacing_api.begin_initial_passkey(
  '10000000-0000-4000-8000-000000000002',
  pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex'),
  'clean-driver',
  '10000000-0000-4000-8000-000000000003',
  pg_catalog.decode(pg_catalog.repeat('12', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('13', 32), 'hex'),
  pg_catalog.transaction_timestamp() + interval '4 minutes'
);

SELECT viberacing_api.complete_initial_passkey(
  '10000000-0000-4000-8000-000000000002',
  pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex'),
  '10000000-0000-4000-8000-000000000003',
  pg_catalog.decode(pg_catalog.repeat('13', 32), 'hex'),
  'clean-driver',
  '10000000-0000-4000-8000-000000000004',
  pg_catalog.decode(pg_catalog.repeat('14', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('15', 64), 'hex'),
  0,
  true,
  false,
  '10000000-0000-4000-8000-000000000005',
  pg_catalog.decode(pg_catalog.repeat('16', 32), 'hex'),
  pg_catalog.transaction_timestamp() + interval '30 days'
);

DO $existing_identity$
DECLARE
  v_result record;
BEGIN
  SELECT *
  INTO STRICT v_result
  FROM viberacing_api.open_github_profile(
    '10000000-0000-4000-8000-000000000011',
    900000000000001,
    'pending_1000000000004000',
    'ru',
    '10000000-0000-4000-8000-000000000012',
    pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex'),
    pg_catalog.transaction_timestamp() + interval '20 minutes',
    NULL,
    NULL,
    false
  );
  IF v_result.profile_id <> '10000000-0000-4000-8000-000000000001'::uuid
    OR v_result.handle <> 'clean-driver'
    OR v_result.locale <> 'en'
    OR v_result.profile_state <> 'active'
    OR v_result.created
    OR v_result.session_created
  THEN
    RAISE EXCEPTION 'repeat GitHub OAuth did not converge on the active identity';
  END IF;
END
$existing_identity$;

SELECT *
FROM viberacing_api.open_github_profile(
  '10000000-0000-4000-8000-000000000021',
  900000000000002,
  'pending_1000000000004001',
  'en',
  '10000000-0000-4000-8000-000000000022',
  pg_catalog.decode(pg_catalog.repeat('31', 32), 'hex'),
  pg_catalog.transaction_timestamp() + interval '20 minutes',
  NULL,
  NULL,
  false
);

DO $handle_collision$
BEGIN
  BEGIN
    PERFORM viberacing_api.begin_initial_passkey(
      '10000000-0000-4000-8000-000000000022',
      pg_catalog.decode(pg_catalog.repeat('31', 32), 'hex'),
      'clean-driver',
      '10000000-0000-4000-8000-000000000023',
      pg_catalog.decode(pg_catalog.repeat('32', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('33', 32), 'hex'),
      pg_catalog.transaction_timestamp() + interval '4 minutes'
    );
    RAISE EXCEPTION 'handle collision unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;
END
$handle_collision$;

DO $passkey_management$
DECLARE
  v_inventory_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
  INTO v_inventory_count
  FROM viberacing_api.read_passkey_inventory(
    '10000000-0000-4000-8000-000000000005',
    pg_catalog.decode(pg_catalog.repeat('16', 32), 'hex')
  );
  IF v_inventory_count <> 1 THEN
    RAISE EXCEPTION 'initial passkey inventory is not exact';
  END IF;
END
$passkey_management$;

SELECT viberacing_api.create_auth_challenge(
  '10000000-0000-4000-8000-000000000005',
  pg_catalog.decode(pg_catalog.repeat('16', 32), 'hex'),
  '10000000-0000-4000-8000-000000000031',
  'passkey_change',
  pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('42', 32), 'hex'),
  pg_catalog.transaction_timestamp() + interval '4 minutes'
);

SELECT viberacing_api.add_passkey(
  '10000000-0000-4000-8000-000000000005',
  pg_catalog.decode(pg_catalog.repeat('16', 32), 'hex'),
  '10000000-0000-4000-8000-000000000031',
  pg_catalog.decode(pg_catalog.repeat('42', 32), 'hex'),
  '10000000-0000-4000-8000-000000000004',
  1,
  false,
  '10000000-0000-4000-8000-000000000032',
  pg_catalog.decode(pg_catalog.repeat('43', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('44', 64), 'hex'),
  'Backup passkey',
  0,
  true,
  false
);

SELECT viberacing_api.create_auth_challenge(
  '10000000-0000-4000-8000-000000000005',
  pg_catalog.decode(pg_catalog.repeat('16', 32), 'hex'),
  '10000000-0000-4000-8000-000000000033',
  'passkey_change',
  pg_catalog.decode(pg_catalog.repeat('45', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('46', 32), 'hex'),
  pg_catalog.transaction_timestamp() + interval '4 minutes'
);

SELECT viberacing_api.revoke_passkey(
  '10000000-0000-4000-8000-000000000005',
  pg_catalog.decode(pg_catalog.repeat('16', 32), 'hex'),
  '10000000-0000-4000-8000-000000000033',
  pg_catalog.decode(pg_catalog.repeat('46', 32), 'hex'),
  '10000000-0000-4000-8000-000000000004',
  2,
  false,
  '10000000-0000-4000-8000-000000000032'
);

SELECT viberacing_api.create_auth_challenge(
  '10000000-0000-4000-8000-000000000005',
  pg_catalog.decode(pg_catalog.repeat('16', 32), 'hex'),
  '10000000-0000-4000-8000-000000000034',
  'recovery_change',
  pg_catalog.decode(pg_catalog.repeat('47', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('48', 32), 'hex'),
  pg_catalog.transaction_timestamp() + interval '4 minutes'
);

SELECT viberacing_api.replace_recovery_codes(
  '10000000-0000-4000-8000-000000000005',
  pg_catalog.decode(pg_catalog.repeat('16', 32), 'hex'),
  '10000000-0000-4000-8000-000000000034',
  pg_catalog.decode(pg_catalog.repeat('48', 32), 'hex'),
  '10000000-0000-4000-8000-000000000004',
  3,
  false,
  '10000000-0000-4000-8000-000000000035',
  ARRAY[
    '10000000-0000-4000-8000-000000000041',
    '10000000-0000-4000-8000-000000000042',
    '10000000-0000-4000-8000-000000000043',
    '10000000-0000-4000-8000-000000000044',
    '10000000-0000-4000-8000-000000000045',
    '10000000-0000-4000-8000-000000000046',
    '10000000-0000-4000-8000-000000000047',
    '10000000-0000-4000-8000-000000000048',
    '10000000-0000-4000-8000-000000000049',
    '10000000-0000-4000-8000-000000000050'
  ]::uuid[],
  ARRAY[
    '$argon2id$v=19$m=65536,t=3,p=1$c2FsdDA$aGFzaDA',
    '$argon2id$v=19$m=65536,t=3,p=1$c2FsdDE$aGFzaDE',
    '$argon2id$v=19$m=65536,t=3,p=1$c2FsdDI$aGFzaDI',
    '$argon2id$v=19$m=65536,t=3,p=1$c2FsdDM$aGFzaDM',
    '$argon2id$v=19$m=65536,t=3,p=1$c2FsdDQ$aGFzaDQ',
    '$argon2id$v=19$m=65536,t=3,p=1$c2FsdDU$aGFzaDU',
    '$argon2id$v=19$m=65536,t=3,p=1$c2FsdDY$aGFzaDY',
    '$argon2id$v=19$m=65536,t=3,p=1$c2FsdDc$aGFzaDc',
    '$argon2id$v=19$m=65536,t=3,p=1$c2FsdDg$aGFzaDg',
    '$argon2id$v=19$m=65536,t=3,p=1$c2FsdDk$aGFzaDk'
  ]::text[]
);

DO $recovery_material$
DECLARE
  v_material record;
BEGIN
  SELECT *
  INTO STRICT v_material
  FROM viberacing_api.read_recovery_code_verification_material(
    '10000000-0000-4000-8000-000000000041'
  );
  IF v_material.verifier_phc <> '$argon2id$v=19$m=65536,t=3,p=1$c2FsdDA$aGFzaDA' THEN
    RAISE EXCEPTION 'recovery verification material changed';
  END IF;
END
$recovery_material$;

SELECT viberacing_api.start_recovery(
  '10000000-0000-4000-8000-000000000041',
  '10000000-0000-4000-8000-000000000051',
  pg_catalog.decode(pg_catalog.repeat('51', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('52', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('53', 32), 'hex'),
  pg_catalog.transaction_timestamp() + interval '5 minutes'
);

DO $recovery_replay$
BEGIN
  BEGIN
    PERFORM viberacing_api.start_recovery(
      '10000000-0000-4000-8000-000000000041',
      '10000000-0000-4000-8000-000000000052',
      pg_catalog.decode(pg_catalog.repeat('54', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('55', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('56', 32), 'hex'),
      pg_catalog.transaction_timestamp() + interval '5 minutes'
    );
    RAISE EXCEPTION 'used recovery code unexpectedly replayed';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;
END
$recovery_replay$;

SELECT *
FROM viberacing_api.complete_recovery_registration_session(
  '10000000-0000-4000-8000-000000000051',
  pg_catalog.decode(pg_catalog.repeat('51', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('52', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('53', 32), 'hex'),
  '10000000-0000-4000-8000-000000000053',
  pg_catalog.decode(pg_catalog.repeat('57', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('58', 64), 'hex'),
  'Recovery device',
  0,
  true,
  false,
  '10000000-0000-4000-8000-000000000054',
  pg_catalog.decode(pg_catalog.repeat('59', 32), 'hex'),
  pg_catalog.transaction_timestamp() + interval '30 days'
);

SELECT viberacing_api.propose_car_recipe(
  '10000000-0000-4000-8000-000000000054',
  pg_catalog.decode(pg_catalog.repeat('59', 32), 'hex'),
  '10000000-0000-4000-8000-000000000061',
  1,
  'formula',
  'wedge',
  'canopy',
  'high',
  'slick',
  'turbo-blue',
  'spark',
  4242,
  pg_catalog.transaction_timestamp() + interval '12 hours'
);

SELECT viberacing_api.approve_car_recipe(
  '10000000-0000-4000-8000-000000000054',
  pg_catalog.decode(pg_catalog.repeat('59', 32), 'hex'),
  '10000000-0000-4000-8000-000000000061'
);

DO $car_recipe_state$
DECLARE
  v_state record;
BEGIN
  SELECT *
  INTO STRICT v_state
  FROM viberacing_api.read_car_recipe_state(
    '10000000-0000-4000-8000-000000000054',
    pg_catalog.decode(pg_catalog.repeat('59', 32), 'hex')
  );
  IF v_state.active_schema_version <> 1
    OR v_state.active_chassis <> 'formula'
    OR v_state.active_seed <> 4242
    OR v_state.proposal_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'approved CarRecipe state changed';
  END IF;
END
$car_recipe_state$;

SELECT viberacing_api.revoke_session(
  '10000000-0000-4000-8000-000000000054',
  pg_catalog.decode(pg_catalog.repeat('59', 32), 'hex')
);

RESET ROLE;

DO $assertion$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.profiles AS profile
    WHERE profile.profile_id = '10000000-0000-4000-8000-000000000001'
      AND profile.github_user_id = 900000000000001
      AND profile.handle = 'clean-driver'
      AND profile.state = 'active'
      AND profile.public_visibility = 'hidden'
  ) THEN
    RAISE EXCEPTION 'GitHub profile did not activate through the initial passkey';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.passkeys AS passkey
    WHERE passkey.profile_id = '10000000-0000-4000-8000-000000000001'
      AND passkey.state = 'revoked'
      AND passkey.label = 'This device'
  ) OR NOT EXISTS (
    SELECT 1
    FROM viberacing_private.passkeys AS passkey
    WHERE passkey.profile_id = '10000000-0000-4000-8000-000000000001'
      AND passkey.state = 'active'
      AND passkey.label = 'Recovery device'
  ) THEN
    RAISE EXCEPTION 'initial and recovery passkey lifecycle is incomplete';
  END IF;

  IF (SELECT pg_catalog.count(*)
      FROM viberacing_private.sessions
      WHERE profile_id = '10000000-0000-4000-8000-000000000001') <> 3
    OR NOT EXISTS (
      SELECT 1
      FROM viberacing_private.sessions
      WHERE session_id = '10000000-0000-4000-8000-000000000002'
        AND state = 'revoked'
    )
    OR NOT EXISTS (
      SELECT 1
      FROM viberacing_private.sessions
      WHERE session_id = '10000000-0000-4000-8000-000000000005'
        AND state = 'revoked'
        AND authentication_kind = 'passkey'
    )
    OR NOT EXISTS (
      SELECT 1
      FROM viberacing_private.sessions
      WHERE session_id = '10000000-0000-4000-8000-000000000054'
        AND state = 'revoked'
        AND authentication_kind = 'recovery'
    )
  THEN
    RAISE EXCEPTION 'passkey and recovery session rotation did not settle exactly';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.profiles
    WHERE profile_id = '10000000-0000-4000-8000-000000000021'
      AND handle = 'pending_1000000000004001'
      AND state = 'enrolling'
  ) OR EXISTS (
    SELECT 1
    FROM viberacing_private.auth_challenges
    WHERE challenge_id = '10000000-0000-4000-8000-000000000023'
  ) THEN
    RAISE EXCEPTION 'handle collision did not roll back the entire challenge start';
  END IF;

  BEGIN
    UPDATE viberacing_private.profiles
    SET github_user_id = 900000000000003
    WHERE profile_id = '10000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'GitHub identity mutation unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;
END
$assertion$;

ROLLBACK;
