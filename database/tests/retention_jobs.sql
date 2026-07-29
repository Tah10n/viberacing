\set ON_ERROR_STOP on

BEGIN;

SET LOCAL ROLE viberacing_owner;

CREATE FUNCTION pg_temp.utc_date()
RETURNS date
LANGUAGE sql
STABLE
AS $function$
  SELECT (pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC')::date
$function$;

CREATE FUNCTION pg_temp.season_start(p_usage_date date)
RETURNS date
LANGUAGE sql
IMMUTABLE
STRICT
AS $function$
  SELECT p_usage_date - (extract(isodow FROM p_usage_date)::integer - 1)
$function$;

INSERT INTO viberacing_private.seasons (
  season_start,
  trust_tier,
  season_end,
  metric_version,
  accounting_policy_version,
  state,
  opened_at,
  grace_ends_at
)
SELECT
  required.season_start,
  'community',
  required.season_start + 6,
  'provider_reported_tokens_v1',
  'agent_account_cumulative_utc_v1',
  'open',
  required.season_start::timestamp AT TIME ZONE 'UTC',
  ((required.season_start + 7)::timestamp AT TIME ZONE 'UTC') + interval '48 hours'
FROM (
  SELECT pg_temp.season_start(pg_temp.utc_date() - 1) AS season_start
) AS required
ON CONFLICT (season_start, trust_tier) DO NOTHING;

INSERT INTO viberacing_private.profiles (
  profile_id,
  github_user_id,
  handle,
  locale,
  hidden_at
)
VALUES
  (
    '70000000-0000-4000-8000-000000000001',
    970000000000001,
    'retention-usage',
    'en',
    pg_catalog.transaction_timestamp()
  ),
  (
    '70000000-0000-4000-8000-000000000002',
    970000000000002,
    'retention-auth',
    'en',
    pg_catalog.transaction_timestamp()
  ),
  (
    '70000000-0000-4000-8000-000000000003',
    970000000000003,
    'retention-authority',
    'en',
    pg_catalog.transaction_timestamp()
  ),
  (
    '70000000-0000-4000-8000-000000000004',
    970000000000004,
    'retention-delete',
    'en',
    pg_catalog.transaction_timestamp()
  );

UPDATE viberacing_private.profiles
SET state = 'active'
WHERE profile_id IN (
  '70000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000002',
  '70000000-0000-4000-8000-000000000003',
  '70000000-0000-4000-8000-000000000004'
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
VALUES
  (
    'acc_RRRRRRRRRRRRRRRRRRRRRR',
    '70000000-0000-4000-8000-000000000001',
    'codex',
    1,
    'agent_account',
    'stable_opaque',
    pg_catalog.decode(pg_catalog.repeat('71', 32), 'hex'),
    'Retention usage',
    'community_local'
  ),
  (
    'acc_PPPPPPPPPPPPPPPPPPPPPP',
    '70000000-0000-4000-8000-000000000001',
    'codex',
    1,
    'agent_account',
    'stable_opaque',
    pg_catalog.decode(pg_catalog.repeat('72', 32), 'hex'),
    'Expired provisional',
    'community_local'
  ),
  (
    'acc_VVVVVVVVVVVVVVVVVVVVVV',
    '70000000-0000-4000-8000-000000000003',
    'codex',
    1,
    'agent_account',
    'stable_opaque',
    pg_catalog.decode(pg_catalog.repeat('73', 32), 'hex'),
    'Revoked authority',
    'community_local'
  ),
  (
    'acc_DDDDDDDDDDDDDDDDDDDDDD',
    '70000000-0000-4000-8000-000000000004',
    'codex',
    1,
    'agent_account',
    'stable_opaque',
    pg_catalog.decode(pg_catalog.repeat('95', 32), 'hex'),
    'Deletion authority',
    'community_local'
  );

INSERT INTO viberacing_private.connector_installations (
  installation_id,
  profile_id,
  installation_public_key,
  label,
  connector_version,
  os_family,
  architecture,
  state,
  created_at,
  activated_at,
  revoked_at,
  last_seen_at
)
VALUES
  (
    'ins_RRRRRRRRRRRRRRRRRRRRRR',
    '70000000-0000-4000-8000-000000000001',
    pg_catalog.decode(pg_catalog.repeat('74', 32), 'hex'),
    'Retention usage',
    '0.0.0',
    'linux',
    'x86_64',
    'active',
    pg_catalog.transaction_timestamp() - interval '20 days',
    pg_catalog.transaction_timestamp() - interval '20 days',
    NULL,
    pg_catalog.transaction_timestamp() - interval '1 day'
  ),
  (
    'ins_PPPPPPPPPPPPPPPPPPPPPP',
    NULL,
    pg_catalog.decode(pg_catalog.repeat('75', 32), 'hex'),
    'Expired pairing',
    '0.0.0',
    'linux',
    'x86_64',
    'pending',
    pg_catalog.transaction_timestamp() - interval '30 minutes',
    NULL,
    NULL,
    NULL
  ),
  (
    'ins_VVVVVVVVVVVVVVVVVVVVVV',
    '70000000-0000-4000-8000-000000000003',
    pg_catalog.decode(pg_catalog.repeat('76', 32), 'hex'),
    'Revoked authority',
    '0.0.0',
    'windows',
    'x86_64',
    'revoked',
    pg_catalog.transaction_timestamp() - interval '200 days',
    pg_catalog.transaction_timestamp() - interval '199 days',
    pg_catalog.transaction_timestamp() - interval '181 days',
    pg_catalog.transaction_timestamp() - interval '181 days'
  ),
  (
    'ins_DDDDDDDDDDDDDDDDDDDDDD',
    '70000000-0000-4000-8000-000000000004',
    pg_catalog.decode(pg_catalog.repeat('96', 32), 'hex'),
    'Deletion authority',
    '0.0.0',
    'linux',
    'x86_64',
    'active',
    pg_catalog.transaction_timestamp() - interval '1 day',
    pg_catalog.transaction_timestamp() - interval '1 day',
    NULL,
    pg_catalog.transaction_timestamp()
  );

INSERT INTO viberacing_private.device_keys (
  device_key_id,
  device_id,
  profile_id,
  installation_id,
  agent_account_id,
  public_key,
  state,
  created_at,
  activated_at,
  revoked_at,
  last_used_at
)
VALUES
  (
    'key_RRRRRRRRRRRRRRRRRRRRRR',
    'dev_RRRRRRRRRRRRRRRRRRRRRR',
    '70000000-0000-4000-8000-000000000001',
    'ins_RRRRRRRRRRRRRRRRRRRRRR',
    'acc_RRRRRRRRRRRRRRRRRRRRRR',
    pg_catalog.decode(pg_catalog.repeat('77', 32), 'hex'),
    'active',
    pg_catalog.transaction_timestamp() - interval '20 days',
    pg_catalog.transaction_timestamp() - interval '20 days',
    NULL,
    pg_catalog.transaction_timestamp() - interval '1 day'
  ),
  (
    'key_VVVVVVVVVVVVVVVVVVVVVV',
    'dev_VVVVVVVVVVVVVVVVVVVVVV',
    '70000000-0000-4000-8000-000000000003',
    'ins_VVVVVVVVVVVVVVVVVVVVVV',
    'acc_VVVVVVVVVVVVVVVVVVVVVV',
    pg_catalog.decode(pg_catalog.repeat('78', 32), 'hex'),
    'revoked',
    pg_catalog.transaction_timestamp() - interval '200 days',
    pg_catalog.transaction_timestamp() - interval '199 days',
    pg_catalog.transaction_timestamp() - interval '181 days',
    pg_catalog.transaction_timestamp() - interval '181 days'
  ),
  (
    'key_DDDDDDDDDDDDDDDDDDDDDD',
    'dev_DDDDDDDDDDDDDDDDDDDDDD',
    '70000000-0000-4000-8000-000000000004',
    'ins_DDDDDDDDDDDDDDDDDDDDDD',
    'acc_DDDDDDDDDDDDDDDDDDDDDD',
    pg_catalog.decode(pg_catalog.repeat('97', 32), 'hex'),
    'active',
    pg_catalog.transaction_timestamp() - interval '1 day',
    pg_catalog.transaction_timestamp() - interval '1 day',
    NULL,
    pg_catalog.transaction_timestamp()
  );

INSERT INTO viberacing_private.origin_nonces (
  nonce_digest,
  origin_key_id,
  consumed_at,
  expires_at
)
VALUES (
  pg_catalog.decode(pg_catalog.repeat('79', 32), 'hex'),
  'edge_retention',
  pg_catalog.transaction_timestamp() - interval '2 minutes',
  pg_catalog.transaction_timestamp() - interval '1 minute'
);

INSERT INTO viberacing_private.device_nonces (
  device_key_id,
  nonce_digest,
  consumed_at,
  expires_at
)
VALUES (
  'key_RRRRRRRRRRRRRRRRRRRRRR',
  pg_catalog.decode(pg_catalog.repeat('7a', 32), 'hex'),
  pg_catalog.transaction_timestamp() - interval '30 minutes',
  pg_catalog.transaction_timestamp() - interval '10 minutes'
);

INSERT INTO viberacing_private.usage_observations (
  observation_id,
  device_key_id,
  device_id,
  installation_id,
  agent_account_id,
  sync_id,
  observed_at,
  body_digest,
  signature,
  device_nonce_digest,
  origin_nonce_digest,
  reader_version,
  client_version,
  outcome,
  entry_count,
  accepted_entry_count,
  season_starts,
  received_at,
  retention_expires_at
)
VALUES (
  'obs_RRRRRRRRRRRRRRRRRRRRRR',
  'key_RRRRRRRRRRRRRRRRRRRRRR',
  'dev_RRRRRRRRRRRRRRRRRRRRRR',
  'ins_RRRRRRRRRRRRRRRRRRRRRR',
  'acc_RRRRRRRRRRRRRRRRRRRRRR',
  'syn_RRRRRRRRRRRRRRRRRRRRRR',
  pg_catalog.transaction_timestamp() - interval '12 days',
  pg_catalog.decode(pg_catalog.repeat('7b', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('7c', 64), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('7d', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('7e', 32), 'hex'),
  'codex_app_server_0_144_5_v1',
  '0.0.0',
  'accepted',
  1,
  1,
  ARRAY[pg_temp.season_start(pg_temp.utc_date() - 1)],
  pg_catalog.transaction_timestamp() - interval '12 days',
  pg_catalog.transaction_timestamp() - interval '1 day'
);

INSERT INTO viberacing_private.usage_idempotency_records (
  device_key_id,
  sync_id,
  device_id,
  agent_account_id,
  observation_id,
  body_digest,
  signature,
  device_nonce_digest,
  semantic_digest,
  observed_at,
  reader_version,
  client_version,
  original_outcome,
  original_accepted_entry_count,
  season_starts,
  created_at,
  retention_expires_at
)
VALUES (
  'key_RRRRRRRRRRRRRRRRRRRRRR',
  'syn_RRRRRRRRRRRRRRRRRRRRRR',
  'dev_RRRRRRRRRRRRRRRRRRRRRR',
  'acc_RRRRRRRRRRRRRRRRRRRRRR',
  'obs_RRRRRRRRRRRRRRRRRRRRRR',
  pg_catalog.decode(pg_catalog.repeat('7b', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('7c', 64), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('7d', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('7f', 32), 'hex'),
  pg_catalog.transaction_timestamp() - interval '12 days',
  'codex_app_server_0_144_5_v1',
  '0.0.0',
  'accepted',
  1,
  ARRAY[pg_temp.season_start(pg_temp.utc_date() - 1)],
  pg_catalog.transaction_timestamp() - interval '12 days',
  pg_catalog.transaction_timestamp() - interval '1 day'
);

INSERT INTO viberacing_private.agent_account_day_totals (
  agent_account_id,
  usage_date,
  cumulative_token_total,
  accepted_observation_id,
  accepted_sync_id,
  accepted_device_id,
  first_accepted_at,
  last_accepted_at
)
VALUES (
  'acc_RRRRRRRRRRRRRRRRRRRRRR',
  pg_temp.utc_date() - 1,
  100,
  'obs_RRRRRRRRRRRRRRRRRRRRRR',
  'syn_RRRRRRRRRRRRRRRRRRRRRR',
  'dev_RRRRRRRRRRRRRRRRRRRRRR',
  pg_catalog.transaction_timestamp() - interval '12 days',
  pg_catalog.transaction_timestamp() - interval '12 days'
);

INSERT INTO viberacing_private.ranking_events (
  event_id,
  event_type,
  reason_code,
  actor_class,
  occurred_at,
  event_digest
)
VALUES (
  'evt_RRRRRRRRRRRRRRRRRRRRRR',
  'appeal_resolved',
  'retention_complete',
  'jobs',
  pg_catalog.transaction_timestamp() - interval '181 days',
  pg_catalog.decode(pg_catalog.repeat('80', 32), 'hex')
);

INSERT INTO viberacing_private.pairing_transactions (
  pairing_id,
  installation_id,
  manifest_digest,
  start_proof_digest,
  poll_verifier_digest,
  user_code_verifier_digest,
  possession_challenge,
  state,
  created_at,
  expires_at
)
VALUES (
  'pair_PPPPPPPPPPPPPPPPPPPPPP',
  'ins_PPPPPPPPPPPPPPPPPPPPPP',
  pg_catalog.decode(pg_catalog.repeat('81', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('83', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('84', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('85', 32), 'hex'),
  'rejected',
  pg_catalog.transaction_timestamp() - interval '30 minutes',
  pg_catalog.transaction_timestamp() - interval '20 minutes'
),
(
  'pair_DDDDDDDDDDDDDDDDDDDDDD',
  'ins_DDDDDDDDDDDDDDDDDDDDDD',
  pg_catalog.decode(pg_catalog.repeat('98', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('99', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('9a', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('9b', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('9c', 32), 'hex'),
  'pending',
  pg_catalog.transaction_timestamp(),
  pg_catalog.transaction_timestamp() + interval '9 minutes'
);

INSERT INTO viberacing_private.pairing_candidates (
  pairing_id,
  candidate_id,
  provider_code,
  reader_version,
  accounting_revision,
  scope_kind,
  fingerprint_kind,
  fingerprint_digest,
  proposed_sync_public_key,
  safe_local_display_label,
  preview_current_week_token_total,
  preview_status,
  decision,
  target_agent_account_id,
  approved_device_key_id,
  approved_device_id
)
VALUES (
  'pair_PPPPPPPPPPPPPPPPPPPPPP',
  'cand_PPPPPPPPPPPPPPPPPPPPPP',
  'codex',
  'codex_app_server_0_144_5_v1',
  1,
  'agent_account',
  'stable_opaque',
  pg_catalog.decode(pg_catalog.repeat('86', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('87', 32), 'hex'),
  'Expired provisional',
  '0',
  'ready',
  'create',
  'acc_PPPPPPPPPPPPPPPPPPPPPP',
  'key_PPPPPPPPPPPPPPPPPPPPPP',
  'dev_PPPPPPPPPPPPPPPPPPPPPP'
);

INSERT INTO viberacing_private.passkeys (
  passkey_id,
  profile_id,
  credential_id,
  cose_public_key,
  backup_eligible,
  backup_state,
  label,
  created_at
)
VALUES (
  '70000000-0000-4000-8000-000000000301',
  '70000000-0000-4000-8000-000000000004',
  pg_catalog.decode(pg_catalog.repeat('9d', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('9e', 32), 'hex'),
  false,
  false,
  'Deletion passkey',
  pg_catalog.transaction_timestamp() - interval '1 day'
);

INSERT INTO viberacing_private.sessions (
  session_id,
  profile_id,
  verifier_digest,
  authenticated_by_passkey_id,
  authentication_kind,
  created_at,
  expires_at,
  last_used_at
)
VALUES (
  '70000000-0000-4000-8000-000000000101',
  '70000000-0000-4000-8000-000000000002',
  pg_catalog.decode(pg_catalog.repeat('88', 32), 'hex'),
  NULL,
  'github',
  pg_catalog.transaction_timestamp() - interval '2 days',
  pg_catalog.transaction_timestamp() - interval '1 day',
  pg_catalog.transaction_timestamp() - interval '2 days'
),
(
  '70000000-0000-4000-8000-000000000302',
  '70000000-0000-4000-8000-000000000004',
  pg_catalog.decode(pg_catalog.repeat('9f', 32), 'hex'),
  '70000000-0000-4000-8000-000000000301',
  'passkey',
  pg_catalog.transaction_timestamp() - interval '1 hour',
  pg_catalog.transaction_timestamp() + interval '1 day',
  pg_catalog.transaction_timestamp() - interval '1 hour'
);

INSERT INTO viberacing_private.auth_challenges (
  challenge_id,
  session_id,
  profile_id,
  purpose,
  challenge_digest,
  context_digest,
  created_at,
  expires_at
)
VALUES (
  '70000000-0000-4000-8000-000000000102',
  NULL,
  NULL,
  'passkey_login',
  pg_catalog.decode(pg_catalog.repeat('89', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('8a', 32), 'hex'),
  pg_catalog.transaction_timestamp() - interval '10 minutes',
  pg_catalog.transaction_timestamp() - interval '5 minutes'
),
(
  '70000000-0000-4000-8000-000000000303',
  '70000000-0000-4000-8000-000000000302',
  '70000000-0000-4000-8000-000000000004',
  'profile_delete',
  pg_catalog.decode(pg_catalog.repeat('a0', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
  pg_catalog.transaction_timestamp(),
  pg_catalog.transaction_timestamp() + interval '5 minutes'
);

INSERT INTO viberacing_private.invites (
  invite_id,
  verifier_digest,
  reason_code,
  issued_at,
  expires_at
)
VALUES (
  '70000000-0000-4000-8000-000000000103',
  pg_catalog.decode(pg_catalog.repeat('8b', 32), 'hex'),
  'BETA_RETENTION',
  pg_catalog.transaction_timestamp() - interval '2 days',
  pg_catalog.transaction_timestamp() - interval '1 day'
);

INSERT INTO viberacing_private.recovery_codes (
  recovery_code_id,
  profile_id,
  verifier_phc,
  state,
  created_at,
  used_at
)
VALUES (
  '70000000-0000-4000-8000-000000000104',
  '70000000-0000-4000-8000-000000000002',
  pg_catalog.repeat('a', 32),
  'used',
  pg_catalog.transaction_timestamp() - interval '40 days',
  pg_catalog.transaction_timestamp() - interval '31 days'
);

INSERT INTO viberacing_private.passkeys (
  passkey_id,
  profile_id,
  credential_id,
  cose_public_key,
  backup_eligible,
  backup_state,
  label,
  state,
  created_at,
  revoked_at
)
VALUES (
  '70000000-0000-4000-8000-000000000201',
  '70000000-0000-4000-8000-000000000003',
  pg_catalog.decode(pg_catalog.repeat('8c', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('8d', 32), 'hex'),
  false,
  false,
  'Revoked retention passkey',
  'revoked',
  pg_catalog.transaction_timestamp() - interval '200 days',
  pg_catalog.transaction_timestamp() - interval '181 days'
);

INSERT INTO viberacing_private.leaderboard_snapshots (
  snapshot_id,
  season_start,
  trust_tier,
  revision,
  generated_at,
  finalized,
  participant_count,
  state
)
VALUES (
  'snp_RRRRRRRRRRRRRRRRRRRRRR',
  pg_temp.season_start(pg_temp.utc_date() - 1),
  'community',
  900001,
  pg_catalog.transaction_timestamp() - interval '2 hours',
  false,
  0,
  'building'
);

INSERT INTO viberacing_private.leaderboard_snapshot_pages (
  snapshot_id,
  page_kind,
  page_number,
  participant_count,
  canonical_payload,
  payload_digest
)
VALUES (
  'snp_RRRRRRRRRRRRRRRRRRRRRR',
  'leaderboard_page',
  1,
  0,
  '{}',
  pg_catalog.sha256(pg_catalog.convert_to('{}', 'UTF8'))
);

UPDATE viberacing_private.pairing_request_windows
SET window_started_at = pg_catalog.transaction_timestamp() - interval '2 hours',
    attempt_count = 1
WHERE operation = 'start'
  AND bucket = 0;

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT viberacing_api.request_profile_deletion(
  '70000000-0000-4000-8000-000000000302',
  pg_catalog.decode(pg_catalog.repeat('9f', 32), 'hex'),
  '70000000-0000-4000-8000-000000000303',
  pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
  '70000000-0000-4000-8000-000000000301',
  1,
  false,
  'retention-delete'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

DO $deletion_lockdown_assertion$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.profiles
    WHERE profile_id = '70000000-0000-4000-8000-000000000004'
      AND state = 'deletion_pending'
      AND public_visibility = 'hidden'
      AND deletion_requested_at IS NOT NULL
  ) OR NOT EXISTS (
    SELECT 1
    FROM viberacing_private.agent_accounts
    WHERE agent_account_id = 'acc_DDDDDDDDDDDDDDDDDDDDDD'
      AND state = 'unlinked'
      AND unlinked_at IS NOT NULL
  ) OR NOT EXISTS (
    SELECT 1
    FROM viberacing_private.connector_installations
    WHERE installation_id = 'ins_DDDDDDDDDDDDDDDDDDDDDD'
      AND state = 'revoked'
      AND revoked_at IS NOT NULL
  ) OR NOT EXISTS (
    SELECT 1
    FROM viberacing_private.device_keys
    WHERE device_key_id = 'key_DDDDDDDDDDDDDDDDDDDDDD'
      AND state = 'revoked'
      AND revoked_at IS NOT NULL
  ) OR NOT EXISTS (
    SELECT 1
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = 'pair_DDDDDDDDDDDDDDDDDDDDDD'
      AND state = 'expired'
  ) OR NOT EXISTS (
    SELECT 1
    FROM viberacing_private.sessions
    WHERE session_id = '70000000-0000-4000-8000-000000000302'
      AND state = 'revoked'
      AND revoked_at IS NOT NULL
  ) OR NOT EXISTS (
    SELECT 1
    FROM viberacing_private.passkeys
    WHERE passkey_id = '70000000-0000-4000-8000-000000000301'
      AND state = 'revoked'
      AND revoked_at IS NOT NULL
  ) OR NOT EXISTS (
    SELECT 1
    FROM viberacing_private.profile_deletion_jobs
    WHERE profile_id = '70000000-0000-4000-8000-000000000004'
      AND state = 'pending'
  ) THEN
    RAISE EXCEPTION 'profile deletion did not atomically lock down every authority';
  END IF;
END
$deletion_lockdown_assertion$;

INSERT INTO viberacing_private.profile_deletion_jobs (
  profile_id,
  state,
  requested_at,
  completed_at,
  retention_expires_at
)
VALUES (
  '70000000-0000-4000-8000-000000000999',
  'completed',
  pg_catalog.transaction_timestamp() - interval '61 days',
  pg_catalog.transaction_timestamp() - interval '31 days',
  pg_catalog.transaction_timestamp() - interval '1 day'
);

RESET ROLE;
SET LOCAL ROLE viberacing_jobs;

DO $cleanup_assertions$
DECLARE
  cleanup record;
BEGIN
  SELECT * INTO STRICT cleanup
  FROM viberacing_api.cleanup_expired_ranking_events(1000);
  IF cleanup.deleted_events <> 1 THEN
    RAISE EXCEPTION 'ranking event cleanup result is invalid';
  END IF;

  SELECT * INTO STRICT cleanup
  FROM viberacing_api.cleanup_expired_usage_nonces(1000);
  IF cleanup.deleted_origin_nonces <> 1 OR cleanup.deleted_device_nonces <> 1 THEN
    RAISE EXCEPTION 'usage nonce cleanup result is invalid';
  END IF;

  SELECT * INTO STRICT cleanup
  FROM viberacing_api.cleanup_expired_usage_history(1000);
  IF cleanup.redacted_day_totals <> 1
    OR cleanup.deleted_idempotency_records <> 1
    OR cleanup.deleted_observations <> 1
  THEN
    RAISE EXCEPTION 'usage history cleanup result is invalid';
  END IF;

  SELECT * INTO STRICT cleanup
  FROM viberacing_api.cleanup_expired_pairing_state(1000);
  IF cleanup.deleted_pairings <> 1
    OR cleanup.deleted_accounts <> 1
    OR cleanup.deleted_installations <> 1
  THEN
    RAISE EXCEPTION 'pairing cleanup result is invalid';
  END IF;

  SELECT * INTO STRICT cleanup
  FROM viberacing_api.cleanup_expired_auth_state(1000);
  IF cleanup.deleted_challenges <> 1
    OR cleanup.deleted_sessions <> 1
    OR cleanup.deleted_invites <> 1
    OR cleanup.deleted_recovery_codes <> 1
  THEN
    RAISE EXCEPTION 'authentication cleanup result is invalid';
  END IF;

  SELECT * INTO STRICT cleanup
  FROM viberacing_api.cleanup_aged_revoked_authority(1000);
  IF cleanup.redacted_pairings <> 0
    OR cleanup.deleted_passkeys <> 1
    OR cleanup.deleted_device_keys <> 1
    OR cleanup.deleted_installations <> 1
  THEN
    RAISE EXCEPTION 'revoked authority cleanup result is invalid';
  END IF;

  SELECT * INTO STRICT cleanup
  FROM viberacing_api.cleanup_snapshot_history(1000);
  IF cleanup.deleted_snapshots <> 1 THEN
    RAISE EXCEPTION 'snapshot cleanup result is invalid';
  END IF;

  SELECT * INTO STRICT cleanup
  FROM viberacing_api.purge_profile_deletions(10);
  IF cleanup.purged_profiles <> 1 THEN
    RAISE EXCEPTION 'profile deletion purge result is invalid';
  END IF;

  SELECT * INTO STRICT cleanup
  FROM viberacing_api.cleanup_terminal_deletion_jobs(1000);
  IF cleanup.deleted_deletion_jobs <> 1 THEN
    RAISE EXCEPTION 'terminal deletion cleanup result is invalid';
  END IF;

  SELECT * INTO STRICT cleanup
  FROM viberacing_api.reset_expired_pairing_request_windows();
  IF cleanup.reset_windows <> 1 THEN
    RAISE EXCEPTION 'pairing rate reset result is invalid';
  END IF;
END
$cleanup_assertions$;

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

DO $stored_state_assertions$
DECLARE
  v_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
  INTO v_count
  FROM viberacing_private.agent_account_day_totals
  WHERE agent_account_id = 'acc_RRRRRRRRRRRRRRRRRRRRRR'
    AND usage_date = pg_temp.utc_date() - 1
    AND cumulative_token_total = 100
    AND accepted_observation_id IS NULL
    AND accepted_device_id IS NULL
    AND accepted_sync_id = 'syn_RRRRRRRRRRRRRRRRRRRRRR'
    AND provenance_redacted_at IS NOT NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'retention changed the accepted cumulative total';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM viberacing_private.usage_observations
    WHERE observation_id = 'obs_RRRRRRRRRRRRRRRRRRRRRR'
  ) OR EXISTS (
    SELECT 1
    FROM viberacing_private.usage_idempotency_records
    WHERE sync_id = 'syn_RRRRRRRRRRRRRRRRRRRRRR'
  ) THEN
    RAISE EXCEPTION 'expired usage evidence survived cleanup';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM viberacing_private.agent_accounts
    WHERE agent_account_id = 'acc_PPPPPPPPPPPPPPPPPPPPPP'
  ) OR EXISTS (
    SELECT 1
    FROM viberacing_private.connector_installations
    WHERE installation_id = 'ins_PPPPPPPPPPPPPPPPPPPPPP'
  ) THEN
    RAISE EXCEPTION 'expired provisional pairing state survived cleanup';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM viberacing_private.profiles
    WHERE profile_id = '70000000-0000-4000-8000-000000000004'
  ) OR NOT EXISTS (
    SELECT 1
    FROM viberacing_private.profile_deletion_jobs
    WHERE profile_id = '70000000-0000-4000-8000-000000000004'
      AND state = 'completed'
      AND retention_expires_at = completed_at + interval '30 days'
  ) THEN
    RAISE EXCEPTION 'profile purge terminal state is invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.pairing_request_windows
    WHERE operation = 'start'
      AND bucket = 0
      AND attempt_count = 0
      AND window_started_at = TIMESTAMPTZ '1970-01-01 00:00:00+00'
  ) THEN
    RAISE EXCEPTION 'pairing rate window did not return to its exact empty state';
  END IF;
END
$stored_state_assertions$;

RESET ROLE;
SET LOCAL ROLE viberacing_ingest;

DO $post_redaction_sync$
DECLARE
  result record;
BEGIN
  SELECT * INTO STRICT result
  FROM viberacing_api.submit_usage_sync(
    'obs_SSSSSSSSSSSSSSSSSSSSSS',
    'evt_SSSSSSSSSSSSSSSSSSSSSS',
    'edge_retention',
    pg_catalog.decode(pg_catalog.repeat('91', 32), 'hex'),
    pg_catalog.transaction_timestamp() + interval '30 seconds',
    'key_RRRRRRRRRRRRRRRRRRRRRR',
    'dev_RRRRRRRRRRRRRRRRRRRRRR',
    'acc_RRRRRRRRRRRRRRRRRRRRRR',
    'syn_SSSSSSSSSSSSSSSSSSSSSS',
    pg_catalog.transaction_timestamp(),
    '0.0.0',
    'codex_app_server_0_144_5_v1',
    pg_catalog.decode(pg_catalog.repeat('92', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('93', 64), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('94', 32), 'hex'),
    ARRAY[pg_temp.utc_date() - 1],
    ARRAY['200']
  );
  IF result.outcome <> 'accepted'
    OR result.accepted_entries <> 1
    OR result.recovery_action <> 'none'
  THEN
    RAISE EXCEPTION 'higher cumulative sync after provenance redaction failed';
  END IF;
END
$post_redaction_sync$;

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

DO $restored_provenance_assertion$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.agent_account_day_totals
    WHERE agent_account_id = 'acc_RRRRRRRRRRRRRRRRRRRRRR'
      AND usage_date = pg_temp.utc_date() - 1
      AND cumulative_token_total = 200
      AND accepted_observation_id = 'obs_SSSSSSSSSSSSSSSSSSSSSS'
      AND accepted_device_id = 'dev_RRRRRRRRRRRRRRRRRRRRRR'
      AND accepted_sync_id = 'syn_SSSSSSSSSSSSSSSSSSSSSS'
      AND provenance_redacted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'new accepted usage did not restore current provenance';
  END IF;
END
$restored_provenance_assertion$;

ROLLBACK;
