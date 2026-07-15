\set ON_ERROR_STOP on

-- Deterministic synthetic fixtures for cross-connection lifecycle races. This file commits only
-- to the isolated, portless, tmpfs-backed PostgreSQL integration project, which is destroyed in
-- the runner's finally block. It must never be pointed at a shared database.

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
    '00000000-0000-4000-8000-000000007101',
    900000000000007101,
    'race-source-pause',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000007102',
    900000000000007102,
    'race-source-unlink',
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
    '00000000-0000-4000-8000-000000007201',
    '00000000-0000-4000-8000-000000007101',
    pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour'
  ),
  (
    '00000000-0000-4000-8000-000000007202',
    '00000000-0000-4000-8000-000000007102',
    pg_catalog.decode(pg_catalog.repeat('a2', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour'
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
    '00000000-0000-4000-8000-000000007301',
    '00000000-0000-4000-8000-000000007101',
    pg_catalog.decode(pg_catalog.repeat('b5', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('c5', 64), 'hex'),
    'Pause race passkey'
  ),
  (
    '00000000-0000-4000-8000-000000007302',
    '00000000-0000-4000-8000-000000007102',
    pg_catalog.decode(pg_catalog.repeat('b6', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('c6', 64), 'hex'),
    'Unlink race passkey'
  );

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES
  (
    'src_' || pg_catalog.repeat('L', 22),
    '00000000-0000-4000-8000-000000007101'
  ),
  (
    'src_' || pg_catalog.repeat('N', 22),
    '00000000-0000-4000-8000-000000007102'
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
  '00000000-0000-4000-8000-000000007401',
  'dev_' || pg_catalog.repeat('N', 22),
  'src_' || pg_catalog.repeat('N', 22),
  pg_catalog.decode(pg_catalog.repeat('d0', 32), 'hex'),
  'Unlink race active connector',
  '4.1.0',
  'linux',
  'x86_64',
  'active',
  pg_catalog.statement_timestamp()
);

INSERT INTO viberacing_private.device_keys (
  device_key_id,
  public_key,
  label,
  connector_version,
  os_family,
  architecture
)
VALUES
  (
    '00000000-0000-4000-8000-000000007451',
    pg_catalog.decode(pg_catalog.repeat('d1', 32), 'hex'),
    'Pause race pending connector',
    '4.1.0',
    'linux',
    'x86_64'
  ),
  (
    '00000000-0000-4000-8000-000000007452',
    pg_catalog.decode(pg_catalog.repeat('d2', 32), 'hex'),
    'Unlink race pending connector',
    '4.1.0',
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
  expires_at
)
VALUES (
  '00000000-0000-4000-8000-000000007501',
  pg_catalog.decode(pg_catalog.repeat('d3', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('d4', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('d5', 32), 'hex'),
  '00000000-0000-4000-8000-000000007451',
  'Pause race pending connector',
  '4.1.0',
  'linux',
  'x86_64',
  pg_catalog.statement_timestamp() + INTERVAL '8 minutes'
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
  '00000000-0000-4000-8000-000000007502',
  pg_catalog.decode(pg_catalog.repeat('d6', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('d7', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('d8', 32), 'hex'),
  '00000000-0000-4000-8000-000000007452',
  'Unlink race pending connector',
  '4.1.0',
  'linux',
  'x86_64',
  'approved',
  '00000000-0000-4000-8000-000000007102',
  'existing',
  'src_' || pg_catalog.repeat('N', 22),
  '00000000-0000-4000-8000-000000007202',
  '00000000-0000-4000-8000-000000007302',
  pg_catalog.statement_timestamp() + INTERVAL '8 minutes',
  pg_catalog.statement_timestamp()
);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT viberacing_api.create_pairing_approval_challenge(
  '00000000-0000-4000-8000-000000007201',
  pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
  '00000000-0000-4000-8000-000000007501',
  pg_catalog.decode(pg_catalog.repeat('d4', 32), 'hex'),
  'existing',
  'src_' || pg_catalog.repeat('L', 22),
  '00000000-0000-4000-8000-000000007701',
  pg_catalog.decode(pg_catalog.repeat('e1', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('e2', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
);

SELECT viberacing_api.create_source_action_challenge(
  '00000000-0000-4000-8000-000000007202',
  pg_catalog.decode(pg_catalog.repeat('a2', 32), 'hex'),
  'src_' || pg_catalog.repeat('N', 22),
  'source_unlink',
  '00000000-0000-4000-8000-000000007702',
  pg_catalog.decode(pg_catalog.repeat('e3', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('e4', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
);

SELECT viberacing_api.consume_passkey_challenge(
  '00000000-0000-4000-8000-000000007201',
  pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
  '00000000-0000-4000-8000-000000007701',
  'pairing_approval',
  pg_catalog.decode(pg_catalog.repeat('e1', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('e2', 32), 'hex'),
  '00000000-0000-4000-8000-000000007301',
  0,
  false
);

SELECT viberacing_api.consume_passkey_challenge(
  '00000000-0000-4000-8000-000000007202',
  pg_catalog.decode(pg_catalog.repeat('a2', 32), 'hex'),
  '00000000-0000-4000-8000-000000007702',
  'source_unlink',
  pg_catalog.decode(pg_catalog.repeat('e3', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('e4', 32), 'hex'),
  '00000000-0000-4000-8000-000000007302',
  0,
  false
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

DO $assertion$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.auth_challenges
    WHERE challenge_id IN (
      '00000000-0000-4000-8000-000000007701',
      '00000000-0000-4000-8000-000000007702'
    )
      AND consumed_at IS NOT NULL
      AND authorized_action_used_at IS NULL
  ) <> 2 THEN
    RAISE EXCEPTION 'lifecycle concurrency setup did not consume both synthetic challenges';
  END IF;
END
$assertion$;

COMMIT;
