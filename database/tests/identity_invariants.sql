\set ON_ERROR_STOP on

-- All values below are deterministic synthetic fixtures. The transaction is always rolled back.

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

CREATE FUNCTION pg_temp.expect_integrity_failure(statement text, label text)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  BEGIN
    EXECUTE statement;
    SET CONSTRAINTS ALL IMMEDIATE;
  EXCEPTION
    WHEN integrity_constraint_violation THEN
      RETURN;
  END;

  RAISE EXCEPTION 'expected integrity failure: %', label;
END
$function$;

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_database AS database
    CROSS JOIN LATERAL pg_catalog.aclexplode(database.datacl) AS privilege
    WHERE database.datname = pg_catalog.current_database()
      AND privilege.grantee = 0
      AND privilege.privilege_type IN ('CONNECT', 'CREATE', 'TEMPORARY')
  ),
  'PUBLIC has no database capability'
);

SELECT pg_temp.assert_true(
  (
    SELECT setting.setconfig @> ARRAY['search_path=pg_catalog, pg_temp']::text[]
    FROM pg_catalog.pg_db_role_setting AS setting
    JOIN pg_catalog.pg_database AS database ON database.oid = setting.setdatabase
    WHERE database.datname = pg_catalog.current_database()
      AND setting.setrole = 0
  ),
  'database default search_path excludes writable schemas'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 13
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'viberacing_private'
      AND relation.relkind = 'r'
  ),
  'all identity and audit tables exist'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.bool_and(
      relation.relrowsecurity
      AND relation.relforcerowsecurity
      AND owner_role.rolname = 'viberacing_owner'
    )
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = relation.relowner
    WHERE namespace.nspname = 'viberacing_private'
      AND relation.relkind = 'r'
  ),
  'every private table is owner-owned with forced RLS'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.bool_and(
      NOT runtime_role.rolsuper
      AND NOT runtime_role.rolinherit
      AND NOT runtime_role.rolcreaterole
      AND NOT runtime_role.rolcreatedb
      AND NOT runtime_role.rolcanlogin
      AND NOT runtime_role.rolreplication
      AND NOT runtime_role.rolbypassrls
    )
    FROM pg_catalog.pg_roles AS runtime_role
    WHERE runtime_role.rolname IN (
      'viberacing_web',
      'viberacing_ingest',
      'viberacing_jobs',
      'viberacing_admin'
    )
  ),
  'runtime roles are non-login and unprivileged'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS member_role ON member_role.oid = membership.member
    WHERE member_role.rolname IN (
      'viberacing_owner',
      'viberacing_web',
      'viberacing_ingest',
      'viberacing_jobs',
      'viberacing_admin'
    )
  ),
  'database group roles do not inherit another role'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.bool_and(
      NOT pg_catalog.has_schema_privilege(runtime_role.rolname, 'viberacing_private', 'USAGE')
      AND pg_catalog.has_schema_privilege(runtime_role.rolname, 'viberacing_api', 'USAGE')
      AND NOT pg_catalog.has_schema_privilege(runtime_role.rolname, 'viberacing_api', 'CREATE')
    )
    FROM pg_catalog.pg_roles AS runtime_role
    WHERE runtime_role.rolname IN (
      'viberacing_web',
      'viberacing_ingest',
      'viberacing_jobs',
      'viberacing_admin'
    )
  ),
  'runtime roles can resolve only the closed API schema'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS runtime_role
    CROSS JOIN pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE runtime_role.rolname IN (
      'viberacing_web',
      'viberacing_ingest',
      'viberacing_jobs',
      'viberacing_admin'
    )
      AND namespace.nspname = 'viberacing_private'
      AND relation.relkind IN ('r', 'v', 'm', 'S')
      AND (
        pg_catalog.has_table_privilege(runtime_role.rolname, relation.oid, 'SELECT')
        OR pg_catalog.has_table_privilege(runtime_role.rolname, relation.oid, 'INSERT')
        OR pg_catalog.has_table_privilege(runtime_role.rolname, relation.oid, 'UPDATE')
        OR pg_catalog.has_table_privilege(runtime_role.rolname, relation.oid, 'DELETE')
        OR pg_catalog.has_table_privilege(runtime_role.rolname, relation.oid, 'TRUNCATE')
        OR pg_catalog.has_table_privilege(runtime_role.rolname, relation.oid, 'REFERENCES')
        OR pg_catalog.has_table_privilege(runtime_role.rolname, relation.oid, 'TRIGGER')
      )
  ),
  'runtime roles have no direct private relation capability'
);

SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.invites (
  invite_id,
  verifier_digest,
  created_at,
  expires_at
)
VALUES (
  '00000000-0000-4000-8000-000000000101',
  pg_catalog.decode(pg_catalog.repeat('10', 32), 'hex'),
  '2020-01-01T00:00:00.000Z',
  '2020-01-02T00:00:00.000Z'
);

INSERT INTO viberacing_private.profiles (
  profile_id,
  github_user_id,
  handle,
  created_at,
  updated_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000000001',
    900000000000000001,
    'demo-driver',
    '2020-01-01T00:00:00.000Z',
    '2020-01-01T00:00:00.000Z'
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    900000000000000002,
    'sample-racer',
    '2020-01-01T00:00:00.000Z',
    '2020-01-01T00:00:00.000Z'
  );

UPDATE viberacing_private.invites
SET
  state = 'redeemed',
  redeemed_at = '2020-01-01T00:01:00.000Z',
  redeemed_profile_id = '00000000-0000-4000-8000-000000000001'
WHERE invite_id = '00000000-0000-4000-8000-000000000101';

SELECT pg_temp.expect_integrity_failure(
  $sql$
    INSERT INTO viberacing_private.profiles (
      profile_id, github_user_id, handle, created_at, updated_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000003',
      900000000000000001,
      'third-driver',
      '2020-01-01T00:00:00.000Z',
      '2020-01-01T00:00:00.000Z'
    )
  $sql$,
  'GitHub identity is unique'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    INSERT INTO viberacing_private.profiles (
      profile_id, github_user_id, handle, created_at, updated_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000003',
      900000000000000003,
      'Unsafe Handle',
      '2020-01-01T00:00:00.000Z',
      '2020-01-01T00:00:00.000Z'
    )
  $sql$,
  'public handles are normalized and bounded'
);

UPDATE viberacing_private.profiles
SET state = 'active'
WHERE profile_id = '00000000-0000-4000-8000-000000000001';

INSERT INTO viberacing_private.sessions (
  session_id,
  profile_id,
  verifier_digest,
  created_at,
  expires_at
)
VALUES (
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000001',
  pg_catalog.decode(pg_catalog.repeat('20', 32), 'hex'),
  '2020-01-01T00:00:00.000Z',
  '2020-01-01T01:00:00.000Z'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    INSERT INTO viberacing_private.sessions (
      session_id, profile_id, verifier_digest, state, created_at, expires_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000202',
      '00000000-0000-4000-8000-000000000001',
      pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex'),
      'revoked',
      '2020-01-01T00:00:00.000Z',
      '2020-01-01T01:00:00.000Z'
    )
  $sql$,
  'revoked sessions require a server timestamp'
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
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000001',
  pg_catalog.decode(pg_catalog.repeat('30', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('31', 64), 'hex'),
  'Primary passkey',
  '2020-01-01T00:00:00.000Z'
);

INSERT INTO viberacing_private.recovery_codes (
  recovery_code_id,
  profile_id,
  batch_id,
  position,
  verifier_phc,
  created_at
)
VALUES (
  '00000000-0000-4000-8000-000000000401',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000410',
  0,
  '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA',
  '2020-01-01T00:00:00.000Z'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    INSERT INTO viberacing_private.recovery_codes (
      recovery_code_id, profile_id, batch_id, position, verifier_phc, created_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000402',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000410',
      1,
      'plaintext-recovery-code',
      '2020-01-01T00:00:00.000Z'
    )
  $sql$,
  'recovery codes require an Argon2id PHC verifier'
);

INSERT INTO viberacing_private.auth_challenges (
  challenge_id,
  profile_id,
  session_id,
  purpose,
  challenge_digest,
  context_digest,
  created_at,
  expires_at
)
VALUES (
  '00000000-0000-4000-8000-000000000501',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  'source_unlink',
  pg_catalog.decode(pg_catalog.repeat('40', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
  '2020-01-01T00:00:00.000Z',
  '2020-01-01T00:05:00.000Z'
);

INSERT INTO viberacing_private.codex_sources (
  source_id,
  profile_id,
  created_at,
  state_changed_at
)
VALUES
  (
    'src_' || pg_catalog.repeat('A', 22),
    '00000000-0000-4000-8000-000000000001',
    '2020-01-01T00:00:00.000Z',
    '2020-01-01T00:00:00.000Z'
  ),
  (
    'src_' || pg_catalog.repeat('B', 22),
    '00000000-0000-4000-8000-000000000002',
    '2020-01-01T00:00:00.000Z',
    '2020-01-01T00:00:00.000Z'
  );

UPDATE viberacing_private.codex_sources
SET state = 'unlinked'
WHERE source_id = 'src_' || pg_catalog.repeat('B', 22);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    UPDATE viberacing_private.codex_sources
    SET state = 'active'
    WHERE source_id = 'src_' || pg_catalog.repeat('B', 22)
  $sql$,
  'unlinked source state is terminal'
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
VALUES (
  '00000000-0000-4000-8000-000000000551',
  pg_catalog.decode(pg_catalog.repeat('50', 32), 'hex'),
  'Desktop connector',
  '1.0.0',
  'linux',
  'x86_64',
  '2020-01-01T00:00:00.000Z'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    UPDATE viberacing_private.device_keys
    SET public_key = pg_catalog.decode(pg_catalog.repeat('51', 32), 'hex')
    WHERE device_key_id = '00000000-0000-4000-8000-000000000551'
  $sql$,
  'pending device public key is immutable'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    UPDATE viberacing_private.device_keys
    SET connector_version = '1.0.1'
    WHERE device_key_id = '00000000-0000-4000-8000-000000000551'
  $sql$,
  'pending device metadata is immutable'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
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
    ) VALUES (
      '00000000-0000-4000-8000-000000000600',
      pg_catalog.decode(pg_catalog.repeat('5d', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('5e', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('5f', 32), 'hex'),
      '00000000-0000-4000-8000-000000000551',
      'Desktop connector',
      '1.0.1',
      'linux',
      'x86_64',
      '2020-01-01T00:00:00.000Z',
      '2020-01-01T00:05:00.000Z'
    )
  $sql$,
  'pairing display metadata must match the pending key record'
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
VALUES (
  '00000000-0000-4000-8000-000000000601',
  pg_catalog.decode(pg_catalog.repeat('60', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('61', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('62', 32), 'hex'),
  '00000000-0000-4000-8000-000000000551',
  'Desktop connector',
  '1.0.0',
  'linux',
  'x86_64',
  '2020-01-01T00:00:00.000Z',
  '2020-01-01T00:05:00.000Z'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    UPDATE viberacing_private.device_keys
    SET source_id = 'src_' || pg_catalog.repeat('B', 22)
    WHERE device_key_id = '00000000-0000-4000-8000-000000000551'
  $sql$,
  'pending device cannot be bound without atomic activation'
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
VALUES (
  '00000000-0000-4000-8000-000000000552',
  pg_catalog.decode(pg_catalog.repeat('52', 32), 'hex'),
  'Second connector',
  '1.0.0',
  'linux',
  'x86_64',
  '2020-01-01T00:00:00.000Z'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
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
      created_at,
      expires_at,
      approved_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000602',
      pg_catalog.decode(pg_catalog.repeat('64', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('65', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('66', 32), 'hex'),
      '00000000-0000-4000-8000-000000000552',
      'Second connector',
      '1.0.0',
      'linux',
      'x86_64',
      'approved',
      '00000000-0000-4000-8000-000000000002',
      'existing',
      'src_' || pg_catalog.repeat('A', 22),
      '2020-01-01T00:00:00.000Z',
      '2020-01-01T00:05:00.000Z',
      '2020-01-01T00:01:00.000Z'
    )
  $sql$,
  'pairing source must belong to the approving profile'
);

UPDATE viberacing_private.pairing_transactions
SET
  state = 'approved',
  approved_profile_id = '00000000-0000-4000-8000-000000000001',
  source_choice = 'existing',
  approved_source_id = 'src_' || pg_catalog.repeat('A', 22),
  approved_at = '2020-01-01T00:01:00.000Z'
WHERE pairing_id = '00000000-0000-4000-8000-000000000601';

SELECT pg_temp.expect_integrity_failure(
  $sql$
    UPDATE viberacing_private.pairing_transactions
    SET
      state = 'activated',
      activated_device_id = 'dev_' || pg_catalog.repeat('C', 22),
      activated_at = '2020-01-01T00:02:00.000Z'
    WHERE pairing_id = '00000000-0000-4000-8000-000000000601'
  $sql$,
  'pairing cannot activate before the exact pending key is source-bound'
);

UPDATE viberacing_private.device_keys
SET
  state = 'active',
  source_id = 'src_' || pg_catalog.repeat('A', 22),
  device_id = 'dev_' || pg_catalog.repeat('C', 22),
  activated_at = '2020-01-01T00:02:00.000Z'
WHERE device_key_id = '00000000-0000-4000-8000-000000000551';

UPDATE viberacing_private.pairing_transactions
SET
  state = 'activated',
  activated_device_id = 'dev_' || pg_catalog.repeat('C', 22),
  activated_at = '2020-01-01T00:02:00.000Z'
WHERE pairing_id = '00000000-0000-4000-8000-000000000601';

INSERT INTO viberacing_private.deletion_jobs (
  deletion_job_id,
  profile_id,
  profile_ref_digest,
  requested_at,
  available_at
)
VALUES (
  '00000000-0000-4000-8000-000000000701',
  '00000000-0000-4000-8000-000000000002',
  pg_catalog.decode(pg_catalog.repeat('70', 32), 'hex'),
  '2020-01-01T00:00:00.000Z',
  '2020-01-01T00:00:00.000Z'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    UPDATE viberacing_private.deletion_jobs
    SET state = 'running'
    WHERE deletion_job_id = '00000000-0000-4000-8000-000000000701'
  $sql$,
  'running deletion job requires a complete lease'
);

INSERT INTO viberacing_private.deletion_tombstones (
  tombstone_id,
  profile_ref_digest,
  identity_ref_digest,
  digest_key_version,
  created_at,
  expires_at
)
VALUES (
  '00000000-0000-4000-8000-000000000801',
  pg_catalog.decode(pg_catalog.repeat('80', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('81', 32), 'hex'),
  1,
  '2020-01-01T00:00:00.000Z',
  '2020-02-01T00:00:00.000Z'
);

UPDATE viberacing_private.profiles
SET
  state = 'deletion_pending',
  hidden_at = '2020-01-01T00:03:00.000Z',
  deletion_requested_at = '2020-01-01T00:03:00.000Z'
WHERE profile_id = '00000000-0000-4000-8000-000000000002';

SELECT pg_temp.expect_integrity_failure(
  $sql$
    UPDATE viberacing_private.profiles
    SET state = 'active', hidden_at = NULL, deletion_requested_at = NULL
    WHERE profile_id = '00000000-0000-4000-8000-000000000002'
  $sql$,
  'deletion-pending profile state is terminal'
);

SELECT pg_temp.assert_true(
  (
    SELECT state = 'activated'
      AND approved_source_id = 'src_' || pg_catalog.repeat('A', 22)
      AND activated_device_id = 'dev_' || pg_catalog.repeat('C', 22)
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '00000000-0000-4000-8000-000000000601'
  ),
  'valid pairing remains bound to one profile source and device'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    UPDATE viberacing_private.device_keys
    SET source_id = 'src_' || pg_catalog.repeat('B', 22)
    WHERE device_key_id = '00000000-0000-4000-8000-000000000551'
  $sql$,
  'active device keys cannot be rebound across sources'
);

DELETE FROM viberacing_private.pairing_transactions
WHERE pairing_id = '00000000-0000-4000-8000-000000000601';

SELECT pg_temp.expect_integrity_failure(
  $sql$
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
    ) VALUES (
      '00000000-0000-4000-8000-000000000603',
      pg_catalog.decode(pg_catalog.repeat('68', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('69', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('6a', 32), 'hex'),
      '00000000-0000-4000-8000-000000000551',
      'Desktop connector',
      '1.0.0',
      'linux',
      'x86_64',
      '2020-01-01T00:00:00.000Z',
      '2020-01-01T00:05:00.000Z'
    )
  $sql$,
  'an active device key cannot start another pairing'
);

ROLLBACK;
