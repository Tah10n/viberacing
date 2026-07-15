\set ON_ERROR_STOP on

-- Deterministic synthetic fixtures for the cleanup-worker lock race. This file commits only to
-- the isolated, portless, tmpfs-backed PostgreSQL integration project, which is destroyed in the
-- runner's finally block. It must never be pointed at a shared database.

BEGIN;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (profile_id, github_user_id, handle, state)
VALUES (
  '00000000-0000-4000-8000-000000013101',
  900000000000013101,
  'cleanup-race',
  'active'
);

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES (
  'src_' || pg_catalog.repeat('C', 22),
  '00000000-0000-4000-8000-000000013101'
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
  '00000000-0000-4000-8000-000000013401',
  'dev_' || pg_catalog.repeat('C', 22),
  'src_' || pg_catalog.repeat('C', 22),
  pg_catalog.decode(pg_catalog.lpad('13401', 64, '0'), 'hex'),
  'Concurrent cleanup connector',
  '1.2.3',
  'linux',
  'x86_64',
  'active',
  pg_catalog.statement_timestamp()
);

INSERT INTO viberacing_private.usage_snapshots (
  usage_snapshot_id,
  device_key_id,
  device_id,
  source_id,
  sync_id,
  observed_at,
  connector_version,
  codex_version,
  body_digest,
  signature,
  nonce_digest,
  outcome,
  quarantine_reason,
  entry_count,
  received_at,
  retention_expires_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000013501',
    '00000000-0000-4000-8000-000000013401',
    'dev_' || pg_catalog.repeat('C', 22),
    'src_' || pg_catalog.repeat('C', 22),
    'syn_' || pg_catalog.repeat('4', 22),
    pg_catalog.statement_timestamp() - INTERVAL '33 days',
    '1.2.3',
    '4.5.6',
    pg_catalog.decode(pg_catalog.lpad('13501', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('23501', 128, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('33501', 64, '0'), 'hex'),
    'accepted',
    NULL,
    1,
    pg_catalog.statement_timestamp() - INTERVAL '33 days',
    pg_catalog.statement_timestamp() - INTERVAL '3 days'
  ),
  (
    '00000000-0000-4000-8000-000000013502',
    '00000000-0000-4000-8000-000000013401',
    'dev_' || pg_catalog.repeat('C', 22),
    'src_' || pg_catalog.repeat('C', 22),
    'syn_' || pg_catalog.repeat('5', 22),
    pg_catalog.statement_timestamp() - INTERVAL '32 days',
    '1.2.3',
    '4.5.6',
    pg_catalog.decode(pg_catalog.lpad('13502', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('23502', 128, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('33502', 64, '0'), 'hex'),
    'accepted',
    NULL,
    1,
    pg_catalog.statement_timestamp() - INTERVAL '32 days',
    pg_catalog.statement_timestamp() - INTERVAL '2 days'
  ),
  (
    '00000000-0000-4000-8000-000000013503',
    '00000000-0000-4000-8000-000000013401',
    'dev_' || pg_catalog.repeat('C', 22),
    'src_' || pg_catalog.repeat('C', 22),
    'syn_' || pg_catalog.repeat('6', 22),
    pg_catalog.statement_timestamp(),
    '1.2.3',
    '4.5.6',
    pg_catalog.decode(pg_catalog.lpad('13503', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('23503', 128, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('33503', 64, '0'), 'hex'),
    'accepted',
    NULL,
    1,
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp() + INTERVAL '30 days'
  );

INSERT INTO viberacing_private.usage_snapshot_entries (
  usage_snapshot_id,
  codex_reported_date,
  tokens
)
VALUES
  ('00000000-0000-4000-8000-000000013501', '2026-07-13', 400),
  ('00000000-0000-4000-8000-000000013502', '2026-07-14', 500),
  ('00000000-0000-4000-8000-000000013503', '2026-07-15', 600);

INSERT INTO viberacing_private.source_day_values (
  source_id,
  codex_reported_date,
  tokens,
  accepted_snapshot_id,
  accepted_sync_id,
  accepted_device_id,
  first_accepted_at,
  last_accepted_at
)
VALUES
  (
    'src_' || pg_catalog.repeat('C', 22),
    '2026-07-13',
    400,
    '00000000-0000-4000-8000-000000013501',
    'syn_' || pg_catalog.repeat('4', 22),
    'dev_' || pg_catalog.repeat('C', 22),
    pg_catalog.statement_timestamp() - INTERVAL '33 days',
    pg_catalog.statement_timestamp() - INTERVAL '33 days'
  ),
  (
    'src_' || pg_catalog.repeat('C', 22),
    '2026-07-14',
    500,
    '00000000-0000-4000-8000-000000013502',
    'syn_' || pg_catalog.repeat('5', 22),
    'dev_' || pg_catalog.repeat('C', 22),
    pg_catalog.statement_timestamp() - INTERVAL '32 days',
    pg_catalog.statement_timestamp() - INTERVAL '32 days'
  ),
  (
    'src_' || pg_catalog.repeat('C', 22),
    '2026-07-15',
    600,
    '00000000-0000-4000-8000-000000013503',
    'syn_' || pg_catalog.repeat('6', 22),
    'dev_' || pg_catalog.repeat('C', 22),
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp()
  );

INSERT INTO viberacing_private.device_nonces (
  device_key_id,
  nonce_digest,
  received_at,
  expires_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000013401',
    pg_catalog.decode(pg_catalog.lpad('43501', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp() - INTERVAL '1 hour',
    pg_catalog.statement_timestamp() - INTERVAL '30 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000013401',
    pg_catalog.decode(pg_catalog.lpad('43502', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp() - INTERVAL '45 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '15 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000013401',
    pg_catalog.decode(pg_catalog.lpad('43503', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp() + INTERVAL '15 minutes'
  );

COMMIT;
