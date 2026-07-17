\set ON_ERROR_STOP on

-- Synthetic fixtures for deletion-purge worker serialization. The isolated integration database
-- is destroyed by the runner and this setup must never target a shared database.

BEGIN;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (
  profile_id,
  github_user_id,
  handle,
  state,
  hidden_at,
  deletion_requested_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000025101',
    900000000000025101,
    'purge-race-one',
    'deletion_pending',
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000025102',
    900000000000025102,
    'purge-race-two',
    'deletion_pending',
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000025103',
    900000000000025103,
    'purge-race-cross-job',
    'deletion_pending',
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp()
  );

INSERT INTO viberacing_private.deletion_jobs (
  deletion_job_id,
  profile_id,
  profile_ref_digest,
  requested_at,
  available_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000025201',
    '00000000-0000-4000-8000-000000025101',
    pg_catalog.decode(pg_catalog.lpad('25201', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp() - INTERVAL '3 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '3 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000025202',
    '00000000-0000-4000-8000-000000025102',
    pg_catalog.decode(pg_catalog.lpad('25202', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp() - INTERVAL '2 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '2 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000025203',
    '00000000-0000-4000-8000-000000025103',
    pg_catalog.decode(pg_catalog.lpad('25203', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp() - INTERVAL '1 minute',
    pg_catalog.statement_timestamp() - INTERVAL '1 minute'
  );

COMMIT;
