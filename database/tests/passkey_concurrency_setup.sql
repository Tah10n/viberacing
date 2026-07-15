\set ON_ERROR_STOP on

-- Deterministic synthetic fixtures for cross-connection passkey races. This file commits only to
-- the isolated, portless, tmpfs-backed PostgreSQL integration project, which is destroyed in the
-- runner's finally block. It must never be pointed at a shared database.

BEGIN;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (profile_id, github_user_id, handle, state)
VALUES
  (
    '00000000-0000-4000-8000-000000006101',
    900000000000006101,
    'race-passkey-login',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000006102',
    900000000000006102,
    'race-passkey-revoke',
    'active'
  );

INSERT INTO viberacing_private.passkeys (
  passkey_id,
  profile_id,
  credential_id,
  cose_public_key,
  label
)
VALUES
  (
    '00000000-0000-4000-8000-000000006301',
    '00000000-0000-4000-8000-000000006101',
    pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('b1', 64), 'hex'),
    'Login race passkey'
  ),
  (
    '00000000-0000-4000-8000-000000006302',
    '00000000-0000-4000-8000-000000006102',
    pg_catalog.decode(pg_catalog.repeat('a2', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('b2', 64), 'hex'),
    'Revocation race target'
  ),
  (
    '00000000-0000-4000-8000-000000006303',
    '00000000-0000-4000-8000-000000006102',
    pg_catalog.decode(pg_catalog.repeat('a3', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('b3', 64), 'hex'),
    'Revocation race survivor'
  );

INSERT INTO viberacing_private.sessions (
  session_id,
  profile_id,
  verifier_digest,
  expires_at,
  authentication_kind,
  authenticated_by_passkey_id
)
VALUES (
  '00000000-0000-4000-8000-000000006201',
  '00000000-0000-4000-8000-000000006102',
  pg_catalog.decode(pg_catalog.repeat('c1', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '1 hour',
  'passkey',
  '00000000-0000-4000-8000-000000006303'
);

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES (
  'src_' || pg_catalog.repeat('R', 22),
  '00000000-0000-4000-8000-000000006102'
);

INSERT INTO viberacing_private.device_keys (
  device_key_id,
  public_key,
  label,
  connector_version,
  os_family,
  architecture
)
VALUES (
  '00000000-0000-4000-8000-000000006401',
  pg_catalog.decode(pg_catalog.repeat('c2', 32), 'hex'),
  'Revocation race pending connector',
  '5.1.0',
  'linux',
  'x86_64'
);

INSERT INTO viberacing_private.pairing_transactions (
  pairing_id,
  poll_verifier_digest,
  user_code_digest,
  challenge,
  pending_device_key_id,
  device_label,
  connector_version,
  os_family,
  architecture,
  state,
  approved_profile_id,
  source_choice,
  approved_source_id,
  approved_by_session_id,
  approved_by_passkey_id,
  expires_at,
  approved_at
)
VALUES (
  '00000000-0000-4000-8000-000000006501',
  pg_catalog.decode(pg_catalog.repeat('c3', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('c4', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('c5', 32), 'hex'),
  '00000000-0000-4000-8000-000000006401',
  'Revocation race pending connector',
  '5.1.0',
  'linux',
  'x86_64',
  'approved',
  '00000000-0000-4000-8000-000000006102',
  'existing',
  'src_' || pg_catalog.repeat('R', 22),
  '00000000-0000-4000-8000-000000006201',
  '00000000-0000-4000-8000-000000006302',
  pg_catalog.statement_timestamp() + INTERVAL '5 minutes',
  pg_catalog.statement_timestamp()
);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT viberacing_api.create_passkey_login_challenge(
  '00000000-0000-4000-8000-000000006601',
  pg_catalog.decode(pg_catalog.repeat('d1', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('e1', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
);

SELECT viberacing_api.create_passkey_login_challenge(
  '00000000-0000-4000-8000-000000006602',
  pg_catalog.decode(pg_catalog.repeat('d2', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('e2', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
);

SELECT viberacing_api.create_passkey_change_challenge(
  '00000000-0000-4000-8000-000000006201',
  pg_catalog.decode(pg_catalog.repeat('c1', 32), 'hex'),
  'revoke',
  '00000000-0000-4000-8000-000000006302',
  '00000000-0000-4000-8000-000000006603',
  pg_catalog.decode(pg_catalog.repeat('d3', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('e3', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
);

SELECT viberacing_api.consume_passkey_challenge(
  '00000000-0000-4000-8000-000000006201',
  pg_catalog.decode(pg_catalog.repeat('c1', 32), 'hex'),
  '00000000-0000-4000-8000-000000006603',
  'passkey_change',
  pg_catalog.decode(pg_catalog.repeat('d3', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('e3', 32), 'hex'),
  '00000000-0000-4000-8000-000000006303',
  1,
  false
);

RESET ROLE;
COMMIT;
