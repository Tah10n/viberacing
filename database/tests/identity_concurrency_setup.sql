\set ON_ERROR_STOP on

-- Deterministic synthetic fixtures for cross-connection identity races. This file commits only to
-- the isolated, portless, tmpfs-backed PostgreSQL integration project, which is destroyed in the
-- runner's finally block. It must never be pointed at a shared database.

BEGIN;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.invites (
  invite_id,
  verifier_digest,
  expires_at
)
VALUES (
  '00000000-0000-4000-8000-000000004701',
  pg_catalog.decode(pg_catalog.lpad('4701', 64, '0'), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '1 hour'
);

INSERT INTO viberacing_private.profiles (profile_id, github_user_id, handle, state)
VALUES
  (
    '00000000-0000-4000-8000-000000004103',
    900000000000004103,
    'race-challenge',
    'enrolling'
  ),
  (
    '00000000-0000-4000-8000-000000004104',
    900000000000004104,
    'race-session',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000004105',
    900000000000004105,
    'race-delete',
    'active'
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
    '00000000-0000-4000-8000-000000004304',
    '00000000-0000-4000-8000-000000004104',
    pg_catalog.decode(pg_catalog.lpad('4304', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('6304', 128, '0'), 'hex'),
    'Session rotation race key'
  ),
  (
    '00000000-0000-4000-8000-000000004305',
    '00000000-0000-4000-8000-000000004105',
    pg_catalog.decode(pg_catalog.lpad('4305', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('6305', 128, '0'), 'hex'),
    'Deletion race key'
  );

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
    '00000000-0000-4000-8000-000000004203',
    '00000000-0000-4000-8000-000000004103',
    pg_catalog.decode(pg_catalog.lpad('4203', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour',
    'enrollment',
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000004204',
    '00000000-0000-4000-8000-000000004104',
    pg_catalog.decode(pg_catalog.lpad('4204', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour',
    'passkey',
    '00000000-0000-4000-8000-000000004304'
  ),
  (
    '00000000-0000-4000-8000-000000004205',
    '00000000-0000-4000-8000-000000004105',
    pg_catalog.decode(pg_catalog.lpad('4205', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour',
    'passkey',
    '00000000-0000-4000-8000-000000004305'
  );

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT viberacing_api.create_auth_challenge(
  '00000000-0000-4000-8000-000000004203',
  pg_catalog.decode(pg_catalog.lpad('4203', 64, '0'), 'hex'),
  '00000000-0000-4000-8000-000000004603',
  'passkey_registration',
  pg_catalog.decode(pg_catalog.lpad('4603', 64, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('8603', 64, '0'), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
);

SELECT viberacing_api.create_auth_challenge(
  '00000000-0000-4000-8000-000000004205',
  pg_catalog.decode(pg_catalog.lpad('4205', 64, '0'), 'hex'),
  '00000000-0000-4000-8000-000000004605',
  'profile_deletion',
  pg_catalog.decode(pg_catalog.lpad('4605', 64, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('8605', 64, '0'), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
);

SELECT viberacing_api.consume_passkey_challenge(
  '00000000-0000-4000-8000-000000004205',
  pg_catalog.decode(pg_catalog.lpad('4205', 64, '0'), 'hex'),
  '00000000-0000-4000-8000-000000004605',
  'profile_deletion',
  pg_catalog.decode(pg_catalog.lpad('4605', 64, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('8605', 64, '0'), 'hex'),
  '00000000-0000-4000-8000-000000004305',
  1,
  false
);

RESET ROLE;
COMMIT;
