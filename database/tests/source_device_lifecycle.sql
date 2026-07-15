\set ON_ERROR_STOP on

-- Every value below is a deterministic synthetic fixture. The transaction is always rolled back.

BEGIN;

CREATE FUNCTION pg_temp.assert_true(condition boolean, label text)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  IF condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'assertion failed: %', label;
  END IF;
END
$function$;

CREATE FUNCTION pg_temp.expect_operation_failure(statement text, label text)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      RETURN;
  END;

  RAISE EXCEPTION 'expected closed operation failure: %', label;
END
$function$;

SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (
  profile_id,
  github_user_id,
  handle,
  state
)
VALUES
  (
    '00000000-0000-4000-8000-000000004101',
    900000000000004101,
    'lifecycle-alpha',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000004102',
    900000000000004102,
    'lifecycle-beta',
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
    '00000000-0000-4000-8000-000000004201',
    '00000000-0000-4000-8000-000000004101',
    pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour'
  ),
  (
    '00000000-0000-4000-8000-000000004202',
    '00000000-0000-4000-8000-000000004101',
    pg_catalog.decode(pg_catalog.repeat('42', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour'
  ),
  (
    '00000000-0000-4000-8000-000000004203',
    '00000000-0000-4000-8000-000000004102',
    pg_catalog.decode(pg_catalog.repeat('43', 32), 'hex'),
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
    '00000000-0000-4000-8000-000000004301',
    '00000000-0000-4000-8000-000000004101',
    pg_catalog.decode(pg_catalog.repeat('51', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('61', 64), 'hex'),
    'Lifecycle alpha passkey'
  ),
  (
    '00000000-0000-4000-8000-000000004302',
    '00000000-0000-4000-8000-000000004102',
    pg_catalog.decode(pg_catalog.repeat('52', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('62', 64), 'hex'),
    'Lifecycle beta passkey'
  );

INSERT INTO viberacing_private.codex_sources (source_id, profile_id, state)
VALUES
  (
    'src_' || pg_catalog.repeat('P', 22),
    '00000000-0000-4000-8000-000000004101',
    'active'
  ),
  (
    'src_' || pg_catalog.repeat('U', 22),
    '00000000-0000-4000-8000-000000004101',
    'active'
  ),
  (
    'src_' || pg_catalog.repeat('R', 22),
    '00000000-0000-4000-8000-000000004101',
    'active'
  ),
  (
    'src_' || pg_catalog.repeat('Q', 22),
    '00000000-0000-4000-8000-000000004101',
    'quarantined'
  ),
  (
    'src_' || pg_catalog.repeat('B', 22),
    '00000000-0000-4000-8000-000000004101',
    'active'
  ),
  (
    'src_' || pg_catalog.repeat('O', 22),
    '00000000-0000-4000-8000-000000004102',
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
VALUES
  (
    '00000000-0000-4000-8000-000000004401',
    'dev_' || pg_catalog.repeat('P', 22),
    'src_' || pg_catalog.repeat('P', 22),
    pg_catalog.decode(pg_catalog.repeat('71', 32), 'hex'),
    'Pause test connector',
    '4.0.0',
    'linux',
    'x86_64',
    'active',
    pg_catalog.statement_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000004402',
    'dev_' || pg_catalog.repeat('U', 22),
    'src_' || pg_catalog.repeat('U', 22),
    pg_catalog.decode(pg_catalog.repeat('72', 32), 'hex'),
    'Unlink test connector one',
    '4.0.0',
    'windows',
    'x86_64',
    'active',
    pg_catalog.statement_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000004403',
    'dev_' || pg_catalog.repeat('V', 22),
    'src_' || pg_catalog.repeat('U', 22),
    pg_catalog.decode(pg_catalog.repeat('73', 32), 'hex'),
    'Unlink test connector two',
    '4.0.0',
    'macos',
    'aarch64',
    'active',
    pg_catalog.statement_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000004404',
    'dev_' || pg_catalog.repeat('R', 22),
    'src_' || pg_catalog.repeat('R', 22),
    pg_catalog.decode(pg_catalog.repeat('74', 32), 'hex'),
    'Revoke test connector',
    '4.0.0',
    'linux',
    'aarch64',
    'active',
    pg_catalog.statement_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000004405',
    'dev_' || pg_catalog.repeat('B', 22),
    'src_' || pg_catalog.repeat('B', 22),
    pg_catalog.decode(pg_catalog.repeat('75', 32), 'hex'),
    'Rollback test connector',
    '4.0.0',
    'linux',
    'x86_64',
    'active',
    pg_catalog.statement_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000004406',
    'dev_' || pg_catalog.repeat('O', 22),
    'src_' || pg_catalog.repeat('O', 22),
    pg_catalog.decode(pg_catalog.repeat('76', 32), 'hex'),
    'Other profile connector',
    '4.0.0',
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
    '00000000-0000-4000-8000-000000004451',
    pg_catalog.decode(pg_catalog.repeat('81', 32), 'hex'),
    'Paused source pending connector',
    '4.0.0',
    'linux',
    'x86_64'
  ),
  (
    '00000000-0000-4000-8000-000000004452',
    pg_catalog.decode(pg_catalog.repeat('82', 32), 'hex'),
    'Unlinked source pending connector',
    '4.0.0',
    'linux',
    'x86_64'
  ),
  (
    '00000000-0000-4000-8000-000000004453',
    pg_catalog.decode(pg_catalog.repeat('83', 32), 'hex'),
    'Rollback source pending connector',
    '4.0.0',
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
VALUES
  (
    '00000000-0000-4000-8000-000000004501',
    pg_catalog.decode(pg_catalog.repeat('84', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('85', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('86', 32), 'hex'),
    '00000000-0000-4000-8000-000000004451',
    'Paused source pending connector',
    '4.0.0',
    'linux',
    'x86_64',
    'approved',
    '00000000-0000-4000-8000-000000004101',
    'existing',
    'src_' || pg_catalog.repeat('P', 22),
    '00000000-0000-4000-8000-000000004201',
    '00000000-0000-4000-8000-000000004301',
    pg_catalog.statement_timestamp() + INTERVAL '8 minutes',
    pg_catalog.statement_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000004502',
    pg_catalog.decode(pg_catalog.repeat('87', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('88', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('89', 32), 'hex'),
    '00000000-0000-4000-8000-000000004452',
    'Unlinked source pending connector',
    '4.0.0',
    'linux',
    'x86_64',
    'approved',
    '00000000-0000-4000-8000-000000004101',
    'existing',
    'src_' || pg_catalog.repeat('U', 22),
    '00000000-0000-4000-8000-000000004201',
    '00000000-0000-4000-8000-000000004301',
    pg_catalog.statement_timestamp() + INTERVAL '8 minutes',
    pg_catalog.statement_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000004503',
    pg_catalog.decode(pg_catalog.repeat('8a', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('8b', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('8c', 32), 'hex'),
    '00000000-0000-4000-8000-000000004453',
    'Rollback source pending connector',
    '4.0.0',
    'linux',
    'x86_64',
    'approved',
    '00000000-0000-4000-8000-000000004101',
    'existing',
    'src_' || pg_catalog.repeat('B', 22),
    '00000000-0000-4000-8000-000000004201',
    '00000000-0000-4000-8000-000000004301',
    pg_catalog.statement_timestamp() + INTERVAL '8 minutes',
    pg_catalog.statement_timestamp()
  );

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT *
    FROM viberacing_api.read_source_inventory(
      '00000000-0000-4000-8000-000000004201',
      pg_catalog.decode(pg_catalog.repeat('ff', 32), 'hex')
    )
  $sql$,
  'inventory requires possession of the exact active session verifier'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
    FROM viberacing_api.read_source_inventory(
      '00000000-0000-4000-8000-000000004203',
      pg_catalog.decode(pg_catalog.repeat('43', 32), 'hex')
    )
    WHERE source_id = 'src_' || pg_catalog.repeat('O', 22)
      AND device_id = 'dev_' || pg_catalog.repeat('O', 22)
  ),
  'inventory is derived from the session profile and excludes other profiles'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.pause_source(
      '00000000-0000-4000-8000-000000004203',
      pg_catalog.decode(pg_catalog.repeat('43', 32), 'hex'),
      'src_' || pg_catalog.repeat('P', 22),
      '00000000-0000-4000-8000-000000004991',
      'req_' || pg_catalog.repeat('Z', 22)
    )
  $sql$,
  'another profile cannot pause a source by identifier'
);

SELECT viberacing_api.create_source_action_challenge(
  '00000000-0000-4000-8000-000000004202',
  pg_catalog.decode(pg_catalog.repeat('42', 32), 'hex'),
  'src_' || pg_catalog.repeat('P', 22),
  'source_unlink',
  '00000000-0000-4000-8000-000000004601',
  pg_catalog.decode(pg_catalog.repeat('91', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
);

SELECT viberacing_api.pause_source(
  '00000000-0000-4000-8000-000000004201',
  pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
  'src_' || pg_catalog.repeat('P', 22),
  '00000000-0000-4000-8000-000000004901',
  'req_' || pg_catalog.repeat('A', 22)
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.pause_source(
      '00000000-0000-4000-8000-000000004201',
      pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
      'src_' || pg_catalog.repeat('P', 22),
      '00000000-0000-4000-8000-000000004992',
      'req_' || pg_catalog.repeat('Y', 22)
    )
  $sql$,
  'pause replay is a closed non-success'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT state = 'paused'
    FROM viberacing_private.codex_sources
    WHERE source_id = 'src_' || pg_catalog.repeat('P', 22)
  )
  AND (
    SELECT state = 'cancelled'
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '00000000-0000-4000-8000-000000004501'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.auth_challenges
    WHERE challenge_id = '00000000-0000-4000-8000-000000004601'
  )
  AND (
    SELECT pg_catalog.count(*) = 1
    FROM viberacing_private.audit_events
    WHERE audit_event_id = '00000000-0000-4000-8000-000000004901'
      AND event_type = 'source.paused'
  ),
  'pause changes only the owned source, cancels approved authority, and invalidates stale step-up'
);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.create_source_action_challenge(
      '00000000-0000-4000-8000-000000004201',
      pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
      'src_' || pg_catalog.repeat('R', 22),
      'source_reactivation',
      '00000000-0000-4000-8000-000000004691',
      pg_catalog.decode(pg_catalog.repeat('e1', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('f1', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
    )
  $sql$,
  'an active source cannot use the reactivation path'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.create_source_action_challenge(
      '00000000-0000-4000-8000-000000004201',
      pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
      'src_' || pg_catalog.repeat('Q', 22),
      'source_reactivation',
      '00000000-0000-4000-8000-000000004692',
      pg_catalog.decode(pg_catalog.repeat('e2', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('f2', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
    )
  $sql$,
  'normal user authority cannot lift quarantine'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.create_source_action_challenge(
      '00000000-0000-4000-8000-000000004203',
      pg_catalog.decode(pg_catalog.repeat('43', 32), 'hex'),
      'src_' || pg_catalog.repeat('P', 22),
      'source_reactivation',
      '00000000-0000-4000-8000-000000004693',
      pg_catalog.decode(pg_catalog.repeat('e3', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('f3', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
    )
  $sql$,
  'another profile cannot create step-up for an owned source'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.create_source_action_challenge(
      '00000000-0000-4000-8000-000000004201',
      pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
      'src_' || pg_catalog.repeat('P', 22),
      'source_reactivation',
      '00000000-0000-4000-8000-000000004694',
      pg_catalog.decode(pg_catalog.repeat('e4', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('f4', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '6 minutes'
    )
  $sql$,
  'source step-up lifetime is absolutely bounded'
);

SELECT viberacing_api.create_source_action_challenge(
  '00000000-0000-4000-8000-000000004202',
  pg_catalog.decode(pg_catalog.repeat('42', 32), 'hex'),
  'src_' || pg_catalog.repeat('P', 22),
  'source_unlink',
  '00000000-0000-4000-8000-000000004602',
  pg_catalog.decode(pg_catalog.repeat('92', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('a2', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
);

SELECT viberacing_api.create_source_action_challenge(
  '00000000-0000-4000-8000-000000004201',
  pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
  'src_' || pg_catalog.repeat('P', 22),
  'source_reactivation',
  '00000000-0000-4000-8000-000000004603',
  pg_catalog.decode(pg_catalog.repeat('93', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('a3', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
);

SELECT pg_temp.assert_true(
  NOT viberacing_api.consume_passkey_challenge(
    '00000000-0000-4000-8000-000000004201',
    pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
    '00000000-0000-4000-8000-000000004603',
    'source_reactivation',
    pg_catalog.decode(pg_catalog.repeat('93', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('ff', 32), 'hex'),
    '00000000-0000-4000-8000-000000004301',
    0,
    false
  ),
  'wrong source action context reveals no challenge state'
);

SELECT pg_temp.assert_true(
  viberacing_api.consume_passkey_challenge(
    '00000000-0000-4000-8000-000000004201',
    pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
    '00000000-0000-4000-8000-000000004603',
    'source_reactivation',
    pg_catalog.decode(pg_catalog.repeat('93', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('a3', 32), 'hex'),
    '00000000-0000-4000-8000-000000004301',
    0,
    false
  ),
  'fresh source reactivation step-up is consumed once'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.reactivate_source(
      '00000000-0000-4000-8000-000000004201',
      pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
      'src_' || pg_catalog.repeat('R', 22),
      '00000000-0000-4000-8000-000000004603',
      pg_catalog.decode(pg_catalog.repeat('a3', 32), 'hex'),
      '00000000-0000-4000-8000-000000004993',
      'req_' || pg_catalog.repeat('X', 22)
    )
  $sql$,
  'reactivation challenge cannot be redirected to another owned source'
);

SELECT viberacing_api.reactivate_source(
  '00000000-0000-4000-8000-000000004201',
  pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
  'src_' || pg_catalog.repeat('P', 22),
  '00000000-0000-4000-8000-000000004603',
  pg_catalog.decode(pg_catalog.repeat('a3', 32), 'hex'),
  '00000000-0000-4000-8000-000000004902',
  'req_' || pg_catalog.repeat('B', 22)
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.reactivate_source(
      '00000000-0000-4000-8000-000000004201',
      pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
      'src_' || pg_catalog.repeat('P', 22),
      '00000000-0000-4000-8000-000000004603',
      pg_catalog.decode(pg_catalog.repeat('a3', 32), 'hex'),
      '00000000-0000-4000-8000-000000004994',
      'req_' || pg_catalog.repeat('W', 22)
    )
  $sql$,
  'reactivation action replay is rejected'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT state = 'active'
    FROM viberacing_private.codex_sources
    WHERE source_id = 'src_' || pg_catalog.repeat('P', 22)
  )
  AND (
    SELECT authorized_action_used_at IS NOT NULL
    FROM viberacing_private.auth_challenges
    WHERE challenge_id = '00000000-0000-4000-8000-000000004603'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.auth_challenges
    WHERE challenge_id = '00000000-0000-4000-8000-000000004602'
  )
  AND (
    SELECT pg_catalog.count(*) = 1
    FROM viberacing_private.audit_events
    WHERE audit_event_id = '00000000-0000-4000-8000-000000004902'
      AND event_type = 'source.reactivated'
  ),
  'reactivation uses one exact challenge and invalidates unused source actions across sessions'
);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT viberacing_api.create_source_action_challenge(
  '00000000-0000-4000-8000-000000004202',
  pg_catalog.decode(pg_catalog.repeat('42', 32), 'hex'),
  'src_' || pg_catalog.repeat('U', 22),
  'source_unlink',
  '00000000-0000-4000-8000-000000004604',
  pg_catalog.decode(pg_catalog.repeat('94', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('a4', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
);

SELECT viberacing_api.create_source_action_challenge(
  '00000000-0000-4000-8000-000000004201',
  pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
  'src_' || pg_catalog.repeat('U', 22),
  'source_unlink',
  '00000000-0000-4000-8000-000000004605',
  pg_catalog.decode(pg_catalog.repeat('95', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('a5', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
);

SELECT pg_temp.assert_true(
  viberacing_api.consume_passkey_challenge(
    '00000000-0000-4000-8000-000000004201',
    pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
    '00000000-0000-4000-8000-000000004605',
    'source_unlink',
    pg_catalog.decode(pg_catalog.repeat('95', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('a5', 32), 'hex'),
    '00000000-0000-4000-8000-000000004301',
    0,
    false
  ),
  'fresh source unlink step-up is consumed once'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.unlink_source(
      '00000000-0000-4000-8000-000000004203',
      pg_catalog.decode(pg_catalog.repeat('43', 32), 'hex'),
      'src_' || pg_catalog.repeat('U', 22),
      '00000000-0000-4000-8000-000000004605',
      pg_catalog.decode(pg_catalog.repeat('a5', 32), 'hex'),
      '00000000-0000-4000-8000-000000004995',
      'req_' || pg_catalog.repeat('V', 22)
    )
  $sql$,
  'another profile cannot claim an unlink step-up'
);

SELECT viberacing_api.unlink_source(
  '00000000-0000-4000-8000-000000004201',
  pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
  'src_' || pg_catalog.repeat('U', 22),
  '00000000-0000-4000-8000-000000004605',
  pg_catalog.decode(pg_catalog.repeat('a5', 32), 'hex'),
  '00000000-0000-4000-8000-000000004903',
  'req_' || pg_catalog.repeat('C', 22)
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.unlink_source(
      '00000000-0000-4000-8000-000000004201',
      pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
      'src_' || pg_catalog.repeat('U', 22),
      '00000000-0000-4000-8000-000000004605',
      pg_catalog.decode(pg_catalog.repeat('a5', 32), 'hex'),
      '00000000-0000-4000-8000-000000004996',
      'req_' || pg_catalog.repeat('U', 22)
    )
  $sql$,
  'unlink action replay is rejected'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT state = 'unlinked'
    FROM viberacing_private.codex_sources
    WHERE source_id = 'src_' || pg_catalog.repeat('U', 22)
  )
  AND (
    SELECT pg_catalog.count(*) = 2
    FROM viberacing_private.device_keys
    WHERE source_id = 'src_' || pg_catalog.repeat('U', 22)
      AND state = 'revoked'
      AND revoked_at IS NOT NULL
  )
  AND (
    SELECT state = 'cancelled'
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '00000000-0000-4000-8000-000000004502'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.auth_challenges
    WHERE challenge_id = '00000000-0000-4000-8000-000000004604'
  )
  AND (
    SELECT authorized_action_used_at IS NOT NULL
    FROM viberacing_private.auth_challenges
    WHERE challenge_id = '00000000-0000-4000-8000-000000004605'
  ),
  'unlink atomically revokes every active device, cancels approved authority, and clears stale actions'
);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.revoke_device(
      '00000000-0000-4000-8000-000000004203',
      pg_catalog.decode(pg_catalog.repeat('43', 32), 'hex'),
      'dev_' || pg_catalog.repeat('R', 22),
      '00000000-0000-4000-8000-000000004997',
      'req_' || pg_catalog.repeat('T', 22)
    )
  $sql$,
  'another profile cannot revoke a device by identifier'
);

SELECT viberacing_api.revoke_device(
  '00000000-0000-4000-8000-000000004201',
  pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
  'dev_' || pg_catalog.repeat('R', 22),
  '00000000-0000-4000-8000-000000004904',
  'req_' || pg_catalog.repeat('D', 22)
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.revoke_device(
      '00000000-0000-4000-8000-000000004201',
      pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
      'dev_' || pg_catalog.repeat('R', 22),
      '00000000-0000-4000-8000-000000004998',
      'req_' || pg_catalog.repeat('S', 22)
    )
  $sql$,
  'device revoke replay is a closed non-success'
);

SELECT viberacing_api.create_source_action_challenge(
  '00000000-0000-4000-8000-000000004201',
  pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
  'src_' || pg_catalog.repeat('B', 22),
  'source_unlink',
  '00000000-0000-4000-8000-000000004606',
  pg_catalog.decode(pg_catalog.repeat('96', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('a6', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
);

SELECT pg_temp.assert_true(
  viberacing_api.consume_passkey_challenge(
    '00000000-0000-4000-8000-000000004201',
    pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
    '00000000-0000-4000-8000-000000004606',
    'source_unlink',
    pg_catalog.decode(pg_catalog.repeat('96', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('a6', 32), 'hex'),
    '00000000-0000-4000-8000-000000004301',
    0,
    false
  ),
  'rollback scenario consumes its exact source unlink step-up'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.unlink_source(
      '00000000-0000-4000-8000-000000004201',
      pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
      'src_' || pg_catalog.repeat('B', 22),
      '00000000-0000-4000-8000-000000004606',
      pg_catalog.decode(pg_catalog.repeat('a6', 32), 'hex'),
      '00000000-0000-4000-8000-000000004904',
      'req_' || pg_catalog.repeat('E', 22)
    )
  $sql$,
  'duplicate audit identity closes unlink instead of committing partial state'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT state = 'active'
    FROM viberacing_private.codex_sources
    WHERE source_id = 'src_' || pg_catalog.repeat('B', 22)
  )
  AND (
    SELECT state = 'active' AND revoked_at IS NULL
    FROM viberacing_private.device_keys
    WHERE device_id = 'dev_' || pg_catalog.repeat('B', 22)
  )
  AND (
    SELECT state = 'approved'
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '00000000-0000-4000-8000-000000004503'
  )
  AND (
    SELECT consumed_at IS NOT NULL AND authorized_action_used_at IS NULL
    FROM viberacing_private.auth_challenges
    WHERE challenge_id = '00000000-0000-4000-8000-000000004606'
  ),
  'audit failure rolls back the challenge claim, source, device, and pairing changes atomically'
);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT viberacing_api.unlink_source(
  '00000000-0000-4000-8000-000000004201',
  pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
  'src_' || pg_catalog.repeat('B', 22),
  '00000000-0000-4000-8000-000000004606',
  pg_catalog.decode(pg_catalog.repeat('a6', 32), 'hex'),
  '00000000-0000-4000-8000-000000004905',
  'req_' || pg_catalog.repeat('F', 22)
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.create_source_action_challenge(
      '00000000-0000-4000-8000-000000004201',
      pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
      'src_' || pg_catalog.repeat('B', 22),
      'source_unlink',
      '00000000-0000-4000-8000-000000004699',
      pg_catalog.decode(pg_catalog.repeat('ef', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('fe', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '4 minutes'
    )
  $sql$,
  'unlinked source is terminal for normal user lifecycle authority'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 6
    FROM viberacing_api.read_source_inventory(
      '00000000-0000-4000-8000-000000004201',
      pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex')
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_api.read_source_inventory(
      '00000000-0000-4000-8000-000000004201',
      pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex')
    )
    WHERE source_id = 'src_' || pg_catalog.repeat('O', 22)
  ),
  'private inventory returns every owned source/device row and no cross-profile row'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT state = 'revoked' AND revoked_at IS NOT NULL
    FROM viberacing_private.device_keys
    WHERE device_id = 'dev_' || pg_catalog.repeat('R', 22)
  )
  AND (
    SELECT state = 'unlinked'
    FROM viberacing_private.codex_sources
    WHERE source_id = 'src_' || pg_catalog.repeat('B', 22)
  )
  AND (
    SELECT state = 'revoked' AND revoked_at IS NOT NULL
    FROM viberacing_private.device_keys
    WHERE device_id = 'dev_' || pg_catalog.repeat('B', 22)
  )
  AND (
    SELECT state = 'cancelled'
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '00000000-0000-4000-8000-000000004503'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.device_keys AS device_record
    JOIN viberacing_private.codex_sources AS source_record
      ON source_record.source_id = device_record.source_id
    WHERE source_record.state = 'unlinked'
      AND device_record.state = 'active'
  ),
  'successful retry leaves no active device authority on any unlinked source'
);

SELECT pg_temp.assert_true(
  pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'viberacing_api.read_source_inventory(uuid,bytea)'::regprocedure
    ),
    'public_key'
  ) = 0
  AND pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'viberacing_api.read_source_inventory(uuid,bytea)'::regprocedure
    ),
    'device_key_id'
  ) = 0
  AND pg_catalog.strpos(
    pg_catalog.pg_get_function_result(
      'viberacing_api.read_source_inventory(uuid,bytea)'::regprocedure
    ),
    'profile_id'
  ) = 0,
  'inventory result omits internal key, profile, and public-key material'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 5
    FROM viberacing_private.audit_events
    WHERE profile_id = '00000000-0000-4000-8000-000000004101'
      AND event_type IN (
        'source.paused',
        'source.reactivated',
        'source.unlinked',
        'device.revoked'
      )
      AND reason_code IS NULL
  ),
  'every successful lifecycle change emits one bounded audit reference'
);

ROLLBACK;
