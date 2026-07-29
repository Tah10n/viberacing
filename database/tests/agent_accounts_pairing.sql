\set ON_ERROR_STOP on

BEGIN;

SET LOCAL ROLE viberacing_owner;

UPDATE viberacing_private.agent_providers
SET state = 'supported'
WHERE provider_code = 'claude_code';

INSERT INTO viberacing_private.agent_accounting_revisions (
  provider_code,
  accounting_revision,
  reader_contract_version,
  scope_kind,
  utc_date_semantics,
  maximum_backfill_days,
  minimum_connector_version,
  enabled_for_new_accounts
)
VALUES (
  'claude_code',
  1,
  'claude_code_fixture_v1',
  'agent_account',
  'utc_timestamp',
  35,
  '0.0.0',
  true
);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

DO $pairing_rate_policy$
BEGIN
  IF NOT viberacing_api.admit_pairing_transport_request(
    'start',
    pg_catalog.decode(pg_catalog.repeat('10', 32), 'hex'),
    2,
    1,
    60
  ) THEN
    RAISE EXCEPTION 'first fixed-bucket pairing request was not admitted';
  END IF;

  IF viberacing_api.admit_pairing_transport_request(
    'start',
    pg_catalog.decode(pg_catalog.repeat('10', 32), 'hex'),
    2,
    1,
    60
  ) THEN
    RAISE EXCEPTION 'fixed client bucket did not saturate exactly';
  END IF;

  IF viberacing_api.admit_pairing_transport_request(
    'start',
    pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex'),
    2,
    1,
    60
  ) THEN
    RAISE EXCEPTION 'fixed global pairing window did not saturate exactly';
  END IF;
END
$pairing_rate_policy$;

SELECT *
FROM viberacing_api.open_github_profile(
  '30000000-0000-4000-8000-000000000001',
  920000000000001,
  'pending_3000000000004000',
  'en',
  '30000000-0000-4000-8000-000000000002',
  pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
  pg_catalog.transaction_timestamp() + interval '20 minutes',
  NULL,
  NULL,
  false
);

SELECT viberacing_api.begin_initial_passkey(
  '30000000-0000-4000-8000-000000000002',
  pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
  'multi-agent-driver',
  '30000000-0000-4000-8000-000000000003',
  pg_catalog.decode(pg_catalog.repeat('42', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('43', 32), 'hex'),
  pg_catalog.transaction_timestamp() + interval '4 minutes'
);

SELECT viberacing_api.complete_initial_passkey(
  '30000000-0000-4000-8000-000000000002',
  pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
  '30000000-0000-4000-8000-000000000003',
  pg_catalog.decode(pg_catalog.repeat('43', 32), 'hex'),
  'multi-agent-driver',
  '30000000-0000-4000-8000-000000000004',
  pg_catalog.decode(pg_catalog.repeat('44', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('45', 64), 'hex'),
  0,
  true,
  false,
  '30000000-0000-4000-8000-000000000009',
  pg_catalog.decode(pg_catalog.repeat('46', 32), 'hex'),
  pg_catalog.transaction_timestamp() + interval '30 days'
);

DO $batch_pairing$
DECLARE
  v_attach_decisions jsonb;
  v_attach_manifest jsonb;
  v_context bytea;
  v_decisions jsonb;
  v_manifest jsonb;
  v_manifest_digest bytea;
  v_result integer;
  v_rows integer;
  v_wrong_provider_decisions jsonb;
  v_wrong_provider_manifest jsonb;
BEGIN
  v_manifest := jsonb '[
    {
      "candidateId": "cand_AAAAAAAAAAAAAAAAAAAAAA",
      "provider": "codex",
      "readerVersion": "codex_app_server_0_144_5_v1",
      "accountingRevision": 1,
      "scopeKind": "agent_account",
      "fingerprintKind": "stable_opaque",
      "fingerprintDigest": "1111111111111111111111111111111111111111111111111111111111111111",
      "syncPublicKey": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "displayLabel": "Codex personal",
      "preview": {
        "currentWeekTokenTotal": "1200",
        "lastUsageDate": "2026-07-28",
        "status": "ready"
      }
    },
    {
      "candidateId": "cand_BBBBBBBBBBBBBBBBBBBBBB",
      "provider": "codex",
      "readerVersion": "codex_app_server_0_144_5_v1",
      "accountingRevision": 1,
      "scopeKind": "agent_account",
      "fingerprintKind": "stable_opaque",
      "fingerprintDigest": "2222222222222222222222222222222222222222222222222222222222222222",
      "syncPublicKey": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "displayLabel": "Codex work",
      "preview": {
        "currentWeekTokenTotal": "3400",
        "lastUsageDate": "2026-07-27",
        "status": "ready"
      }
    },
    {
      "candidateId": "cand_CCCCCCCCCCCCCCCCCCCCCC",
      "provider": "codex",
      "readerVersion": "codex_app_server_0_144_5_v1",
      "accountingRevision": 1,
      "scopeKind": "agent_account",
      "fingerprintKind": "unavailable",
      "fingerprintDigest": null,
      "syncPublicKey": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "displayLabel": "Codex unavailable identity",
      "preview": {
        "currentWeekTokenTotal": "0",
        "lastUsageDate": null,
        "status": "unavailable"
      }
    }
  ]';
  v_manifest_digest := pg_catalog.sha256(pg_catalog.convert_to(v_manifest::text, 'UTF8'));

  v_result := CASE
    WHEN viberacing_api.start_pairing_batch(
      'pair_AAAAAAAAAAAAAAAAAAAAAA',
      'ins_AAAAAAAAAAAAAAAAAAAAAA',
      pg_catalog.decode(pg_catalog.repeat('51', 32), 'hex'),
      'Main workstation',
      '0.0.0',
      'windows',
      'x86_64',
      v_manifest_digest,
      pg_catalog.decode(pg_catalog.repeat('50', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('52', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('53', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('54', 32), 'hex'),
      pg_catalog.transaction_timestamp() + interval '9 minutes',
      v_manifest
    ) = 'pair_AAAAAAAAAAAAAAAAAAAAAA'
    THEN 1
    ELSE 0
  END;
  IF v_result <> 1 THEN
    RAISE EXCEPTION 'batch start did not return its exact public id';
  END IF;

  BEGIN
    PERFORM viberacing_api.start_pairing_batch(
      'pair_ZZZZZZZZZZZZZZZZZZZZZZ',
      'ins_ZZZZZZZZZZZZZZZZZZZZZZ',
      pg_catalog.decode(pg_catalog.repeat('61', 32), 'hex'),
      'Replayed start proof',
      '0.0.0',
      'windows',
      'x86_64',
      pg_catalog.decode(pg_catalog.repeat('62', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('50', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('63', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('64', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('65', 32), 'hex'),
      pg_catalog.transaction_timestamp() + interval '9 minutes',
      v_manifest
    );
    RAISE EXCEPTION 'pairing start-proof replay unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  IF viberacing_api.read_pairing_batch_by_code(
    '30000000-0000-4000-8000-000000000009',
    pg_catalog.decode(pg_catalog.repeat('46', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('53', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('ff', 32), 'hex')
  ) <> 'pair_AAAAAAAAAAAAAAAAAAAAAA' THEN
    RAISE EXCEPTION 'fallback code did not resolve the exact pending batch';
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO v_rows
  FROM viberacing_api.read_pairing_batch_for_approval(
    '30000000-0000-4000-8000-000000000009',
    pg_catalog.decode(pg_catalog.repeat('46', 32), 'hex'),
    'pair_AAAAAAAAAAAAAAAAAAAAAA'
  );
  IF v_rows <> 3 THEN
    RAISE EXCEPTION 'approval review did not return the complete ordered manifest';
  END IF;

  v_decisions := jsonb '[
    {
      "candidateId": "cand_AAAAAAAAAAAAAAAAAAAAAA",
      "decision": "create",
      "targetAgentAccountId": null,
      "newAgentAccountId": "acc_AAAAAAAAAAAAAAAAAAAAAA",
      "deviceKeyId": "key_AAAAAAAAAAAAAAAAAAAAAA",
      "deviceId": "dev_AAAAAAAAAAAAAAAAAAAAAA",
      "privateLabel": "Codex personal"
    },
    {
      "candidateId": "cand_BBBBBBBBBBBBBBBBBBBBBB",
      "decision": "create",
      "targetAgentAccountId": null,
      "newAgentAccountId": "acc_BBBBBBBBBBBBBBBBBBBBBB",
      "deviceKeyId": "key_BBBBBBBBBBBBBBBBBBBBBB",
      "deviceId": "dev_BBBBBBBBBBBBBBBBBBBBBB",
      "privateLabel": "Codex work"
    },
    {
      "candidateId": "cand_CCCCCCCCCCCCCCCCCCCCCC",
      "decision": "skip",
      "targetAgentAccountId": null,
      "newAgentAccountId": null,
      "deviceKeyId": null,
      "deviceId": null,
      "privateLabel": null
    }
  ]';
  v_context := pg_catalog.decode(pg_catalog.repeat('71', 32), 'hex');
  PERFORM viberacing_api.create_auth_challenge(
    '30000000-0000-4000-8000-000000000009',
    pg_catalog.decode(pg_catalog.repeat('46', 32), 'hex'),
    '30000000-0000-4000-8000-000000000005',
    'pairing_batch_approval',
    pg_catalog.decode(pg_catalog.repeat('72', 32), 'hex'),
    v_context,
    pg_catalog.transaction_timestamp() + interval '4 minutes'
  );
  v_result := viberacing_api.approve_pairing_batch(
    '30000000-0000-4000-8000-000000000009',
    pg_catalog.decode(pg_catalog.repeat('46', 32), 'hex'),
    'pair_AAAAAAAAAAAAAAAAAAAAAA',
    v_manifest_digest,
    v_context,
    '30000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000004',
    1,
    false,
    v_decisions
  );
  IF v_result <> 2 THEN
    RAISE EXCEPTION 'batch approval did not select exactly two candidates';
  END IF;

  BEGIN
    PERFORM viberacing_api.approve_pairing_batch(
      '30000000-0000-4000-8000-000000000009',
      pg_catalog.decode(pg_catalog.repeat('46', 32), 'hex'),
      'pair_AAAAAAAAAAAAAAAAAAAAAA',
      v_manifest_digest,
      v_context,
      '30000000-0000-4000-8000-000000000005',
      '30000000-0000-4000-8000-000000000004',
      1,
      false,
      v_decisions
    );
    RAISE EXCEPTION 'batch approval replay unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  IF viberacing_api.activate_pairing_batch(
    'pair_AAAAAAAAAAAAAAAAAAAAAA',
    pg_catalog.decode(pg_catalog.repeat('52', 32), 'hex')
  ) <> 2 THEN
    RAISE EXCEPTION 'batch activation did not activate both selected candidates';
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO v_rows
  FROM viberacing_api.poll_pairing_batch(
    'pair_AAAAAAAAAAAAAAAAAAAAAA',
    pg_catalog.decode(pg_catalog.repeat('52', 32), 'hex')
  );
  IF v_rows <> 3 THEN
    RAISE EXCEPTION 'poll did not project every selected and skipped candidate';
  END IF;

  v_attach_manifest := jsonb '[
    {
      "candidateId": "cand_EEEEEEEEEEEEEEEEEEEEEE",
      "provider": "codex",
      "readerVersion": "codex_app_server_0_144_5_v1",
      "accountingRevision": 1,
      "scopeKind": "agent_account",
      "fingerprintKind": "stable_opaque",
      "fingerprintDigest": "1111111111111111111111111111111111111111111111111111111111111111",
      "syncPublicKey": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      "displayLabel": "Codex second device",
      "preview": {
        "currentWeekTokenTotal": "1300",
        "lastUsageDate": "2026-07-28",
        "status": "ready"
      }
    }
  ]';
  v_attach_decisions := jsonb '[
    {
      "candidateId": "cand_EEEEEEEEEEEEEEEEEEEEEE",
      "decision": "attach_existing",
      "targetAgentAccountId": "acc_AAAAAAAAAAAAAAAAAAAAAA",
      "newAgentAccountId": null,
      "deviceKeyId": "key_EEEEEEEEEEEEEEEEEEEEEE",
      "deviceId": "dev_EEEEEEEEEEEEEEEEEEEEEE",
      "privateLabel": null
    }
  ]';
  v_manifest_digest := pg_catalog.sha256(
    pg_catalog.convert_to(v_attach_manifest::text, 'UTF8')
  );
  PERFORM viberacing_api.start_pairing_batch(
    'pair_EEEEEEEEEEEEEEEEEEEEEE',
    'ins_EEEEEEEEEEEEEEEEEEEEEE',
    pg_catalog.decode(pg_catalog.repeat('81', 32), 'hex'),
    'Second workstation',
    '0.0.0',
    'linux',
    'aarch64',
    v_manifest_digest,
    pg_catalog.decode(pg_catalog.repeat('80', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('83', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('84', 32), 'hex'),
    pg_catalog.transaction_timestamp() + interval '9 minutes',
    v_attach_manifest
  );
  v_context := pg_catalog.decode(pg_catalog.repeat('85', 32), 'hex');
  PERFORM viberacing_api.create_auth_challenge(
    '30000000-0000-4000-8000-000000000009',
    pg_catalog.decode(pg_catalog.repeat('46', 32), 'hex'),
    '30000000-0000-4000-8000-000000000006',
    'pairing_batch_approval',
    pg_catalog.decode(pg_catalog.repeat('86', 32), 'hex'),
    v_context,
    pg_catalog.transaction_timestamp() + interval '4 minutes'
  );
  IF viberacing_api.approve_pairing_batch(
    '30000000-0000-4000-8000-000000000009',
    pg_catalog.decode(pg_catalog.repeat('46', 32), 'hex'),
    'pair_EEEEEEEEEEEEEEEEEEEEEE',
    v_manifest_digest,
    v_context,
    '30000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000004',
    2,
    false,
    v_attach_decisions
  ) <> 1 THEN
    RAISE EXCEPTION 'same-provider stable-fingerprint attachment failed';
  END IF;
  IF viberacing_api.activate_pairing_batch(
    'pair_EEEEEEEEEEEEEEEEEEEEEE',
    pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex')
  ) <> 1 THEN
    RAISE EXCEPTION 'attached account activation failed';
  END IF;

  v_wrong_provider_manifest := jsonb '[
    {
      "candidateId": "cand_FFFFFFFFFFFFFFFFFFFFFF",
      "provider": "claude_code",
      "readerVersion": "claude_code_fixture_v1",
      "accountingRevision": 1,
      "scopeKind": "agent_account",
      "fingerprintKind": "unavailable",
      "fingerprintDigest": null,
      "syncPublicKey": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      "displayLabel": "Wrong-provider attachment",
      "preview": {
        "currentWeekTokenTotal": "0",
        "lastUsageDate": null,
        "status": "unavailable"
      }
    }
  ]';
  v_wrong_provider_decisions := jsonb '[
    {
      "candidateId": "cand_FFFFFFFFFFFFFFFFFFFFFF",
      "decision": "attach_existing",
      "targetAgentAccountId": "acc_AAAAAAAAAAAAAAAAAAAAAA",
      "newAgentAccountId": null,
      "deviceKeyId": "key_FFFFFFFFFFFFFFFFFFFFFF",
      "deviceId": "dev_FFFFFFFFFFFFFFFFFFFFFF",
      "privateLabel": null
    }
  ]';
  v_manifest_digest := pg_catalog.sha256(
    pg_catalog.convert_to(v_wrong_provider_manifest::text, 'UTF8')
  );
  PERFORM viberacing_api.start_pairing_batch(
    'pair_FFFFFFFFFFFFFFFFFFFFFF',
    'ins_FFFFFFFFFFFFFFFFFFFFFF',
    pg_catalog.decode(pg_catalog.repeat('91', 32), 'hex'),
    'Wrong-provider fixture',
    '0.0.0',
    'linux',
    'x86_64',
    v_manifest_digest,
    pg_catalog.decode(pg_catalog.repeat('90', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('92', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('93', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('94', 32), 'hex'),
    pg_catalog.transaction_timestamp() + interval '9 minutes',
    v_wrong_provider_manifest
  );
  v_context := pg_catalog.decode(pg_catalog.repeat('95', 32), 'hex');
  PERFORM viberacing_api.create_auth_challenge(
    '30000000-0000-4000-8000-000000000009',
    pg_catalog.decode(pg_catalog.repeat('46', 32), 'hex'),
    '30000000-0000-4000-8000-000000000007',
    'pairing_batch_approval',
    pg_catalog.decode(pg_catalog.repeat('96', 32), 'hex'),
    v_context,
    pg_catalog.transaction_timestamp() + interval '4 minutes'
  );
  BEGIN
    PERFORM viberacing_api.approve_pairing_batch(
      '30000000-0000-4000-8000-000000000009',
      pg_catalog.decode(pg_catalog.repeat('46', 32), 'hex'),
      'pair_FFFFFFFFFFFFFFFFFFFFFF',
      v_manifest_digest,
      v_context,
      '30000000-0000-4000-8000-000000000007',
      '30000000-0000-4000-8000-000000000004',
      3,
      false,
      v_wrong_provider_decisions
    );
    RAISE EXCEPTION 'different-provider attachment unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  SELECT pg_catalog.count(*)::integer
  INTO v_rows
  FROM viberacing_api.poll_pairing_batch(
    'pair_EEEEEEEEEEEEEEEEEEEEEE',
    pg_catalog.decode(pg_catalog.repeat('99', 32), 'hex')
  );
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'poll without token possession returned private state';
  END IF;
END
$batch_pairing$;

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

DO $owner_assertions$
DECLARE
  v_rows integer;
BEGIN
  BEGIN
    UPDATE viberacing_private.pairing_transactions
    SET start_proof_digest = pg_catalog.decode(pg_catalog.repeat('de', 32), 'hex')
    WHERE pairing_id = 'pair_AAAAAAAAAAAAAAAAAAAAAA';
    RAISE EXCEPTION 'stored start proof was mutable';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  BEGIN
    UPDATE viberacing_private.pairing_candidates
    SET preview_current_week_token_total = '999999'
    WHERE pairing_id = 'pair_AAAAAAAAAAAAAAAAAAAAAA'
      AND candidate_id = 'cand_AAAAAAAAAAAAAAAAAAAAAA';
    RAISE EXCEPTION 'displayed candidate preview was mutable';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.agent_accounts
    WHERE profile_id = '30000000-0000-4000-8000-000000000001'
      AND provider_code = 'codex'
  ) <> 2 THEN
    RAISE EXCEPTION 'two same-provider accounts were not preserved';
  END IF;

  IF (
    SELECT sign_count
    FROM viberacing_private.passkeys
    WHERE passkey_id = '30000000-0000-4000-8000-000000000004'
  ) <> 2 THEN
    RAISE EXCEPTION 'fresh-passkey sign state was not updated exactly on successful approvals';
  END IF;

  IF (
    SELECT state
    FROM viberacing_private.auth_challenges
    WHERE challenge_id = '30000000-0000-4000-8000-000000000007'
  ) <> 'pending' THEN
    RAISE EXCEPTION 'failed wrong-provider approval consumed its challenge';
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO v_rows
  FROM viberacing_private.device_keys
  WHERE agent_account_id = 'acc_AAAAAAAAAAAAAAAAAAAAAA'
    AND state = 'active';
  IF v_rows <> 2 THEN
    RAISE EXCEPTION 'independently revocable installations were not attached to one account';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM viberacing_private.agent_accounts
    WHERE provider_code = 'claude_code'
  ) THEN
    RAISE EXCEPTION 'rejected wrong-provider attachment mutated account state';
  END IF;

  INSERT INTO viberacing_private.connector_installations (
    installation_id,
    installation_public_key,
    label,
    connector_version,
    os_family,
    architecture,
    created_at
  )
  VALUES (
    'ins_GGGGGGGGGGGGGGGGGGGGGG',
    pg_catalog.decode(pg_catalog.repeat('a2', 32), 'hex'),
    'Expired pairing fixture',
    '0.0.0',
    'linux',
    'x86_64',
    pg_catalog.transaction_timestamp() - interval '2 minutes'
  );
  INSERT INTO viberacing_private.pairing_transactions (
    pairing_id,
    installation_id,
    manifest_digest,
    start_proof_digest,
    poll_verifier_digest,
    user_code_verifier_digest,
    possession_challenge,
    created_at,
    expires_at
  )
  VALUES (
    'pair_GGGGGGGGGGGGGGGGGGGGGG',
    'ins_GGGGGGGGGGGGGGGGGGGGGG',
    pg_catalog.decode(pg_catalog.repeat('a3', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('a7', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('a4', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('a5', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('a6', 32), 'hex'),
    pg_catalog.transaction_timestamp() - interval '2 minutes',
    pg_catalog.transaction_timestamp() - interval '1 minute'
  );
END
$owner_assertions$;

RESET ROLE;
SET LOCAL ROLE viberacing_web;

DO $expiry_assertion$
DECLARE
  v_state text;
BEGIN
  SELECT pairing_state
  INTO v_state
  FROM viberacing_api.poll_pairing_batch(
    'pair_GGGGGGGGGGGGGGGGGGGGGG',
    pg_catalog.decode(pg_catalog.repeat('a4', 32), 'hex')
  )
  LIMIT 1;
  IF v_state <> 'expired' THEN
    RAISE EXCEPTION 'PostgreSQL clock did not terminally project expired pairing';
  END IF;
END
$expiry_assertion$;

ROLLBACK;
