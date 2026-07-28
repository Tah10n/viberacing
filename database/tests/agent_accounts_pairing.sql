\set ON_ERROR_STOP on

BEGIN;

SET LOCAL ROLE viberacing_owner;

UPDATE viberacing_private.agent_providers
SET state = 'supported'
WHERE provider_code IN ('codex', 'claude_code', 'opencode');

UPDATE viberacing_private.agent_accounting_revisions
SET enabled_for_new_accounts = true
WHERE provider_code = 'codex'
  AND accounting_revision = 1;

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
VALUES
  (
    'claude_code',
    1,
    'claude_code_fixture_v1',
    'agent_account',
    'utc_timestamp',
    35,
    '0.0.0',
    true
  ),
  (
    'opencode',
    1,
    'opencode_fixture_v1',
    'agent_account',
    'utc_timestamp',
    35,
    '0.0.0',
    true
  );

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT *
FROM viberacing_api.open_github_profile(
  '30000000-0000-4000-8000-000000000001',
  920000000000001,
  'multi-agent-driver',
  'en',
  '30000000-0000-4000-8000-000000000002',
  pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
  pg_catalog.transaction_timestamp() + interval '20 minutes',
  NULL
);

SELECT viberacing_api.create_auth_challenge(
  '30000000-0000-4000-8000-000000000002',
  pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
  '30000000-0000-4000-8000-000000000003',
  'initial_passkey',
  pg_catalog.decode(pg_catalog.repeat('42', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('43', 32), 'hex'),
  pg_catalog.transaction_timestamp() + interval '4 minutes'
);

SELECT viberacing_api.register_initial_passkey(
  '30000000-0000-4000-8000-000000000002',
  pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
  '30000000-0000-4000-8000-000000000003',
  pg_catalog.decode(pg_catalog.repeat('43', 32), 'hex'),
  '30000000-0000-4000-8000-000000000004',
  pg_catalog.decode(pg_catalog.repeat('44', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('45', 64), 'hex'),
  0,
  true,
  false,
  'Primary passkey'
);

SELECT viberacing_api.start_pairing_batch(
  'pair_AAAAAAAAAAAAAAAAAAAAAA',
  'ins_AAAAAAAAAAAAAAAAAAAAAA',
  pg_catalog.decode(pg_catalog.repeat('51', 32), 'hex'),
  'Main workstation',
  '0.0.0',
  'windows',
  'x86_64',
  pg_catalog.sha256(
    pg_catalog.convert_to(
      (
        jsonb '[
          {
            "candidateId": "cand_AAAAAAAAAAAAAAAAAAAAAA",
            "provider": "codex",
            "readerVersion": "codex_app_server_0_144_5_v1",
            "accountingRevision": 1,
            "scopeKind": "agent_account",
            "fingerprintKind": "stable_opaque",
            "fingerprintDigest": "1111111111111111111111111111111111111111111111111111111111111111",
            "syncPublicKey": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "displayLabel": "Codex personal"
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
            "displayLabel": "Codex work"
          },
          {
            "candidateId": "cand_CCCCCCCCCCCCCCCCCCCCCC",
            "provider": "claude_code",
            "readerVersion": "claude_code_fixture_v1",
            "accountingRevision": 1,
            "scopeKind": "agent_account",
            "fingerprintKind": "unavailable",
            "fingerprintDigest": null,
            "syncPublicKey": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            "displayLabel": "Claude Code"
          },
          {
            "candidateId": "cand_DDDDDDDDDDDDDDDDDDDDDD",
            "provider": "opencode",
            "readerVersion": "opencode_fixture_v1",
            "accountingRevision": 1,
            "scopeKind": "agent_account",
            "fingerprintKind": "stable_opaque",
            "fingerprintDigest": "4444444444444444444444444444444444444444444444444444444444444444",
            "syncPublicKey": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
            "displayLabel": "opencode local"
          }
        ]'
      )::text,
      'UTF8'
    )
  ),
  pg_catalog.decode(pg_catalog.repeat('52', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('53', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('54', 32), 'hex'),
  pg_catalog.transaction_timestamp() + interval '9 minutes',
  jsonb '[
    {
      "candidateId": "cand_AAAAAAAAAAAAAAAAAAAAAA",
      "provider": "codex",
      "readerVersion": "codex_app_server_0_144_5_v1",
      "accountingRevision": 1,
      "scopeKind": "agent_account",
      "fingerprintKind": "stable_opaque",
      "fingerprintDigest": "1111111111111111111111111111111111111111111111111111111111111111",
      "syncPublicKey": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "displayLabel": "Codex personal"
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
      "displayLabel": "Codex work"
    },
    {
      "candidateId": "cand_CCCCCCCCCCCCCCCCCCCCCC",
      "provider": "claude_code",
      "readerVersion": "claude_code_fixture_v1",
      "accountingRevision": 1,
      "scopeKind": "agent_account",
      "fingerprintKind": "unavailable",
      "fingerprintDigest": null,
      "syncPublicKey": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "displayLabel": "Claude Code"
    },
    {
      "candidateId": "cand_DDDDDDDDDDDDDDDDDDDDDD",
      "provider": "opencode",
      "readerVersion": "opencode_fixture_v1",
      "accountingRevision": 1,
      "scopeKind": "agent_account",
      "fingerprintKind": "stable_opaque",
      "fingerprintDigest": "4444444444444444444444444444444444444444444444444444444444444444",
      "syncPublicKey": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      "displayLabel": "opencode local"
    }
  ]'
);

DO $assertion$
BEGIN
  BEGIN
    PERFORM viberacing_api.start_pairing_batch(
      'pair_ZZZZZZZZZZZZZZZZZZZZZZ',
      'ins_ZZZZZZZZZZZZZZZZZZZZZZ',
      pg_catalog.decode(pg_catalog.repeat('61', 32), 'hex'),
      'Mutated manifest',
      '0.0.0',
      'windows',
      'x86_64',
      pg_catalog.decode(pg_catalog.repeat('62', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('63', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('64', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('65', 32), 'hex'),
      pg_catalog.transaction_timestamp() + interval '9 minutes',
      jsonb '[{
        "candidateId": "cand_ZZZZZZZZZZZZZZZZZZZZZZ",
        "provider": "codex",
        "readerVersion": "codex_app_server_0_144_5_v1",
        "accountingRevision": 1,
        "scopeKind": "agent_account",
        "fingerprintKind": "unavailable",
        "fingerprintDigest": null,
        "syncPublicKey": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        "displayLabel": "Mutation"
      }]'
    );
    RAISE EXCEPTION 'manifest mutation unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;
END
$assertion$;

SELECT viberacing_api.read_pairing_batch_by_code(
  '30000000-0000-4000-8000-000000000002',
  pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('53', 32), 'hex'),
  NULL
);

SELECT viberacing_api.create_auth_challenge(
  '30000000-0000-4000-8000-000000000002',
  pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
  '30000000-0000-4000-8000-000000000005',
  'pairing_batch_approval',
  pg_catalog.decode(pg_catalog.repeat('71', 32), 'hex'),
  pg_catalog.sha256(
    pg_catalog.convert_to(
      'pairing_batch_approval_v1' || pg_catalog.chr(10)
        || 'pair_AAAAAAAAAAAAAAAAAAAAAA' || pg_catalog.chr(10)
        || pg_catalog.encode(
          pg_catalog.sha256(
            pg_catalog.convert_to(
              (
                jsonb '[
                  {
                    "candidateId": "cand_AAAAAAAAAAAAAAAAAAAAAA",
                    "provider": "codex",
                    "readerVersion": "codex_app_server_0_144_5_v1",
                    "accountingRevision": 1,
                    "scopeKind": "agent_account",
                    "fingerprintKind": "stable_opaque",
                    "fingerprintDigest": "1111111111111111111111111111111111111111111111111111111111111111",
                    "syncPublicKey": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    "displayLabel": "Codex personal"
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
                    "displayLabel": "Codex work"
                  },
                  {
                    "candidateId": "cand_CCCCCCCCCCCCCCCCCCCCCC",
                    "provider": "claude_code",
                    "readerVersion": "claude_code_fixture_v1",
                    "accountingRevision": 1,
                    "scopeKind": "agent_account",
                    "fingerprintKind": "unavailable",
                    "fingerprintDigest": null,
                    "syncPublicKey": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                    "displayLabel": "Claude Code"
                  },
                  {
                    "candidateId": "cand_DDDDDDDDDDDDDDDDDDDDDD",
                    "provider": "opencode",
                    "readerVersion": "opencode_fixture_v1",
                    "accountingRevision": 1,
                    "scopeKind": "agent_account",
                    "fingerprintKind": "stable_opaque",
                    "fingerprintDigest": "4444444444444444444444444444444444444444444444444444444444444444",
                    "syncPublicKey": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
                    "displayLabel": "opencode local"
                  }
                ]'
              )::text,
              'UTF8'
            )
          ),
          'hex'
        ) || pg_catalog.chr(10)
        || pg_catalog.encode(
          pg_catalog.sha256(
            pg_catalog.convert_to(
              (
                jsonb '[
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
                    "decision": "create",
                    "targetAgentAccountId": null,
                    "newAgentAccountId": "acc_CCCCCCCCCCCCCCCCCCCCCC",
                    "deviceKeyId": "key_CCCCCCCCCCCCCCCCCCCCCC",
                    "deviceId": "dev_CCCCCCCCCCCCCCCCCCCCCC",
                    "privateLabel": "Claude Code"
                  },
                  {
                    "candidateId": "cand_DDDDDDDDDDDDDDDDDDDDDD",
                    "decision": "skip",
                    "targetAgentAccountId": null,
                    "newAgentAccountId": null,
                    "deviceKeyId": null,
                    "deviceId": null,
                    "privateLabel": null
                  }
                ]'
              )::text,
              'UTF8'
            )
          ),
          'hex'
        ),
      'UTF8'
    )
  ),
  pg_catalog.transaction_timestamp() + interval '4 minutes'
);

SELECT viberacing_api.approve_pairing_batch(
  '30000000-0000-4000-8000-000000000002',
  pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
  'pair_AAAAAAAAAAAAAAAAAAAAAA',
  pg_catalog.sha256(
    pg_catalog.convert_to(
      (
        jsonb '[
          {
            "candidateId": "cand_AAAAAAAAAAAAAAAAAAAAAA",
            "provider": "codex",
            "readerVersion": "codex_app_server_0_144_5_v1",
            "accountingRevision": 1,
            "scopeKind": "agent_account",
            "fingerprintKind": "stable_opaque",
            "fingerprintDigest": "1111111111111111111111111111111111111111111111111111111111111111",
            "syncPublicKey": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "displayLabel": "Codex personal"
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
            "displayLabel": "Codex work"
          },
          {
            "candidateId": "cand_CCCCCCCCCCCCCCCCCCCCCC",
            "provider": "claude_code",
            "readerVersion": "claude_code_fixture_v1",
            "accountingRevision": 1,
            "scopeKind": "agent_account",
            "fingerprintKind": "unavailable",
            "fingerprintDigest": null,
            "syncPublicKey": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            "displayLabel": "Claude Code"
          },
          {
            "candidateId": "cand_DDDDDDDDDDDDDDDDDDDDDD",
            "provider": "opencode",
            "readerVersion": "opencode_fixture_v1",
            "accountingRevision": 1,
            "scopeKind": "agent_account",
            "fingerprintKind": "stable_opaque",
            "fingerprintDigest": "4444444444444444444444444444444444444444444444444444444444444444",
            "syncPublicKey": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
            "displayLabel": "opencode local"
          }
        ]'
      )::text,
      'UTF8'
    )
  ),
  pg_catalog.sha256(
    pg_catalog.convert_to(
      (
        jsonb '[
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
            "decision": "create",
            "targetAgentAccountId": null,
            "newAgentAccountId": "acc_CCCCCCCCCCCCCCCCCCCCCC",
            "deviceKeyId": "key_CCCCCCCCCCCCCCCCCCCCCC",
            "deviceId": "dev_CCCCCCCCCCCCCCCCCCCCCC",
            "privateLabel": "Claude Code"
          },
          {
            "candidateId": "cand_DDDDDDDDDDDDDDDDDDDDDD",
            "decision": "skip",
            "targetAgentAccountId": null,
            "newAgentAccountId": null,
            "deviceKeyId": null,
            "deviceId": null,
            "privateLabel": null
          }
        ]'
      )::text,
      'UTF8'
    )
  ),
  '30000000-0000-4000-8000-000000000005',
  '30000000-0000-4000-8000-000000000004',
  jsonb '[
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
      "decision": "create",
      "targetAgentAccountId": null,
      "newAgentAccountId": "acc_CCCCCCCCCCCCCCCCCCCCCC",
      "deviceKeyId": "key_CCCCCCCCCCCCCCCCCCCCCC",
      "deviceId": "dev_CCCCCCCCCCCCCCCCCCCCCC",
      "privateLabel": "Claude Code"
    },
    {
      "candidateId": "cand_DDDDDDDDDDDDDDDDDDDDDD",
      "decision": "skip",
      "targetAgentAccountId": null,
      "newAgentAccountId": null,
      "deviceKeyId": null,
      "deviceId": null,
      "privateLabel": null
    }
  ]'
);

SELECT viberacing_api.activate_pairing_batch(
  'pair_AAAAAAAAAAAAAAAAAAAAAA',
  pg_catalog.decode(pg_catalog.repeat('52', 32), 'hex')
);

DO $adversarial_pairing$
DECLARE
  v_attach_decisions jsonb := jsonb '[
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
  v_attach_manifest jsonb := jsonb '[
    {
      "candidateId": "cand_EEEEEEEEEEEEEEEEEEEEEE",
      "provider": "codex",
      "readerVersion": "codex_app_server_0_144_5_v1",
      "accountingRevision": 1,
      "scopeKind": "agent_account",
      "fingerprintKind": "stable_opaque",
      "fingerprintDigest": "1111111111111111111111111111111111111111111111111111111111111111",
      "syncPublicKey": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      "displayLabel": "Codex second device"
    }
  ]';
  v_wrong_provider_decisions jsonb := jsonb '[
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
  v_wrong_provider_manifest jsonb := jsonb '[
    {
      "candidateId": "cand_FFFFFFFFFFFFFFFFFFFFFF",
      "provider": "claude_code",
      "readerVersion": "claude_code_fixture_v1",
      "accountingRevision": 1,
      "scopeKind": "agent_account",
      "fingerprintKind": "unavailable",
      "fingerprintDigest": null,
      "syncPublicKey": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      "displayLabel": "Wrong-provider attachment"
    }
  ]';
  v_decision_digest bytea;
  v_installation_context bytea;
  v_manifest_digest bytea;
  v_result integer;
  v_rows integer;
BEGIN
  v_manifest_digest := pg_catalog.sha256(
    pg_catalog.convert_to(v_attach_manifest::text, 'UTF8')
  );
  v_decision_digest := pg_catalog.sha256(
    pg_catalog.convert_to(v_attach_decisions::text, 'UTF8')
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
    pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('83', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('84', 32), 'hex'),
    pg_catalog.transaction_timestamp() + interval '9 minutes',
    v_attach_manifest
  );

  PERFORM viberacing_api.create_auth_challenge(
    '30000000-0000-4000-8000-000000000002',
    pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
    '30000000-0000-4000-8000-000000000006',
    'pairing_batch_approval',
    pg_catalog.decode(pg_catalog.repeat('85', 32), 'hex'),
    pg_catalog.sha256(
      pg_catalog.convert_to(
        'pairing_batch_approval_v1' || pg_catalog.chr(10)
          || 'pair_EEEEEEEEEEEEEEEEEEEEEE' || pg_catalog.chr(10)
          || pg_catalog.encode(v_manifest_digest, 'hex') || pg_catalog.chr(10)
          || pg_catalog.encode(v_decision_digest, 'hex'),
        'UTF8'
      )
    ),
    pg_catalog.transaction_timestamp() + interval '4 minutes'
  );

  v_result := viberacing_api.approve_pairing_batch(
    '30000000-0000-4000-8000-000000000002',
    pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
    'pair_EEEEEEEEEEEEEEEEEEEEEE',
    v_manifest_digest,
    v_decision_digest,
    '30000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000004',
    v_attach_decisions
  );
  IF v_result <> 1 THEN
    RAISE EXCEPTION 'attach-existing approval count is invalid';
  END IF;

  v_result := viberacing_api.activate_pairing_batch(
    'pair_EEEEEEEEEEEEEEEEEEEEEE',
    pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex')
  );
  IF v_result <> 1 THEN
    RAISE EXCEPTION 'attach-existing activation count is invalid';
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO v_rows
  FROM viberacing_api.poll_pairing_batch(
    'pair_EEEEEEEEEEEEEEEEEEEEEE',
    pg_catalog.decode(pg_catalog.repeat('99', 32), 'hex')
  );
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'poll without token possession unexpectedly returned state';
  END IF;

  BEGIN
    PERFORM viberacing_api.approve_pairing_batch(
      '30000000-0000-4000-8000-000000000002',
      pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
      'pair_EEEEEEEEEEEEEEEEEEEEEE',
      v_manifest_digest,
      v_decision_digest,
      '30000000-0000-4000-8000-000000000006',
      '30000000-0000-4000-8000-000000000004',
      v_attach_decisions
    );
    RAISE EXCEPTION 'pairing approval replay unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  v_manifest_digest := pg_catalog.sha256(
    pg_catalog.convert_to(v_wrong_provider_manifest::text, 'UTF8')
  );
  v_decision_digest := pg_catalog.sha256(
    pg_catalog.convert_to(v_wrong_provider_decisions::text, 'UTF8')
  );
  PERFORM viberacing_api.start_pairing_batch(
    'pair_FFFFFFFFFFFFFFFFFFFFFF',
    'ins_EEEEEEEEEEEEEEEEEEEEEE',
    pg_catalog.decode(pg_catalog.repeat('81', 32), 'hex'),
    'Second workstation',
    '0.0.0',
    'linux',
    'aarch64',
    v_manifest_digest,
    pg_catalog.decode(pg_catalog.repeat('92', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('93', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('94', 32), 'hex'),
    pg_catalog.transaction_timestamp() + interval '9 minutes',
    v_wrong_provider_manifest
  );
  PERFORM viberacing_api.create_auth_challenge(
    '30000000-0000-4000-8000-000000000002',
    pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
    '30000000-0000-4000-8000-000000000007',
    'pairing_batch_approval',
    pg_catalog.decode(pg_catalog.repeat('95', 32), 'hex'),
    pg_catalog.sha256(
      pg_catalog.convert_to(
        'pairing_batch_approval_v1' || pg_catalog.chr(10)
          || 'pair_FFFFFFFFFFFFFFFFFFFFFF' || pg_catalog.chr(10)
          || pg_catalog.encode(v_manifest_digest, 'hex') || pg_catalog.chr(10)
          || pg_catalog.encode(v_decision_digest, 'hex'),
        'UTF8'
      )
    ),
    pg_catalog.transaction_timestamp() + interval '4 minutes'
  );

  BEGIN
    PERFORM viberacing_api.approve_pairing_batch(
      '30000000-0000-4000-8000-000000000002',
      pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
      'pair_FFFFFFFFFFFFFFFFFFFFFF',
      v_manifest_digest,
      v_decision_digest,
      '30000000-0000-4000-8000-000000000007',
      '30000000-0000-4000-8000-000000000004',
      v_attach_decisions
    );
    RAISE EXCEPTION 'mutated decision list unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  BEGIN
    PERFORM viberacing_api.approve_pairing_batch(
      '30000000-0000-4000-8000-000000000002',
      pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
      'pair_FFFFFFFFFFFFFFFFFFFFFF',
      v_manifest_digest,
      v_decision_digest,
      '30000000-0000-4000-8000-000000000007',
      '30000000-0000-4000-8000-000000000004',
      v_wrong_provider_decisions
    );
    RAISE EXCEPTION 'different-provider attachment unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  FOR v_result IN 2..10 LOOP
    PERFORM viberacing_api.read_pairing_batch_by_code(
      '30000000-0000-4000-8000-000000000002',
      pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('ff', 32), 'hex'),
      NULL
    );
  END LOOP;
  IF viberacing_api.read_pairing_batch_by_code(
    '30000000-0000-4000-8000-000000000002',
    pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('ff', 32), 'hex'),
    NULL
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'eleventh fallback-code attempt unexpectedly returned a pairing';
  END IF;

  PERFORM viberacing_api.create_auth_challenge(
    '30000000-0000-4000-8000-000000000002',
    pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
    '30000000-0000-4000-8000-000000000008',
    'device_revoke',
    pg_catalog.decode(pg_catalog.repeat('86', 32), 'hex'),
    pg_catalog.sha256(
      pg_catalog.convert_to(
        'device_revoke_v1' || pg_catalog.chr(10) || 'dev_AAAAAAAAAAAAAAAAAAAAAA',
        'UTF8'
      )
    ),
    pg_catalog.transaction_timestamp() + interval '4 minutes'
  );
  PERFORM viberacing_api.revoke_device_key(
    '30000000-0000-4000-8000-000000000002',
    pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
    '30000000-0000-4000-8000-000000000008',
    '30000000-0000-4000-8000-000000000004',
    'dev_AAAAAAAAAAAAAAAAAAAAAA'
  );

  v_installation_context := pg_catalog.sha256(
    pg_catalog.convert_to('installation_revoke_fixture_v1', 'UTF8')
  );
  PERFORM viberacing_api.create_auth_challenge(
    '30000000-0000-4000-8000-000000000002',
    pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
    '30000000-0000-4000-8000-000000000009',
    'installation_revoke',
    pg_catalog.decode(pg_catalog.repeat('87', 32), 'hex'),
    v_installation_context,
    pg_catalog.transaction_timestamp() + interval '4 minutes'
  );
  v_result := viberacing_api.revoke_connector_installation(
    '30000000-0000-4000-8000-000000000002',
    pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
    '30000000-0000-4000-8000-000000000009',
    v_installation_context,
    '30000000-0000-4000-8000-000000000004',
    'ins_AAAAAAAAAAAAAAAAAAAAAA'
  );
  IF v_result <> 2 THEN
    RAISE EXCEPTION 'installation revoke did not revoke exactly its remaining active keys';
  END IF;
END
$adversarial_pairing$;

SELECT *
FROM viberacing_api.open_github_profile(
  '30000000-0000-4000-8000-000000000101',
  920000000000002,
  'second-agent-profile',
  'en',
  '30000000-0000-4000-8000-000000000102',
  pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
  pg_catalog.transaction_timestamp() + interval '20 minutes',
  NULL
);

RESET ROLE;

DO $assertion$
DECLARE
  v_expired_decisions jsonb := jsonb '[{}]';
  v_replacement_manifest jsonb := jsonb '[
    {
      "candidateId": "cand_HHHHHHHHHHHHHHHHHHHHHH",
      "provider": "opencode",
      "readerVersion": "opencode_fixture_v1",
      "accountingRevision": 1,
      "scopeKind": "agent_account",
      "fingerprintKind": "stable_opaque",
      "fingerprintDigest": "b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0",
      "syncPublicKey": "b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1",
      "displayLabel": "Replacement after expiry"
    }
  ]';
  v_expired_state text;
BEGIN
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
    pg_catalog.decode(pg_catalog.repeat('a4', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('a5', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('a6', 32), 'hex'),
    pg_catalog.transaction_timestamp() - interval '2 minutes',
    pg_catalog.transaction_timestamp() - interval '1 minute'
  );

  SELECT pairing_state
  INTO v_expired_state
  FROM viberacing_api.poll_pairing_batch(
    'pair_GGGGGGGGGGGGGGGGGGGGGG',
    pg_catalog.decode(pg_catalog.repeat('a4', 32), 'hex')
  );
  IF v_expired_state <> 'expired' THEN
    RAISE EXCEPTION 'expired pairing was not projected from the PostgreSQL clock';
  END IF;

  BEGIN
    PERFORM viberacing_api.approve_pairing_batch(
      '30000000-0000-4000-8000-000000000002',
      pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
      'pair_GGGGGGGGGGGGGGGGGGGGGG',
      pg_catalog.decode(pg_catalog.repeat('a3', 32), 'hex'),
      pg_catalog.sha256(pg_catalog.convert_to(v_expired_decisions::text, 'UTF8')),
      '30000000-0000-4000-8000-000000000007',
      '30000000-0000-4000-8000-000000000004',
      v_expired_decisions
    );
    RAISE EXCEPTION 'expired pairing approval unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  PERFORM viberacing_api.start_pairing_batch(
    'pair_HHHHHHHHHHHHHHHHHHHHHH',
    'ins_GGGGGGGGGGGGGGGGGGGGGG',
    pg_catalog.decode(pg_catalog.repeat('a2', 32), 'hex'),
    'Expired pairing fixture',
    '0.0.0',
    'linux',
    'x86_64',
    pg_catalog.sha256(pg_catalog.convert_to(v_replacement_manifest::text, 'UTF8')),
    pg_catalog.decode(pg_catalog.repeat('b2', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('b3', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('b4', 32), 'hex'),
    pg_catalog.transaction_timestamp() + interval '9 minutes',
    v_replacement_manifest
  );
  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = 'pair_GGGGGGGGGGGGGGGGGGGGGG'
      AND state = 'expired'
  ) OR NOT EXISTS (
    SELECT 1
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = 'pair_HHHHHHHHHHHHHHHHHHHHHH'
      AND state = 'pending'
  ) THEN
    RAISE EXCEPTION 'expired open batch did not release the installation for a new batch';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.agent_accounts
    WHERE profile_id = '30000000-0000-4000-8000-000000000001'
  ) <> 3 THEN
    RAISE EXCEPTION 'batch approval did not create all selected accounts';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.agent_accounts
    WHERE profile_id = '30000000-0000-4000-8000-000000000001'
      AND provider_code = 'codex'
  ) <> 2 THEN
    RAISE EXCEPTION 'two same-provider accounts were not preserved';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.device_keys
    WHERE installation_id = 'ins_AAAAAAAAAAAAAAAAAAAAAA'
  ) <> 3 THEN
    RAISE EXCEPTION 'first installation did not retain its three account-scoped keys';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.device_keys
    WHERE agent_account_id = 'acc_AAAAAAAAAAAAAAAAAAAAAA'
  ) <> 2 THEN
    RAISE EXCEPTION 'second installation did not attach an independently revocable device';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.device_keys
    WHERE device_id = 'dev_AAAAAAAAAAAAAAAAAAAAAA'
      AND state = 'revoked'
  ) OR NOT EXISTS (
    SELECT 1
    FROM viberacing_private.device_keys
    WHERE device_id = 'dev_EEEEEEEEEEEEEEEEEEEEEE'
      AND state = 'active'
  ) THEN
    RAISE EXCEPTION 'single-device revoke affected the other device';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM viberacing_private.device_keys
    WHERE installation_id = 'ins_AAAAAAAAAAAAAAAAAAAAAA'
      AND state <> 'revoked'
  ) OR NOT EXISTS (
    SELECT 1
    FROM viberacing_private.connector_installations
    WHERE installation_id = 'ins_AAAAAAAAAAAAAAAAAAAAAA'
      AND state = 'revoked'
  ) THEN
    RAISE EXCEPTION 'installation revoke did not terminally revoke all installation authority';
  END IF;

  IF (
    SELECT pg_catalog.count(DISTINCT agent_account_id)
    FROM viberacing_private.device_keys
    WHERE installation_id = 'ins_AAAAAAAAAAAAAAAAAAAAAA'
  ) <> 3 OR (
    SELECT pg_catalog.count(DISTINCT public_key)
    FROM viberacing_private.device_keys
    WHERE installation_id = 'ins_AAAAAAAAAAAAAAAAAAAAAA'
  ) <> 3 THEN
    RAISE EXCEPTION 'one installation did not retain exact independent account-scoped keys';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.device_keys
    WHERE device_id = 'dev_EEEEEEEEEEEEEEEEEEEEEE'
      AND agent_account_id = 'acc_AAAAAAAAAAAAAAAAAAAAAA'
      AND public_key = pg_catalog.decode(pg_catalog.repeat('ee', 32), 'hex')
  ) THEN
    RAISE EXCEPTION 'approved candidate public key was not bound exactly';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM viberacing_private.device_keys
    WHERE public_key = pg_catalog.decode(pg_catalog.repeat('dd', 32), 'hex')
  ) THEN
    RAISE EXCEPTION 'skipped candidate unexpectedly created server authority';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.pairing_code_attempt_windows
    WHERE session_id = '30000000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'fallback-code attempt window was not created';
  END IF;

  IF (
    SELECT attempt_count
    FROM viberacing_private.pairing_code_attempt_windows
    WHERE session_id = '30000000-0000-4000-8000-000000000002'
  ) <> 10 THEN
    RAISE EXCEPTION 'fallback-code attempts were not capped at ten per window';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.pairing_transactions AS pairing
    JOIN viberacing_private.auth_challenges AS challenge
      ON challenge.challenge_id = '30000000-0000-4000-8000-000000000007'
    WHERE pairing.pairing_id = 'pair_FFFFFFFFFFFFFFFFFFFFFF'
      AND pairing.state = 'pending'
      AND challenge.consumed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'rejected pairing attempts mutated pairing or passkey challenge state';
  END IF;

  BEGIN
    UPDATE viberacing_private.agent_accounts
    SET provider_code = 'opencode'
    WHERE agent_account_id = 'acc_AAAAAAAAAAAAAAAAAAAAAA';
    RAISE EXCEPTION 'provider mutation unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  INSERT INTO viberacing_private.agent_accounts (
    agent_account_id,
    profile_id,
    provider_code,
    accounting_revision,
    scope_kind,
    fingerprint_kind,
    account_fingerprint_digest,
    private_label,
    identity_assurance
  )
  VALUES (
    'acc_YYYYYYYYYYYYYYYYYYYYYY',
    '30000000-0000-4000-8000-000000000101',
    'codex',
    1,
    'agent_account',
    'stable_opaque',
    pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex'),
    'Same local fingerprint, other profile',
    'community_local'
  );

  INSERT INTO viberacing_private.agent_accounts (
    agent_account_id,
    profile_id,
    provider_code,
    accounting_revision,
    scope_kind,
    fingerprint_kind,
    account_fingerprint_digest,
    private_label,
    identity_assurance
  )
  VALUES (
    'acc_GGGGGGGGGGGGGGGGGGGGGG',
    '30000000-0000-4000-8000-000000000001',
    'codex',
    1,
    'agent_account',
    'provider_verified',
    pg_catalog.decode(pg_catalog.repeat('ab', 32), 'hex'),
    'Verified fixture',
    'provider_verified'
  );

  BEGIN
    INSERT INTO viberacing_private.agent_accounts (
      agent_account_id,
      profile_id,
      provider_code,
      accounting_revision,
      scope_kind,
      fingerprint_kind,
      account_fingerprint_digest,
      private_label,
      identity_assurance
    )
    VALUES (
      'acc_HHHHHHHHHHHHHHHHHHHHHH',
      '30000000-0000-4000-8000-000000000101',
      'codex',
      1,
      'agent_account',
      'provider_verified',
      pg_catalog.decode(pg_catalog.repeat('ab', 32), 'hex'),
      'Duplicate verified fixture',
      'provider_verified'
    );
    RAISE EXCEPTION 'provider-verified fingerprint duplication unexpectedly succeeded';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;

  BEGIN
    UPDATE viberacing_private.agent_accounting_revisions
    SET reader_contract_version = 'mutated_reader_v2'
    WHERE provider_code = 'codex'
      AND accounting_revision = 1;
    RAISE EXCEPTION 'in-use accounting semantics unexpectedly mutated';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  BEGIN
    UPDATE viberacing_private.agent_accounts
    SET accounting_revision = 2
    WHERE agent_account_id = 'acc_AAAAAAAAAAAAAAAAAAAAAA';
    RAISE EXCEPTION 'accounting revision mutation unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  BEGIN
    UPDATE viberacing_private.agent_accounts
    SET scope_kind = 'provider_total'
    WHERE agent_account_id = 'acc_AAAAAAAAAAAAAAAAAAAAAA';
    RAISE EXCEPTION 'scope mutation unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  BEGIN
    INSERT INTO viberacing_private.agent_accounts (
      agent_account_id,
      profile_id,
      provider_code,
      accounting_revision,
      scope_kind,
      fingerprint_kind,
      account_fingerprint_digest,
      private_label,
      identity_assurance
    )
    VALUES (
      'acc_ZZZZZZZZZZZZZZZZZZZZZZ',
      '30000000-0000-4000-8000-000000000001',
      'codex',
      1,
      'agent_account',
      'stable_opaque',
      pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex'),
      'Duplicate',
      'community_local'
    );
    RAISE EXCEPTION 'same-profile stable fingerprint duplication unexpectedly succeeded';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;
END
$assertion$;

ROLLBACK;
