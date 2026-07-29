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
      AND passkey.state = 'active'
      AND passkey.label = 'This device'
  ) THEN
    RAISE EXCEPTION 'automatic initial passkey label is missing';
  END IF;

  IF (SELECT pg_catalog.count(*)
      FROM viberacing_private.sessions
      WHERE profile_id = '10000000-0000-4000-8000-000000000001') <> 2
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
        AND state = 'active'
        AND authentication_kind = 'passkey'
    )
  THEN
    RAISE EXCEPTION 'initial passkey did not rotate the pending OAuth session exactly once';
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
