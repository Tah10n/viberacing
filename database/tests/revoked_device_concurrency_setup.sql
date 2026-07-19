\set ON_ERROR_STOP on

-- Synthetic fixtures for the revoked-device cleanup worker race. The isolated integration
-- database is portless, tmpfs-backed, and destroyed by the runner.

BEGIN;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (profile_id, github_user_id, handle, state)
VALUES (
  '00000000-0000-4000-8000-000000041101',
  900000000000041101,
  'revoked-device-race',
  'active'
);

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES (
  'src_' || pg_catalog.repeat('E', 22),
  '00000000-0000-4000-8000-000000041101'
);

INSERT INTO viberacing_private.passkeys (
  passkey_id,
  profile_id,
  credential_id,
  cose_public_key,
  label,
  created_at
)
VALUES (
  '00000000-0000-4000-8000-000000041501',
  '00000000-0000-4000-8000-000000041101',
  pg_catalog.decode(pg_catalog.repeat('51', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('52', 64), 'hex'),
  'Revoked-device race passkey',
  pg_catalog.statement_timestamp() - INTERVAL '250 days'
);

INSERT INTO viberacing_private.sessions (
  session_id,
  profile_id,
  verifier_digest,
  state,
  created_at,
  expires_at,
  authentication_kind,
  authenticated_by_passkey_id
)
VALUES (
  '00000000-0000-4000-8000-000000041601',
  '00000000-0000-4000-8000-000000041101',
  pg_catalog.decode(pg_catalog.lpad('41601', 64, '0'), 'hex'),
  'active',
  pg_catalog.statement_timestamp() - INTERVAL '250 days',
  pg_catalog.statement_timestamp() + INTERVAL '1 day',
  'passkey',
  '00000000-0000-4000-8000-000000041501'
);

INSERT INTO viberacing_private.device_keys (
  device_key_id,
  public_key,
  label,
  connector_version,
  os_family,
  architecture,
  created_at
)
SELECT
  ('00000000-0000-4000-8000-000000041' || pg_catalog.lpad((200 + item)::text, 3, '0'))::uuid,
  pg_catalog.decode(pg_catalog.lpad(pg_catalog.to_hex(41200 + item), 64, '0'), 'hex'),
  CASE
    WHEN item = 4 THEN 'Active revoked-device race control'
    ELSE 'Revoked-device race ' || item
  END,
  '10.1.' || item,
  'linux',
  'x86_64',
  pg_catalog.statement_timestamp() - INTERVAL '240 days'
FROM pg_catalog.generate_series(1, 4) AS generated_item(item);

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
  created_at,
  expires_at
)
SELECT
  ('00000000-0000-4000-8000-000000041' || pg_catalog.lpad((300 + item)::text, 3, '0'))::uuid,
  pg_catalog.decode(pg_catalog.lpad(pg_catalog.to_hex(41300 + item), 64, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad(pg_catalog.to_hex(41400 + item), 64, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad(pg_catalog.to_hex(41500 + item), 64, '0'), 'hex'),
  ('00000000-0000-4000-8000-000000041' || pg_catalog.lpad((200 + item)::text, 3, '0'))::uuid,
  CASE WHEN item = 4 THEN 'Active revoked-device race control' ELSE 'Revoked-device race ' || item END,
  '10.1.' || item,
  'linux',
  'x86_64',
  pg_catalog.statement_timestamp() - INTERVAL '240 days',
  pg_catalog.statement_timestamp() - INTERVAL '220 days'
FROM pg_catalog.generate_series(1, 4) AS generated_item(item);

UPDATE viberacing_private.pairing_transactions
SET
  state = 'approved',
  approved_profile_id = '00000000-0000-4000-8000-000000041101',
  source_choice = 'existing',
  approved_source_id = 'src_' || pg_catalog.repeat('E', 22),
  approved_by_session_id = '00000000-0000-4000-8000-000000041601',
  approved_by_passkey_id = '00000000-0000-4000-8000-000000041501',
  approved_at = pg_catalog.statement_timestamp() - INTERVAL '235 days'
WHERE pairing_id BETWEEN
  '00000000-0000-4000-8000-000000041301' AND '00000000-0000-4000-8000-000000041304';

UPDATE viberacing_private.device_keys AS device_record
SET
  state = 'active',
  source_id = 'src_' || pg_catalog.repeat('E', 22),
  device_id = 'dev_' || pg_catalog.repeat('E', 21) || device_number.item,
  activated_at = pg_catalog.statement_timestamp() - INTERVAL '230 days'
FROM pg_catalog.generate_series(1, 4) AS device_number(item)
WHERE device_record.device_key_id = (
  '00000000-0000-4000-8000-000000041'
  || pg_catalog.lpad((200 + device_number.item)::text, 3, '0')
)::uuid;

UPDATE viberacing_private.pairing_transactions AS pairing_record
SET
  state = 'activated',
  activated_device_id = 'dev_' || pg_catalog.repeat('E', 21) || pairing_number.item,
  activated_at = pg_catalog.statement_timestamp() - INTERVAL '230 days'
FROM pg_catalog.generate_series(1, 4) AS pairing_number(item)
WHERE pairing_record.pairing_id = (
  '00000000-0000-4000-8000-000000041'
  || pg_catalog.lpad((300 + pairing_number.item)::text, 3, '0')
)::uuid;

UPDATE viberacing_private.pairing_transactions
SET
  approved_by_session_id = NULL,
  approved_by_passkey_id = NULL
WHERE pairing_id BETWEEN
  '00000000-0000-4000-8000-000000041301' AND '00000000-0000-4000-8000-000000041304';

UPDATE viberacing_private.device_keys
SET
  state = 'revoked',
  revoked_at = pg_catalog.statement_timestamp() - (
    CASE device_key_id
      WHEN '00000000-0000-4000-8000-000000041201' THEN 220
      WHEN '00000000-0000-4000-8000-000000041202' THEN 200
      ELSE 179
    END
  ) * INTERVAL '1 day'
WHERE device_key_id BETWEEN
  '00000000-0000-4000-8000-000000041201' AND '00000000-0000-4000-8000-000000041203';

COMMIT;
