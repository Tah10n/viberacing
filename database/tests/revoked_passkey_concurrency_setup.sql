\set ON_ERROR_STOP on

-- Synthetic fixtures for the revoked-passkey cleanup worker race. The isolated integration
-- database is portless, tmpfs-backed, and destroyed by the runner.

BEGIN;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (profile_id, github_user_id, handle, state)
VALUES (
  '00000000-0000-4000-8000-000000039101',
  900000000000039101,
  'revoked-passkey-race',
  'active'
);

INSERT INTO viberacing_private.passkeys (
  passkey_id,
  profile_id,
  credential_id,
  cose_public_key,
  label,
  state,
  created_at,
  revoked_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000039201',
    '00000000-0000-4000-8000-000000039101',
    pg_catalog.decode(pg_catalog.lpad('39201', 32, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('39211', 64, '0'), 'hex'),
    'First revoked-passkey race row',
    'revoked',
    pg_catalog.statement_timestamp() - INTERVAL '230 days',
    pg_catalog.statement_timestamp() - INTERVAL '220 days'
  ),
  (
    '00000000-0000-4000-8000-000000039202',
    '00000000-0000-4000-8000-000000039101',
    pg_catalog.decode(pg_catalog.lpad('39202', 32, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('39212', 64, '0'), 'hex'),
    'Second revoked-passkey race row',
    'revoked',
    pg_catalog.statement_timestamp() - INTERVAL '210 days',
    pg_catalog.statement_timestamp() - INTERVAL '200 days'
  ),
  (
    '00000000-0000-4000-8000-000000039203',
    '00000000-0000-4000-8000-000000039101',
    pg_catalog.decode(pg_catalog.lpad('39203', 32, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('39213', 64, '0'), 'hex'),
    'Recent revoked-passkey race row',
    'revoked',
    pg_catalog.statement_timestamp() - INTERVAL '189 days',
    pg_catalog.statement_timestamp() - INTERVAL '179 days'
  ),
  (
    '00000000-0000-4000-8000-000000039204',
    '00000000-0000-4000-8000-000000039101',
    pg_catalog.decode(pg_catalog.lpad('39204', 32, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('39214', 64, '0'), 'hex'),
    'Active revoked-passkey race control',
    'active',
    pg_catalog.statement_timestamp() - INTERVAL '230 days',
    NULL
  );

COMMIT;
