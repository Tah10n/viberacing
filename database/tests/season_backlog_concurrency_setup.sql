\set ON_ERROR_STOP on

-- Two synthetic historical weeks for the serialized backlog-worker race. This state exists only
-- in the isolated, portless, tmpfs-backed PostgreSQL integration project.

BEGIN;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (profile_id, github_user_id, handle, state)
VALUES (
  '00000000-0000-4000-8000-000000040201',
  900000000000040201,
  'backlog-race',
  'active'
);

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES (
  'src_' || pg_catalog.repeat('H', 22),
  '00000000-0000-4000-8000-000000040201'
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
    'src_' || pg_catalog.repeat('H', 22),
    DATE '2001-01-01',
    10000,
    'syn_' || pg_catalog.repeat('H', 22),
    'dev_' || pg_catalog.repeat('H', 22),
    TIMESTAMPTZ '2001-01-02 08:00:00+00',
    TIMESTAMPTZ '2001-01-02 09:00:00+00'
  ),
  (
    'src_' || pg_catalog.repeat('H', 22),
    DATE '2001-01-08',
    20000,
    'syn_' || pg_catalog.repeat('I', 22),
    'dev_' || pg_catalog.repeat('H', 22),
    TIMESTAMPTZ '2001-01-09 08:00:00+00',
    TIMESTAMPTZ '2001-01-09 09:00:00+00'
  );

COMMIT;
