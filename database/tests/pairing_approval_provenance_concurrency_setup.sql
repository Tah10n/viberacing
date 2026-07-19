\set ON_ERROR_STOP on

-- Synthetic fixtures for the pairing approval-provenance redaction worker race. The isolated
-- integration database is portless, tmpfs-backed, and destroyed by the runner.

BEGIN;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (profile_id, github_user_id, handle, state)
VALUES (
  '00000000-0000-4000-8000-000000037601',
  900000000000037601,
  'pairing-provenance-race',
  'active'
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
  '00000000-0000-4000-8000-000000037602',
  '00000000-0000-4000-8000-000000037601',
  pg_catalog.decode(pg_catalog.lpad('37602', 64, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('37603', 128, '0'), 'hex'),
  'Pairing provenance race passkey',
  pg_catalog.statement_timestamp() - INTERVAL '230 days'
);

INSERT INTO viberacing_private.sessions (
  session_id,
  profile_id,
  verifier_digest,
  authentication_kind,
  authenticated_by_passkey_id,
  created_at,
  expires_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000037611',
    '00000000-0000-4000-8000-000000037601',
    pg_catalog.decode(pg_catalog.lpad('37611', 64, '0'), 'hex'),
    'passkey',
    '00000000-0000-4000-8000-000000037602',
    pg_catalog.statement_timestamp() - INTERVAL '230 days',
    pg_catalog.statement_timestamp() - INTERVAL '210 days'
  ),
  (
    '00000000-0000-4000-8000-000000037612',
    '00000000-0000-4000-8000-000000037601',
    pg_catalog.decode(pg_catalog.lpad('37612', 64, '0'), 'hex'),
    'passkey',
    '00000000-0000-4000-8000-000000037602',
    pg_catalog.statement_timestamp() - INTERVAL '210 days',
    pg_catalog.statement_timestamp() - INTERVAL '190 days'
  ),
  (
    '00000000-0000-4000-8000-000000037613',
    '00000000-0000-4000-8000-000000037601',
    pg_catalog.decode(pg_catalog.lpad('37613', 64, '0'), 'hex'),
    'passkey',
    '00000000-0000-4000-8000-000000037602',
    pg_catalog.statement_timestamp() - INTERVAL '20 days',
    pg_catalog.statement_timestamp() - INTERVAL '1 day'
  );

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES (
  'src_' || pg_catalog.lpad('37601', 22, 'P'),
  '00000000-0000-4000-8000-000000037601'
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
VALUES
  (
    '00000000-0000-4000-8000-000000037621',
    pg_catalog.decode(pg_catalog.lpad('37621', 64, '0'), 'hex'),
    'First provenance race connector',
    '8.0.1',
    'linux',
    'x86_64',
    pg_catalog.statement_timestamp() - INTERVAL '222 days'
  ),
  (
    '00000000-0000-4000-8000-000000037622',
    pg_catalog.decode(pg_catalog.lpad('37622', 64, '0'), 'hex'),
    'Second provenance race connector',
    '8.0.2',
    'windows',
    'x86_64',
    pg_catalog.statement_timestamp() - INTERVAL '202 days'
  ),
  (
    '00000000-0000-4000-8000-000000037623',
    pg_catalog.decode(pg_catalog.lpad('37623', 64, '0'), 'hex'),
    'Recent provenance race connector',
    '8.0.3',
    'macos',
    'aarch64',
    pg_catalog.statement_timestamp() - INTERVAL '12 days'
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
    '00000000-0000-4000-8000-000000037631',
    pg_catalog.decode(pg_catalog.lpad('37631', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('37641', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('37651', 64, '0'), 'hex'),
    '00000000-0000-4000-8000-000000037621',
    'First provenance race connector',
    '8.0.1',
    'linux',
    'x86_64',
    pg_catalog.statement_timestamp() - INTERVAL '222 days',
    pg_catalog.statement_timestamp() - INTERVAL '219 days'
  ),
  (
    '00000000-0000-4000-8000-000000037632',
    pg_catalog.decode(pg_catalog.lpad('37632', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('37642', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('37652', 64, '0'), 'hex'),
    '00000000-0000-4000-8000-000000037622',
    'Second provenance race connector',
    '8.0.2',
    'windows',
    'x86_64',
    pg_catalog.statement_timestamp() - INTERVAL '202 days',
    pg_catalog.statement_timestamp() - INTERVAL '199 days'
  ),
  (
    '00000000-0000-4000-8000-000000037633',
    pg_catalog.decode(pg_catalog.lpad('37633', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('37643', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('37653', 64, '0'), 'hex'),
    '00000000-0000-4000-8000-000000037623',
    'Recent provenance race connector',
    '8.0.3',
    'macos',
    'aarch64',
    pg_catalog.statement_timestamp() - INTERVAL '12 days',
    pg_catalog.statement_timestamp() - INTERVAL '9 days'
  );

UPDATE viberacing_private.pairing_transactions
SET
  state = 'approved',
  approved_profile_id = '00000000-0000-4000-8000-000000037601',
  source_choice = 'existing',
  approved_source_id = 'src_' || pg_catalog.lpad('37601', 22, 'P'),
  approved_by_session_id = CASE pairing_id
    WHEN '00000000-0000-4000-8000-000000037631' THEN '00000000-0000-4000-8000-000000037611'::uuid
    WHEN '00000000-0000-4000-8000-000000037632' THEN '00000000-0000-4000-8000-000000037612'::uuid
    WHEN '00000000-0000-4000-8000-000000037633' THEN '00000000-0000-4000-8000-000000037613'::uuid
  END,
  approved_by_passkey_id = '00000000-0000-4000-8000-000000037602',
  approved_at = CASE pairing_id
    WHEN '00000000-0000-4000-8000-000000037631' THEN pg_catalog.statement_timestamp() - INTERVAL '221 days'
    WHEN '00000000-0000-4000-8000-000000037632' THEN pg_catalog.statement_timestamp() - INTERVAL '201 days'
    WHEN '00000000-0000-4000-8000-000000037633' THEN pg_catalog.statement_timestamp() - INTERVAL '11 days'
  END
WHERE pairing_id BETWEEN
  '00000000-0000-4000-8000-000000037631' AND '00000000-0000-4000-8000-000000037633';

UPDATE viberacing_private.device_keys
SET
  state = 'active',
  source_id = 'src_' || pg_catalog.lpad('37601', 22, 'P'),
  device_id = CASE device_key_id
    WHEN '00000000-0000-4000-8000-000000037621' THEN 'dev_' || pg_catalog.lpad('37621', 22, 'P')
    WHEN '00000000-0000-4000-8000-000000037622' THEN 'dev_' || pg_catalog.lpad('37622', 22, 'P')
    WHEN '00000000-0000-4000-8000-000000037623' THEN 'dev_' || pg_catalog.lpad('37623', 22, 'P')
  END,
  activated_at = CASE device_key_id
    WHEN '00000000-0000-4000-8000-000000037621' THEN pg_catalog.statement_timestamp() - INTERVAL '220 days'
    WHEN '00000000-0000-4000-8000-000000037622' THEN pg_catalog.statement_timestamp() - INTERVAL '200 days'
    WHEN '00000000-0000-4000-8000-000000037623' THEN pg_catalog.statement_timestamp() - INTERVAL '10 days'
  END
WHERE device_key_id BETWEEN
  '00000000-0000-4000-8000-000000037621' AND '00000000-0000-4000-8000-000000037623';

UPDATE viberacing_private.pairing_transactions
SET
  state = 'activated',
  activated_device_id = CASE pairing_id
    WHEN '00000000-0000-4000-8000-000000037631' THEN 'dev_' || pg_catalog.lpad('37621', 22, 'P')
    WHEN '00000000-0000-4000-8000-000000037632' THEN 'dev_' || pg_catalog.lpad('37622', 22, 'P')
    WHEN '00000000-0000-4000-8000-000000037633' THEN 'dev_' || pg_catalog.lpad('37623', 22, 'P')
  END,
  activated_at = CASE pairing_id
    WHEN '00000000-0000-4000-8000-000000037631' THEN pg_catalog.statement_timestamp() - INTERVAL '220 days'
    WHEN '00000000-0000-4000-8000-000000037632' THEN pg_catalog.statement_timestamp() - INTERVAL '200 days'
    WHEN '00000000-0000-4000-8000-000000037633' THEN pg_catalog.statement_timestamp() - INTERVAL '10 days'
  END
WHERE pairing_id BETWEEN
  '00000000-0000-4000-8000-000000037631' AND '00000000-0000-4000-8000-000000037633';

COMMIT;
