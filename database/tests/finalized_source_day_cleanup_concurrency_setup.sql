\set ON_ERROR_STOP on

-- Synthetic fixtures for finalized source-day worker serialization and finalization overlap. The
-- isolated integration database is destroyed by the runner and this setup must not target shared
-- state.

BEGIN;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (profile_id, github_user_id, handle, state)
VALUES
  (
    '00000000-0000-4000-8000-000000039701',
    900000000000039701,
    'source-retention-race-a',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000039702',
    900000000000039702,
    'source-retention-race-b',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000039703',
    900000000000039703,
    'source-finalize-race',
    'active'
  );

INSERT INTO viberacing_private.profiles (
  profile_id,
  github_user_id,
  handle,
  state,
  hidden_at,
  deletion_requested_at
)
VALUES (
  '00000000-0000-4000-8000-000000039704',
  900000000000039704,
  'source-purge-race',
  'deletion_pending',
  pg_catalog.statement_timestamp(),
  pg_catalog.statement_timestamp()
);

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES
  ('src_' || pg_catalog.lpad('39701', 22, 'R'), '00000000-0000-4000-8000-000000039701'),
  ('src_' || pg_catalog.lpad('39702', 22, 'S'), '00000000-0000-4000-8000-000000039702'),
  ('src_' || pg_catalog.lpad('39703', 22, 'T'), '00000000-0000-4000-8000-000000039703'),
  ('src_' || pg_catalog.lpad('39704', 22, 'V'), '00000000-0000-4000-8000-000000039704');

INSERT INTO viberacing_private.seasons (
  season_start,
  season_end,
  score_version,
  created_at,
  refreshed_at,
  grace_ends_at
)
VALUES (
  DATE '2008-01-07',
  DATE '2008-01-13',
  'community_v1',
  TIMESTAMPTZ '2008-01-07 00:00:00+00',
  TIMESTAMPTZ '2008-01-16 00:30:00+00',
  viberacing_private.community_season_grace_ends_at(DATE '2008-01-07')
);

INSERT INTO viberacing_private.source_day_values (
  source_id,
  codex_reported_date,
  tokens,
  accepted_sync_id,
  accepted_device_id,
  first_accepted_at,
  last_accepted_at
)
VALUES
  (
    'src_' || pg_catalog.lpad('39701', 22, 'R'),
    DATE '2008-01-07',
    100,
    'syn_' || pg_catalog.repeat('X', 22),
    'dev_' || pg_catalog.repeat('X', 22),
    TIMESTAMPTZ '2008-01-09 08:00:00+00',
    TIMESTAMPTZ '2008-01-09 09:00:00+00'
  ),
  (
    'src_' || pg_catalog.lpad('39702', 22, 'S'),
    DATE '2008-01-08',
    200,
    'syn_' || pg_catalog.repeat('Y', 22),
    'dev_' || pg_catalog.repeat('Y', 22),
    TIMESTAMPTZ '2008-01-10 08:00:00+00',
    TIMESTAMPTZ '2008-01-10 09:00:00+00'
  ),
  (
    'src_' || pg_catalog.lpad('39703', 22, 'T'),
    DATE '2009-01-05',
    300,
    'syn_' || pg_catalog.repeat('Z', 22),
    'dev_' || pg_catalog.repeat('Z', 22),
    TIMESTAMPTZ '2009-01-07 08:00:00+00',
    TIMESTAMPTZ '2009-01-07 09:00:00+00'
  ),
  (
    'src_' || pg_catalog.lpad('39704', 22, 'V'),
    DATE '2008-01-09',
    400,
    'syn_' || pg_catalog.repeat('W', 22),
    'dev_' || pg_catalog.repeat('W', 22),
    TIMESTAMPTZ '2008-01-11 08:00:00+00',
    TIMESTAMPTZ '2008-01-11 09:00:00+00'
  );

INSERT INTO viberacing_private.deletion_jobs (
  deletion_job_id,
  profile_id,
  profile_ref_digest,
  requested_at,
  available_at
)
VALUES (
  '00000000-0000-4000-8000-000000039804',
  '00000000-0000-4000-8000-000000039704',
  pg_catalog.decode(pg_catalog.lpad('39804', 64, '0'), 'hex'),
  pg_catalog.statement_timestamp() - INTERVAL '1 year',
  pg_catalog.statement_timestamp() - INTERVAL '1 year'
);

UPDATE viberacing_private.seasons
SET state = 'finalized',
  finalized_at = TIMESTAMPTZ '2008-01-16 01:00:00+00'
WHERE season_start = DATE '2008-01-07';

COMMIT;
