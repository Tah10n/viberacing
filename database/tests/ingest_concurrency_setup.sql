\set ON_ERROR_STOP on

-- Deterministic synthetic fixtures for cross-connection ingest races. This file commits only to
-- the isolated, portless, tmpfs-backed PostgreSQL integration project, which is destroyed in the
-- runner's finally block. It must never be pointed at a shared database.

BEGIN;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (
  profile_id,
  github_user_id,
  handle,
  state
)
VALUES
  (
    '00000000-0000-4000-8000-000000011101',
    900000000000011101,
    'race-sync-retry',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000011102',
    900000000000011102,
    'race-sync-devices',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000011103',
    900000000000011103,
    'race-sync-pause',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000011104',
    900000000000011104,
    'race-sync-revoke',
    'active'
  );

INSERT INTO viberacing_private.sessions (
  session_id,
  profile_id,
  verifier_digest,
  expires_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000011201',
    '00000000-0000-4000-8000-000000011103',
    pg_catalog.decode(pg_catalog.lpad('11201', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour'
  ),
  (
    '00000000-0000-4000-8000-000000011202',
    '00000000-0000-4000-8000-000000011104',
    pg_catalog.decode(pg_catalog.lpad('11202', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour'
  );

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES
  (
    'src_' || pg_catalog.repeat('S', 22),
    '00000000-0000-4000-8000-000000011101'
  ),
  (
    'src_' || pg_catalog.repeat('T', 22),
    '00000000-0000-4000-8000-000000011102'
  ),
  (
    'src_' || pg_catalog.repeat('W', 22),
    '00000000-0000-4000-8000-000000011103'
  ),
  (
    'src_' || pg_catalog.repeat('Z', 22),
    '00000000-0000-4000-8000-000000011104'
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
VALUES
  (
    '00000000-0000-4000-8000-000000011401',
    'dev_' || pg_catalog.repeat('S', 22),
    'src_' || pg_catalog.repeat('S', 22),
    pg_catalog.decode(pg_catalog.lpad('11401', 64, '0'), 'hex'),
    'Concurrent retry connector',
    '1.2.3',
    'linux',
    'x86_64',
    'active',
    pg_catalog.statement_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000011402',
    'dev_' || pg_catalog.repeat('T', 22),
    'src_' || pg_catalog.repeat('T', 22),
    pg_catalog.decode(pg_catalog.lpad('11402', 64, '0'), 'hex'),
    'Concurrent higher connector',
    '1.2.3',
    'linux',
    'x86_64',
    'active',
    pg_catalog.statement_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000011403',
    'dev_' || pg_catalog.repeat('U', 22),
    'src_' || pg_catalog.repeat('T', 22),
    pg_catalog.decode(pg_catalog.lpad('11403', 64, '0'), 'hex'),
    'Concurrent lower connector',
    '1.2.3',
    'windows',
    'aarch64',
    'active',
    pg_catalog.statement_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000011404',
    'dev_' || pg_catalog.repeat('W', 22),
    'src_' || pg_catalog.repeat('W', 22),
    pg_catalog.decode(pg_catalog.lpad('11404', 64, '0'), 'hex'),
    'Concurrent pause connector',
    '1.2.3',
    'macos',
    'aarch64',
    'active',
    pg_catalog.statement_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000011405',
    'dev_' || pg_catalog.repeat('Z', 22),
    'src_' || pg_catalog.repeat('Z', 22),
    pg_catalog.decode(pg_catalog.lpad('11405', 64, '0'), 'hex'),
    'Concurrent revoke connector',
    '1.2.3',
    'linux',
    'x86_64',
    'active',
    pg_catalog.statement_timestamp()
  );

COMMIT;
