\set ON_ERROR_STOP on

-- Deterministic synthetic fixtures for cross-connection recovery races. This file commits only to
-- the isolated, portless, tmpfs-backed PostgreSQL integration project, which is destroyed in the
-- runner's finally block. It must never be pointed at a shared database.

BEGIN;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (profile_id, github_user_id, handle, state)
VALUES
  (
    '00000000-0000-4000-8000-000000005101',
    900000000000005101,
    'race-recovery-code',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000005102',
    900000000000005102,
    'race-recovery-rotate',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000005103',
    900000000000005103,
    'race-recovery-login',
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
    '00000000-0000-4000-8000-000000005302',
    '00000000-0000-4000-8000-000000005102',
    pg_catalog.decode(pg_catalog.repeat('32', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('42', 64), 'hex'),
    'Recovery rotation race key'
  ),
  (
    '00000000-0000-4000-8000-000000005303',
    '00000000-0000-4000-8000-000000005103',
    pg_catalog.decode(pg_catalog.repeat('33', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('43', 64), 'hex'),
    'Recovery completion race old key'
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
    '00000000-0000-4000-8000-000000005202',
    '00000000-0000-4000-8000-000000005102',
    pg_catalog.decode(pg_catalog.repeat('52', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour',
    'passkey',
    '00000000-0000-4000-8000-000000005302'
  ),
  (
    '00000000-0000-4000-8000-000000005203',
    '00000000-0000-4000-8000-000000005103',
    pg_catalog.decode(pg_catalog.repeat('53', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour',
    'passkey',
    '00000000-0000-4000-8000-000000005303'
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
    '00000000-0000-4000-8000-000000005701',
    '00000000-0000-4000-8000-000000005101',
    '00000000-0000-4000-8000-000000005601',
    0,
    '$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$' || pg_catalog.repeat('l', 32)
  ),
  (
    '00000000-0000-4000-8000-000000005702',
    '00000000-0000-4000-8000-000000005102',
    '00000000-0000-4000-8000-000000005602',
    0,
    '$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$' || pg_catalog.repeat('m', 32)
  ),
  (
    '00000000-0000-4000-8000-000000005703',
    '00000000-0000-4000-8000-000000005103',
    '00000000-0000-4000-8000-000000005603',
    0,
    '$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$' || pg_catalog.repeat('n', 32)
  );

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT viberacing_api.create_recovery_change_challenge(
  '00000000-0000-4000-8000-000000005202',
  pg_catalog.decode(pg_catalog.repeat('52', 32), 'hex'),
  '00000000-0000-4000-8000-000000005802',
  pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('83', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
);

SELECT viberacing_api.consume_passkey_challenge(
  '00000000-0000-4000-8000-000000005202',
  pg_catalog.decode(pg_catalog.repeat('52', 32), 'hex'),
  '00000000-0000-4000-8000-000000005802',
  'recovery_change',
  pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('83', 32), 'hex'),
  '00000000-0000-4000-8000-000000005302',
  1,
  false
);

SELECT viberacing_api.start_recovery(
  '00000000-0000-4000-8000-000000005703',
  '00000000-0000-4000-8000-000000005913',
  pg_catalog.decode(pg_catalog.repeat('91', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('92', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('93', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '9 minutes',
  '00000000-0000-4000-8000-000000005903',
  'req_' || pg_catalog.repeat('R', 22)
);

SELECT viberacing_api.create_passkey_login_challenge(
  '00000000-0000-4000-8000-000000005803',
  pg_catalog.decode(pg_catalog.repeat('84', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('85', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
);

RESET ROLE;
COMMIT;
