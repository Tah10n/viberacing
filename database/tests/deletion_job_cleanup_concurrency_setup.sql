\set ON_ERROR_STOP on

-- Synthetic fixtures for the terminal deletion-job cleanup worker race. The isolated integration
-- database is portless, tmpfs-backed, and destroyed by the runner.

BEGIN;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.deletion_jobs (
  deletion_job_id,
  profile_ref_digest,
  state,
  requested_at,
  available_at,
  completed_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000035201',
    pg_catalog.decode(pg_catalog.lpad('35201', 64, '0'), 'hex'),
    'purged',
    pg_catalog.statement_timestamp() - INTERVAL '50 days',
    pg_catalog.statement_timestamp() - INTERVAL '50 days',
    pg_catalog.statement_timestamp() - INTERVAL '40 days'
  ),
  (
    '00000000-0000-4000-8000-000000035202',
    pg_catalog.decode(pg_catalog.lpad('35202', 64, '0'), 'hex'),
    'purged',
    pg_catalog.statement_timestamp() - INTERVAL '45 days',
    pg_catalog.statement_timestamp() - INTERVAL '45 days',
    pg_catalog.statement_timestamp() - INTERVAL '35 days'
  ),
  (
    '00000000-0000-4000-8000-000000035203',
    pg_catalog.decode(pg_catalog.lpad('35203', 64, '0'), 'hex'),
    'purged',
    pg_catalog.statement_timestamp() - INTERVAL '20 days',
    pg_catalog.statement_timestamp() - INTERVAL '20 days',
    pg_catalog.statement_timestamp() - INTERVAL '10 days'
  );

COMMIT;
