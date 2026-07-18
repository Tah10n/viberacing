\set ON_ERROR_STOP on

-- Synthetic fixtures for the invite-cleanup worker race. The isolated integration database is
-- portless, tmpfs-backed, and destroyed by the runner.

BEGIN;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.invites (
  invite_id,
  verifier_digest,
  state,
  created_at,
  expires_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000033201',
    pg_catalog.decode(pg_catalog.lpad('33201', 64, '0'), 'hex'),
    'active',
    pg_catalog.statement_timestamp() - INTERVAL '1 hour',
    pg_catalog.statement_timestamp() - INTERVAL '10 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000033202',
    pg_catalog.decode(pg_catalog.lpad('33202', 64, '0'), 'hex'),
    'revoked',
    pg_catalog.statement_timestamp() - INTERVAL '1 hour',
    pg_catalog.statement_timestamp() - INTERVAL '5 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000033203',
    pg_catalog.decode(pg_catalog.lpad('33203', 64, '0'), 'hex'),
    'active',
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour'
  );

COMMIT;
