\set ON_ERROR_STOP on

-- Deterministic synthetic fixtures for the scoring refresh lock race. This file commits only to the
-- isolated, portless, tmpfs-backed PostgreSQL integration project, which is destroyed in finally.

BEGIN;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (profile_id, github_user_id, handle, state)
VALUES (
  '00000000-0000-4000-8000-000000015101',
  900000000000015101,
  'scoring-race',
  'active'
);

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES (
  'src_' || pg_catalog.repeat('9', 22),
  '00000000-0000-4000-8000-000000015101'
);

-- Exercise concurrency over the preserved legacy formula regardless of the calendar date on which
-- the integration runs.
INSERT INTO viberacing_private.seasons (
  season_start,
  season_end,
  score_version,
  state,
  grace_ends_at
)
VALUES (
  pg_catalog.current_setting('viberacing.test_week_start')::date,
  pg_catalog.current_setting('viberacing.test_week_start')::date + 6,
  'community_v1',
  'open',
  viberacing_private.community_season_grace_ends_at(
    pg_catalog.current_setting('viberacing.test_week_start')::date
  )
);

INSERT INTO viberacing_private.device_keys (
  device_key_id,
  device_id,
  source_id,
  public_key,
  label,
  connector_version,
  os_family,
  architecture,
  state,
  activated_at
)
VALUES (
  '00000000-0000-4000-8000-000000015401',
  'dev_' || pg_catalog.repeat('9', 22),
  'src_' || pg_catalog.repeat('9', 22),
  pg_catalog.decode(pg_catalog.lpad('15401', 64, '0'), 'hex'),
  'Concurrent scoring connector',
  '1.2.3',
  'linux',
  'x86_64',
  'active',
  pg_catalog.statement_timestamp()
);

SET LOCAL ROLE viberacing_ingest;

SELECT *
FROM viberacing_api.submit_usage_sync(
  '00000000-0000-4000-8000-000000015401',
  'dev_' || pg_catalog.repeat('9', 22),
  'src_' || pg_catalog.repeat('9', 22),
  'codex',
  'codex_daily_usage_buckets_v1',
  '00000000-0000-4000-8000-000000015501',
  'syn_' || pg_catalog.repeat('9', 22),
  pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()),
  '1.2.3',
  '4.5.6',
  pg_catalog.decode(pg_catalog.lpad('15501', 64, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('25501', 128, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('35501', 64, '0'), 'hex'),
  ARRAY[
    pg_catalog.to_char(
      pg_catalog.current_setting('viberacing.test_week_start')::date,
      'YYYY-MM-DD'
    )
  ],
  ARRAY[100000]::bigint[]
);

COMMIT;
