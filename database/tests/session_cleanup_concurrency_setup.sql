\set ON_ERROR_STOP on

-- Synthetic fixtures for the session-cleanup worker race. The isolated integration database is
-- portless, tmpfs-backed, and destroyed by the runner.

BEGIN;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (profile_id, github_user_id, handle, state)
VALUES (
  '00000000-0000-4000-8000-000000031101',
  900000000000031101,
  'session-cleanup-race',
  'active'
);

INSERT INTO viberacing_private.sessions (
  session_id,
  profile_id,
  verifier_digest,
  created_at,
  expires_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000031201',
    '00000000-0000-4000-8000-000000031101',
    pg_catalog.decode(pg_catalog.lpad('31201', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp() - INTERVAL '1 hour',
    pg_catalog.statement_timestamp() - INTERVAL '10 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000031202',
    '00000000-0000-4000-8000-000000031101',
    pg_catalog.decode(pg_catalog.lpad('31202', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp() - INTERVAL '1 hour',
    pg_catalog.statement_timestamp() - INTERVAL '5 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000031203',
    '00000000-0000-4000-8000-000000031101',
    pg_catalog.decode(pg_catalog.lpad('31203', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour'
  );

COMMIT;
