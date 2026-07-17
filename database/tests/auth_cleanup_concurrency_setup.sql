\set ON_ERROR_STOP on

-- Synthetic fixtures for the authentication-cleanup worker race. The isolated integration
-- database is portless, tmpfs-backed, and destroyed by the runner.

BEGIN;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (profile_id, github_user_id, handle, state)
VALUES
  ('00000000-0000-4000-8000-000000024101', 900000000000024101, 'auth-race-one', 'active'),
  ('00000000-0000-4000-8000-000000024102', 900000000000024102, 'auth-race-two', 'active'),
  ('00000000-0000-4000-8000-000000024103', 900000000000024103, 'auth-race-live', 'active'),
  ('00000000-0000-4000-8000-000000024104', 900000000000024104, 'auth-recovery-race', 'active');

INSERT INTO viberacing_private.auth_challenges (
  challenge_id,
  purpose,
  challenge_digest,
  context_digest,
  created_at,
  expires_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000024201',
    'passkey_login',
    pg_catalog.decode(pg_catalog.lpad('24201', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('24301', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp() - INTERVAL '12 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '7 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000024202',
    'passkey_login',
    pg_catalog.decode(pg_catalog.lpad('24202', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('24302', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp() - INTERVAL '10 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '5 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000024203',
    'passkey_login',
    pg_catalog.decode(pg_catalog.lpad('24203', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('24303', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp() + INTERVAL '5 minutes'
  );

INSERT INTO viberacing_private.recovery_codes (
  recovery_code_id,
  profile_id,
  batch_id,
  position,
  verifier_phc,
  created_at,
  used_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000024301',
    '00000000-0000-4000-8000-000000024101',
    '00000000-0000-4000-8000-000000024311',
    0,
    NULL,
    pg_catalog.statement_timestamp() - INTERVAL '12 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '11 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000024302',
    '00000000-0000-4000-8000-000000024102',
    '00000000-0000-4000-8000-000000024312',
    0,
    NULL,
    pg_catalog.statement_timestamp() - INTERVAL '10 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '9 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000024303',
    '00000000-0000-4000-8000-000000024103',
    '00000000-0000-4000-8000-000000024313',
    0,
    NULL,
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000024304',
    '00000000-0000-4000-8000-000000024104',
    '00000000-0000-4000-8000-000000024314',
    0,
    NULL,
    pg_catalog.statement_timestamp() - INTERVAL '6 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '5 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000024305',
    '00000000-0000-4000-8000-000000024104',
    '00000000-0000-4000-8000-000000024314',
    1,
    '$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$' || pg_catalog.repeat('r', 32),
    pg_catalog.statement_timestamp(),
    NULL
  );

INSERT INTO viberacing_private.recovery_authorities (
  recovery_authority_id,
  profile_id,
  source_recovery_code_id,
  verifier_digest,
  challenge_digest,
  context_digest,
  created_at,
  expires_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000024401',
    '00000000-0000-4000-8000-000000024101',
    '00000000-0000-4000-8000-000000024301',
    pg_catalog.decode(pg_catalog.lpad('24401', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('24501', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('24601', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp() - INTERVAL '12 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '7 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000024402',
    '00000000-0000-4000-8000-000000024102',
    '00000000-0000-4000-8000-000000024302',
    pg_catalog.decode(pg_catalog.lpad('24402', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('24502', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('24602', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp() - INTERVAL '10 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '5 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000024403',
    '00000000-0000-4000-8000-000000024103',
    '00000000-0000-4000-8000-000000024303',
    pg_catalog.decode(pg_catalog.lpad('24403', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('24503', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('24603', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp() + INTERVAL '5 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000024404',
    '00000000-0000-4000-8000-000000024104',
    '00000000-0000-4000-8000-000000024304',
    pg_catalog.decode(pg_catalog.lpad('24404', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('24504', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('24604', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp() - INTERVAL '6 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '1 minute'
  );

COMMIT;
