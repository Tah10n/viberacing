\set ON_ERROR_STOP on

-- Deterministic synthetic state for the source-pause versus device-proposal race. This file
-- commits only inside the isolated, portless, tmpfs-backed PostgreSQL integration project.

BEGIN;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (
  profile_id,
  github_user_id,
  handle,
  state
)
VALUES (
  '00000000-0000-4000-8000-000000028104',
  900000000000028104,
  'race-car-proposal-pause',
  'active'
);

INSERT INTO viberacing_private.sessions (
  session_id,
  profile_id,
  verifier_digest,
  expires_at
)
VALUES (
  '00000000-0000-4000-8000-000000028204',
  '00000000-0000-4000-8000-000000028104',
  pg_catalog.decode(pg_catalog.lpad('28204', 64, '0'), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '1 hour'
);

INSERT INTO viberacing_private.codex_sources (
  source_id,
  profile_id,
  state
)
VALUES (
  'src_' || pg_catalog.repeat('4', 22),
  '00000000-0000-4000-8000-000000028104',
  'active'
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
  '00000000-0000-4000-8000-000000028404',
  'dev_' || pg_catalog.repeat('4', 22),
  'src_' || pg_catalog.repeat('4', 22),
  pg_catalog.decode(pg_catalog.lpad('28404', 64, '0'), 'hex'),
  'Synthetic proposal race device',
  '0.1.0',
  'linux',
  'x86_64',
  'active',
  pg_catalog.statement_timestamp()
);

COMMIT;
