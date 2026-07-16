\set ON_ERROR_STOP on

-- Synthetic fixtures for the pairing-cleanup worker race. The isolated integration database is
-- portless, tmpfs-backed, and destroyed by the runner; this file must never target shared state.

BEGIN;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.device_keys (
  device_key_id,
  public_key,
  label,
  connector_version,
  os_family,
  architecture,
  created_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000021401',
    pg_catalog.decode(pg_catalog.lpad('21401', 64, '0'), 'hex'),
    'Pairing cleanup race one',
    '6.1.0',
    'linux',
    'x86_64',
    pg_catalog.statement_timestamp() - INTERVAL '20 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000021402',
    pg_catalog.decode(pg_catalog.lpad('21402', 64, '0'), 'hex'),
    'Pairing cleanup race two',
    '6.1.0',
    'linux',
    'x86_64',
    pg_catalog.statement_timestamp() - INTERVAL '19 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000021403',
    pg_catalog.decode(pg_catalog.lpad('21403', 64, '0'), 'hex'),
    'Pairing cleanup live control',
    '6.1.0',
    'linux',
    'x86_64',
    pg_catalog.statement_timestamp()
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
  created_at,
  expires_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000021501',
    pg_catalog.decode(pg_catalog.lpad('21501', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('21601', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('21701', 64, '0'), 'hex'),
    '00000000-0000-4000-8000-000000021401',
    'Pairing cleanup race one',
    '6.1.0',
    'linux',
    'x86_64',
    pg_catalog.statement_timestamp() - INTERVAL '20 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '10 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000021502',
    pg_catalog.decode(pg_catalog.lpad('21502', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('21602', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('21702', 64, '0'), 'hex'),
    '00000000-0000-4000-8000-000000021402',
    'Pairing cleanup race two',
    '6.1.0',
    'linux',
    'x86_64',
    pg_catalog.statement_timestamp() - INTERVAL '19 minutes',
    pg_catalog.statement_timestamp() - INTERVAL '9 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000021503',
    pg_catalog.decode(pg_catalog.lpad('21503', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('21603', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('21703', 64, '0'), 'hex'),
    '00000000-0000-4000-8000-000000021403',
    'Pairing cleanup live control',
    '6.1.0',
    'linux',
    'x86_64',
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp() + INTERVAL '5 minutes'
  );

COMMIT;
