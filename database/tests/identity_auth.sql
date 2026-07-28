\set ON_ERROR_STOP on

BEGIN;

SET LOCAL ROLE viberacing_web;

SELECT *
FROM viberacing_api.open_github_profile(
  '10000000-0000-4000-8000-000000000001',
  900000000000001,
  'clean-driver',
  'en',
  '10000000-0000-4000-8000-000000000002',
  pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex'),
  pg_catalog.transaction_timestamp() + interval '20 minutes',
  NULL
);

SELECT viberacing_api.create_auth_challenge(
  '10000000-0000-4000-8000-000000000002',
  pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex'),
  '10000000-0000-4000-8000-000000000003',
  'initial_passkey',
  pg_catalog.decode(pg_catalog.repeat('12', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('13', 32), 'hex'),
  pg_catalog.transaction_timestamp() + interval '4 minutes'
);

SELECT viberacing_api.register_initial_passkey(
  '10000000-0000-4000-8000-000000000002',
  pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex'),
  '10000000-0000-4000-8000-000000000003',
  pg_catalog.decode(pg_catalog.repeat('13', 32), 'hex'),
  '10000000-0000-4000-8000-000000000004',
  pg_catalog.decode(pg_catalog.repeat('14', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('15', 64), 'hex'),
  0,
  true,
  false,
  'Primary passkey'
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
      AND passkey.state = 'active'
      AND passkey.label = 'Primary passkey'
  ) THEN
    RAISE EXCEPTION 'initial passkey is missing';
  END IF;

  BEGIN
    UPDATE viberacing_private.profiles
    SET github_user_id = 900000000000002
    WHERE profile_id = '10000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'GitHub identity mutation unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;
END
$assertion$;

SET LOCAL ROLE viberacing_web;

DO $assertion$
BEGIN
  BEGIN
    PERFORM *
    FROM viberacing_api.open_github_profile(
      '10000000-0000-4000-8000-000000000011',
      900000000000002,
      'clean-driver',
      'en',
      '10000000-0000-4000-8000-000000000012',
      pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex'),
      pg_catalog.transaction_timestamp() + interval '20 minutes',
      NULL
    );
    RAISE EXCEPTION 'handle collision unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;
END
$assertion$;

RESET ROLE;

ROLLBACK;
