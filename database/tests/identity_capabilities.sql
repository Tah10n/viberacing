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

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 62
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'viberacing_api'
      AND procedure.prokind = 'f'
  ),
  'the API surface contains only the reviewed identity, source, ingest, Jobs, and public functions'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.bool_and(
      owner_role.rolname = 'viberacing_owner'
      AND procedure.prosecdef
      AND procedure.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']::text[]
    )
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = procedure.proowner
    WHERE namespace.nspname = 'viberacing_api'
  ),
  'every API function is owner-defined and pins a closed search path'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 19
      AND pg_catalog.bool_and(
        procedure.proconfig @> ARRAY['lock_timeout=5s']::text[]
      )
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'viberacing_api'
      AND procedure.proname IN (
        'consume_origin_nonce',
        'admit_pairing_transport_request',
        'cleanup_expired_auth_state',
        'cleanup_expired_car_recipe_proposals',
        'cleanup_expired_invites',
        'cleanup_expired_ingest_state',
        'cleanup_expired_pairing_state',
        'cleanup_expired_sessions',
        'purge_profile_deletions',
        'propose_car_recipe',
        'propose_car_recipe_from_device',
        'read_car_proposal_device_material',
        'read_car_recipe_state',
        'approve_car_recipe',
        'reject_car_recipe',
        'read_pairing_for_approval_limited',
        'refresh_community_season',
        'finalize_community_season',
        'submit_community_sync'
      )
  ),
  'Ingest, Jobs, and CarRecipe functions have database-enforced lock-wait bounds'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(
        procedure.proconfig @> ARRAY['statement_timeout=10s']::text[]
      )
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'viberacing_api'
      AND procedure.proname = 'read_pairing_for_approval_limited'
  ),
  'pairing approval lookup has a database-enforced statement deadline'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 10
      AND pg_catalog.bool_and(
        procedure.proconfig @> ARRAY['statement_timeout=30s']::text[]
      )
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'viberacing_api'
      AND procedure.proname IN (
        'cleanup_expired_auth_state',
        'cleanup_expired_car_recipe_proposals',
        'cleanup_expired_invites',
        'cleanup_expired_ingest_state',
        'cleanup_expired_pairing_state',
        'cleanup_expired_sessions',
        'purge_profile_deletions',
        'submit_community_sync',
        'refresh_community_season',
        'finalize_community_season'
      )
  ),
  'bounded ingest and scoring mutations have database-enforced statement deadlines'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 8
      AND pg_catalog.bool_and(
        procedure.proconfig @> ARRAY['statement_timeout=5s']::text[]
      )
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'viberacing_api'
      AND procedure.proname IN (
        'consume_origin_nonce',
        'admit_pairing_transport_request',
        'propose_car_recipe',
        'propose_car_recipe_from_device',
        'read_car_proposal_device_material',
        'read_car_recipe_state',
        'approve_car_recipe',
        'reject_car_recipe'
      )
  ),
  'origin replay, pairing admission, and browser/device CarRecipe have database-enforced statement deadlines'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 3
      AND pg_catalog.bool_and(
        procedure.proconfig @> ARRAY['statement_timeout=5s']::text[]
      )
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'viberacing_api'
      AND procedure.proname IN (
        'list_public_community_race',
        'list_public_community_race_status',
        'list_public_community_scores'
      )
  ),
  'the bounded public score, race, and race-status projections have database-enforced statement deadlines'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
    ) AS privilege
    WHERE namespace.nspname = 'viberacing_api'
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute an API function'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.bool_and(
      pg_catalog.has_function_privilege('viberacing_admin', procedure.oid, 'EXECUTE')
      = (procedure.proname = 'issue_invite')
    )
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'viberacing_api'
  ),
  'admin can issue invites and cannot execute user identity flows'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.bool_and(
      pg_catalog.has_function_privilege('viberacing_web', procedure.oid, 'EXECUTE')
      = (
        procedure.proname NOT IN (
          'issue_invite',
          'consume_origin_nonce',
          'read_device_verification_material',
          'submit_community_sync',
          'cleanup_expired_auth_state',
          'cleanup_expired_car_recipe_proposals',
          'cleanup_expired_invites',
          'cleanup_expired_ingest_state',
          'cleanup_expired_pairing_state',
          'cleanup_expired_sessions',
          'purge_profile_deletions',
          'read_pairing_for_approval',
          'refresh_community_season',
          'finalize_community_season'
        )
      )
    )
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'viberacing_api'
  ),
  'web can execute only the reviewed identity and public Community projection flows'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.bool_and(
      pg_catalog.has_function_privilege('viberacing_ingest', procedure.oid, 'EXECUTE')
      = (
        procedure.proname IN (
          'consume_origin_nonce',
          'read_device_verification_material',
          'submit_community_sync'
        )
      )
    )
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'viberacing_api'
  )
  AND (
    SELECT pg_catalog.bool_and(
      pg_catalog.has_function_privilege('viberacing_jobs', procedure.oid, 'EXECUTE')
      = (
        procedure.proname IN (
          'cleanup_expired_auth_state',
          'cleanup_expired_car_recipe_proposals',
          'cleanup_expired_invites',
          'cleanup_expired_ingest_state',
          'cleanup_expired_pairing_state',
          'cleanup_expired_sessions',
          'purge_profile_deletions',
          'refresh_community_season',
          'finalize_community_season'
        )
      )
    )
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'viberacing_api'
  ),
  'ingest has only origin verification and sync while jobs have reviewed maintenance procedures'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS runtime_role
    CROSS JOIN pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE runtime_role.rolname IN (
      'viberacing_web',
      'viberacing_ingest',
      'viberacing_jobs',
      'viberacing_admin'
    )
      AND namespace.nspname = 'viberacing_private'
      AND pg_catalog.has_function_privilege(runtime_role.rolname, procedure.oid, 'EXECUTE')
  ),
  'runtime roles cannot execute private helpers or triggers'
);

SET LOCAL ROLE viberacing_admin;

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.issue_invite(
      '00000000-0000-4000-8000-000000009001',
      pg_catalog.decode(pg_catalog.repeat('90', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '91 days',
      '00000000-0000-4000-8000-000000009002',
      'req_' || pg_catalog.repeat('Z', 22),
      'BETA_ADMISSION'
    )
  $sql$,
  'invite lifetime is absolutely bounded'
);

SELECT viberacing_api.issue_invite(
  '00000000-0000-4000-8000-000000000001',
  pg_catalog.decode(pg_catalog.repeat('01', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '1 day',
  '00000000-0000-4000-8000-000000001001',
  'req_' || pg_catalog.repeat('A', 22),
  'BETA_ADMISSION'
);

SELECT viberacing_api.issue_invite(
  '00000000-0000-4000-8000-000000000002',
  pg_catalog.decode(pg_catalog.repeat('02', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '1 day',
  '00000000-0000-4000-8000-000000001002',
  'req_' || pg_catalog.repeat('B', 22),
  'BETA_ADMISSION'
);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.enroll_profile(
      '00000000-0000-4000-8000-000000000001',
      pg_catalog.decode(pg_catalog.repeat('ff', 32), 'hex'),
      '00000000-0000-4000-8000-000000009011',
      900000000000009011,
      'rollback-driver',
      'en',
      'neon-night',
      'system',
      true,
      '00000000-0000-4000-8000-000000009012',
      pg_catalog.decode(pg_catalog.repeat('91', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '1 hour',
      '00000000-0000-4000-8000-000000009013',
      'req_' || pg_catalog.repeat('Y', 22)
    )
  $sql$,
  'invalid invite possession rolls back profile and session creation'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.enroll_profile(
      '00000000-0000-4000-8000-000000000001',
      pg_catalog.decode(pg_catalog.repeat('01', 32), 'hex'),
      '00000000-0000-4000-8000-000000009014',
      900000000000009014,
      pg_catalog.repeat('x', 65),
      'en',
      'neon-night',
      'system',
      true,
      '00000000-0000-4000-8000-000000009015',
      pg_catalog.decode(pg_catalog.repeat('92', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '1 hour',
      '00000000-0000-4000-8000-000000009016',
      'req_' || pg_catalog.repeat('X', 22)
    )
  $sql$,
  'oversized public input fails with the closed operation error'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM viberacing_private.profiles
    WHERE profile_id = '00000000-0000-4000-8000-000000009011'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.sessions
    WHERE session_id = '00000000-0000-4000-8000-000000009012'
  ),
  'failed enrollment leaves no partial identity state'
);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT viberacing_api.enroll_profile(
  '00000000-0000-4000-8000-000000000001',
  pg_catalog.decode(pg_catalog.repeat('01', 32), 'hex'),
  '00000000-0000-4000-8000-000000000101',
  900000000000000101,
  'alpha-driver',
  'en',
  'neon-night',
  'system',
  true,
  '00000000-0000-4000-8000-000000000201',
  pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '1 hour',
  '00000000-0000-4000-8000-000000001101',
  'req_' || pg_catalog.repeat('C', 22)
);

SELECT viberacing_api.enroll_profile(
  '00000000-0000-4000-8000-000000000002',
  pg_catalog.decode(pg_catalog.repeat('02', 32), 'hex'),
  '00000000-0000-4000-8000-000000000102',
  900000000000000102,
  'beta-racer',
  'ru',
  'classic-grand-prix',
  'off',
  false,
  '00000000-0000-4000-8000-000000000202',
  pg_catalog.decode(pg_catalog.repeat('22', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '1 hour',
  '00000000-0000-4000-8000-000000001102',
  'req_' || pg_catalog.repeat('D', 22)
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.create_auth_challenge(
      '00000000-0000-4000-8000-000000000201',
      pg_catalog.decode(pg_catalog.repeat('ff', 32), 'hex'),
      '00000000-0000-4000-8000-000000009021',
      'passkey_registration',
      pg_catalog.decode(pg_catalog.repeat('92', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('93', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '5 minutes'
    )
  $sql$,
  'a challenge requires possession of the exact active session verifier'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.create_auth_challenge(
      '00000000-0000-4000-8000-000000000201',
      pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex'),
      '00000000-0000-4000-8000-000000009022',
      'passkey_registration',
      pg_catalog.decode(pg_catalog.repeat('94', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('95', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '16 minutes'
    )
  $sql$,
  'challenge lifetime is absolutely bounded'
);

SELECT viberacing_api.create_auth_challenge(
  '00000000-0000-4000-8000-000000000201',
  pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex'),
  '00000000-0000-4000-8000-000000000301',
  'passkey_registration',
  pg_catalog.decode(pg_catalog.repeat('31', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('32', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '5 minutes'
);

SELECT viberacing_api.create_auth_challenge(
  '00000000-0000-4000-8000-000000000202',
  pg_catalog.decode(pg_catalog.repeat('22', 32), 'hex'),
  '00000000-0000-4000-8000-000000000302',
  'passkey_registration',
  pg_catalog.decode(pg_catalog.repeat('33', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('34', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '5 minutes'
);

SELECT pg_temp.assert_true(
  NOT viberacing_api.consume_auth_challenge(
    '00000000-0000-4000-8000-000000000201',
    pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex'),
    '00000000-0000-4000-8000-000000000302',
    'passkey_registration',
    pg_catalog.decode(pg_catalog.repeat('33', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('34', 32), 'hex')
  ),
  'one profile session cannot consume another profile challenge'
);

SELECT pg_temp.assert_true(
  viberacing_api.consume_auth_challenge(
    '00000000-0000-4000-8000-000000000201',
    pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex'),
    '00000000-0000-4000-8000-000000000301',
    'passkey_registration',
    pg_catalog.decode(pg_catalog.repeat('31', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('32', 32), 'hex')
  ),
  'the exact session can consume its bound challenge once'
);

SELECT pg_temp.assert_true(
  NOT viberacing_api.consume_auth_challenge(
    '00000000-0000-4000-8000-000000000201',
    pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex'),
    '00000000-0000-4000-8000-000000000301',
    'passkey_registration',
    pg_catalog.decode(pg_catalog.repeat('31', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('32', 32), 'hex')
  ),
  'consumed challenge replay is rejected'
);

SELECT viberacing_api.register_initial_passkey(
  '00000000-0000-4000-8000-000000000201',
  pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex'),
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000401',
  pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('42', 64), 'hex'),
  'Primary passkey',
  0,
  true,
  false,
  '00000000-0000-4000-8000-000000001201',
  'req_' || pg_catalog.repeat('E', 22)
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.register_initial_passkey(
      '00000000-0000-4000-8000-000000000201',
      pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex'),
      '00000000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000009031',
      pg_catalog.decode(pg_catalog.repeat('96', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('97', 64), 'hex'),
      'Replay passkey',
      0,
      false,
      false,
      '00000000-0000-4000-8000-000000009032',
      'req_' || pg_catalog.repeat('W', 22)
    )
  $sql$,
  'initial passkey activation cannot be replayed'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.rotate_session(
      '00000000-0000-4000-8000-000000000201',
      pg_catalog.decode(pg_catalog.repeat('ff', 32), 'hex'),
      '00000000-0000-4000-8000-000000009041',
      pg_catalog.decode(pg_catalog.repeat('98', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '1 hour',
      '00000000-0000-4000-8000-000000009042',
      'req_' || pg_catalog.repeat('V', 22)
    )
  $sql$,
  'session rotation requires the old verifier'
);

SELECT pg_temp.assert_true(
  viberacing_api.rotate_session(
    '00000000-0000-4000-8000-000000000201',
    pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex'),
    '00000000-0000-4000-8000-000000000203',
    pg_catalog.decode(pg_catalog.repeat('23', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour',
    '00000000-0000-4000-8000-000000001301',
    'req_' || pg_catalog.repeat('F', 22)
  ) = '00000000-0000-4000-8000-000000000101',
  'session rotation returns only its authenticated profile binding'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.create_auth_challenge(
      '00000000-0000-4000-8000-000000000201',
      pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex'),
      '00000000-0000-4000-8000-000000009051',
      'profile_deletion',
      pg_catalog.decode(pg_catalog.repeat('99', 32), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('9a', 32), 'hex'),
      pg_catalog.statement_timestamp() + INTERVAL '5 minutes'
    )
  $sql$,
  'a rotated session cannot authorize a new action'
);

SELECT pg_temp.assert_true(
  NOT viberacing_api.revoke_session(
    '00000000-0000-4000-8000-000000000202',
    pg_catalog.decode(pg_catalog.repeat('ff', 32), 'hex'),
    '00000000-0000-4000-8000-000000009061',
    'req_' || pg_catalog.repeat('U', 22)
  ),
  'logout with a wrong verifier reveals no session state'
);

SELECT pg_temp.assert_true(
  viberacing_api.revoke_session(
    '00000000-0000-4000-8000-000000000202',
    pg_catalog.decode(pg_catalog.repeat('22', 32), 'hex'),
    '00000000-0000-4000-8000-000000001401',
    'req_' || pg_catalog.repeat('G', 22)
  ),
  'logout revokes the exact possessed session'
);

SELECT pg_temp.assert_true(
  NOT viberacing_api.revoke_session(
    '00000000-0000-4000-8000-000000000202',
    pg_catalog.decode(pg_catalog.repeat('22', 32), 'hex'),
    '00000000-0000-4000-8000-000000009062',
    'req_' || pg_catalog.repeat('T', 22)
  ),
  'logout replay is an idempotent non-success'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.seasons (
  season_start,
  season_end,
  score_version,
  grace_ends_at
)
VALUES (
  pg_catalog.current_setting('viberacing.test_week_start')::date,
  pg_catalog.current_setting('viberacing.test_week_start')::date + 6,
  'community_v1',
  viberacing_private.community_season_grace_ends_at(
    pg_catalog.current_setting('viberacing.test_week_start')::date
  )
);

INSERT INTO viberacing_private.season_entries (
  season_start,
  profile_id,
  weekly_score,
  active_days,
  contributing_source_count,
  rank_position,
  display_order,
  computed_at
)
VALUES (
  pg_catalog.current_setting('viberacing.test_week_start')::date,
  '00000000-0000-4000-8000-000000000101',
  2800,
  7,
  2,
  1,
  1,
  pg_catalog.statement_timestamp()
);

INSERT INTO viberacing_private.season_daily_scores (
  season_start,
  profile_id,
  score_date,
  daily_score
)
SELECT
  pg_catalog.current_setting('viberacing.test_week_start')::date,
  '00000000-0000-4000-8000-000000000101',
  pg_catalog.current_setting('viberacing.test_week_start')::date + day_offset,
  ((day_offset + 1) * 100)::smallint
FROM pg_catalog.generate_series(0, 6) AS generated_day(day_offset);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT pg_temp.assert_true(
  (
    SELECT visibility = 'public'
    FROM viberacing_api.read_profile_visibility(
      '00000000-0000-4000-8000-000000000203',
      pg_catalog.decode(pg_catalog.repeat('23', 32), 'hex')
    )
  ),
  'an exact active session reads only its public visibility state'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 7
      AND pg_catalog.min(score_date) = pg_catalog.min(season_start)
      AND pg_catalog.max(score_date) = pg_catalog.max(season_end)
      AND pg_catalog.sum(daily_score) = 2800
      AND pg_catalog.bool_and(
        weekly_score = 2800
        AND active_days = 7
        AND source_count = 2
        AND NOT season_finalized
      )
    FROM viberacing_api.read_profile_score(
      '00000000-0000-4000-8000-000000000203',
      pg_catalog.decode(pg_catalog.repeat('23', 32), 'hex'),
      pg_catalog.current_setting('viberacing.test_week_start')::date
    )
  ),
  'an exact active session reads seven derived daily scores without private values'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT *
    FROM viberacing_api.read_profile_score(
      '00000000-0000-4000-8000-000000000203',
      pg_catalog.decode(pg_catalog.repeat('99', 32), 'hex'),
      pg_catalog.current_setting('viberacing.test_week_start')::date
    )
  $sql$,
  'the private score read requires the exact session verifier'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT *
    FROM viberacing_api.read_profile_score(
      '00000000-0000-4000-8000-000000000203',
      pg_catalog.decode(pg_catalog.repeat('23', 32), 'hex'),
      pg_catalog.current_setting('viberacing.test_week_start')::date + 1
    )
  $sql$,
  'the private score read accepts only a canonical Monday'
);

SELECT pg_temp.assert_true(
  viberacing_api.set_profile_visibility(
    '00000000-0000-4000-8000-000000000203',
    pg_catalog.decode(pg_catalog.repeat('23', 32), 'hex'),
    false
  ) = 'hidden',
  'an exact active session hides its profile'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 0
    FROM viberacing_api.read_profile_score(
      '00000000-0000-4000-8000-000000000203',
      pg_catalog.decode(pg_catalog.repeat('23', 32), 'hex'),
      pg_catalog.current_setting('viberacing.test_week_start')::date
    )
  ),
  'a hidden profile retains its session but exposes no materialized account score'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT state = 'hidden' AND hidden_at IS NOT NULL
    FROM viberacing_private.profiles
    WHERE profile_id = '00000000-0000-4000-8000-000000000101'
  ),
  'hide is immediate and records its lifecycle timestamp'
);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT pg_temp.assert_true(
  viberacing_api.set_profile_visibility(
    '00000000-0000-4000-8000-000000000203',
    pg_catalog.decode(pg_catalog.repeat('23', 32), 'hex'),
    false
  ) = 'hidden',
  'repeating the current visibility is idempotent'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.set_profile_visibility(
      '00000000-0000-4000-8000-000000000203',
      pg_catalog.decode(pg_catalog.repeat('99', 32), 'hex'),
      true
    )
  $sql$,
  'visibility changes require the exact session verifier'
);

SELECT pg_temp.assert_true(
  viberacing_api.set_profile_visibility(
    '00000000-0000-4000-8000-000000000203',
    pg_catalog.decode(pg_catalog.repeat('23', 32), 'hex'),
    true
  ) = 'public',
  'an exact hidden session republishes its profile'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 7
    FROM viberacing_api.read_profile_score(
      '00000000-0000-4000-8000-000000000203',
      pg_catalog.decode(pg_catalog.repeat('23', 32), 'hex'),
      pg_catalog.current_setting('viberacing.test_week_start')::date
    )
  ),
  'publishing restores the existing current-week account score read'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT state = 'active' AND hidden_at IS NULL
    FROM viberacing_private.profiles
    WHERE profile_id = '00000000-0000-4000-8000-000000000101'
  ),
  'publishing restores active state and clears the hide timestamp'
);

INSERT INTO viberacing_private.recovery_codes (
  recovery_code_id,
  profile_id,
  batch_id,
  position,
  verifier_phc
)
VALUES (
  '00000000-0000-4000-8000-000000000501',
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000510',
  0,
  '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA'
);

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES (
  'src_' || pg_catalog.repeat('D', 22),
  '00000000-0000-4000-8000-000000000101'
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
  '00000000-0000-4000-8000-000000000601',
  'dev_' || pg_catalog.repeat('E', 22),
  'src_' || pg_catalog.repeat('D', 22),
  pg_catalog.decode(pg_catalog.repeat('61', 32), 'hex'),
  'Active synthetic connector',
  '1.0.0',
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
VALUES (
  '00000000-0000-4000-8000-000000000602',
  pg_catalog.decode(pg_catalog.repeat('62', 32), 'hex'),
  'Pending synthetic connector',
  '1.0.0',
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
  '00000000-0000-4000-8000-000000000701',
  pg_catalog.decode(pg_catalog.repeat('71', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('72', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('73', 32), 'hex'),
  '00000000-0000-4000-8000-000000000602',
  'Pending synthetic connector',
  '1.0.0',
  'linux',
  'x86_64',
  pg_catalog.statement_timestamp() + INTERVAL '5 minutes'
);

UPDATE viberacing_private.pairing_transactions
SET
  state = 'approved',
  approved_profile_id = '00000000-0000-4000-8000-000000000101',
  source_choice = 'existing',
  approved_source_id = 'src_' || pg_catalog.repeat('D', 22),
  approved_by_session_id = '00000000-0000-4000-8000-000000000203',
  approved_by_passkey_id = '00000000-0000-4000-8000-000000000401',
  approved_at = pg_catalog.statement_timestamp()
WHERE pairing_id = '00000000-0000-4000-8000-000000000701';

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT viberacing_api.create_auth_challenge(
  '00000000-0000-4000-8000-000000000203',
  pg_catalog.decode(pg_catalog.repeat('23', 32), 'hex'),
  '00000000-0000-4000-8000-000000000303',
  'profile_deletion',
  pg_catalog.decode(pg_catalog.repeat('35', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('36', 32), 'hex'),
  pg_catalog.statement_timestamp() + INTERVAL '5 minutes'
);

SELECT pg_temp.assert_true(
  viberacing_api.consume_passkey_challenge(
    '00000000-0000-4000-8000-000000000203',
    pg_catalog.decode(pg_catalog.repeat('23', 32), 'hex'),
    '00000000-0000-4000-8000-000000000303',
    'profile_deletion',
    pg_catalog.decode(pg_catalog.repeat('35', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('36', 32), 'hex'),
    '00000000-0000-4000-8000-000000000401',
    0,
    false
  ),
  'fresh deletion step-up is consumed'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.request_profile_deletion(
      '00000000-0000-4000-8000-000000000203',
      pg_catalog.decode(pg_catalog.repeat('23', 32), 'hex'),
      'beta-racer',
      '00000000-0000-4000-8000-000000000303',
      '00000000-0000-4000-8000-000000000801',
      pg_catalog.decode(pg_catalog.repeat('81', 32), 'hex'),
      '00000000-0000-4000-8000-000000001501',
      'req_' || pg_catalog.repeat('H', 22)
    )
  $sql$,
  'typed handle cannot redirect deletion to another profile'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT state = 'active'
    FROM viberacing_private.profiles
    WHERE profile_id = '00000000-0000-4000-8000-000000000101'
  )
  AND (
    SELECT authorized_action_used_at IS NULL
    FROM viberacing_private.auth_challenges
    WHERE challenge_id = '00000000-0000-4000-8000-000000000303'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.deletion_jobs
    WHERE deletion_job_id = '00000000-0000-4000-8000-000000000801'
  ),
  'failed deletion rolls back the authorization claim and every mutation'
);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT viberacing_api.request_profile_deletion(
  '00000000-0000-4000-8000-000000000203',
  pg_catalog.decode(pg_catalog.repeat('23', 32), 'hex'),
  'alpha-driver',
  '00000000-0000-4000-8000-000000000303',
  '00000000-0000-4000-8000-000000000801',
  pg_catalog.decode(pg_catalog.repeat('81', 32), 'hex'),
  '00000000-0000-4000-8000-000000001501',
  'req_' || pg_catalog.repeat('H', 22)
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.request_profile_deletion(
      '00000000-0000-4000-8000-000000000203',
      pg_catalog.decode(pg_catalog.repeat('23', 32), 'hex'),
      'alpha-driver',
      '00000000-0000-4000-8000-000000000303',
      '00000000-0000-4000-8000-000000009071',
      pg_catalog.decode(pg_catalog.repeat('9b', 32), 'hex'),
      '00000000-0000-4000-8000-000000009072',
      'req_' || pg_catalog.repeat('S', 22)
    )
  $sql$,
  'revoked deletion session cannot replay the operation'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT state = 'deletion_pending'
      AND hidden_at IS NOT NULL
      AND deletion_requested_at IS NOT NULL
    FROM viberacing_private.profiles
    WHERE profile_id = '00000000-0000-4000-8000-000000000101'
  ),
  'deletion hides the profile synchronously'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM viberacing_private.sessions
    WHERE profile_id = '00000000-0000-4000-8000-000000000101'
      AND state = 'active'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.passkeys
    WHERE profile_id = '00000000-0000-4000-8000-000000000101'
      AND state = 'active'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.recovery_codes
    WHERE profile_id = '00000000-0000-4000-8000-000000000101'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.auth_challenges
    WHERE profile_id = '00000000-0000-4000-8000-000000000101'
  ),
  'deletion removes active browser and recovery authority'
);

SELECT pg_temp.assert_true(
  (
    SELECT state = 'revoked' AND revoked_at IS NOT NULL
    FROM viberacing_private.device_keys
    WHERE device_key_id = '00000000-0000-4000-8000-000000000601'
  )
  AND (
    SELECT state = 'unlinked'
    FROM viberacing_private.codex_sources
    WHERE source_id = 'src_' || pg_catalog.repeat('D', 22)
  )
  AND (
    SELECT state = 'cancelled'
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '00000000-0000-4000-8000-000000000701'
  ),
  'deletion revokes device authority and cancels approved activation'
);

SELECT pg_temp.assert_true(
  (
    SELECT state = 'queued'
      AND profile_id = '00000000-0000-4000-8000-000000000101'
      AND pg_catalog.octet_length(profile_ref_digest) = 32
    FROM viberacing_private.deletion_jobs
    WHERE deletion_job_id = '00000000-0000-4000-8000-000000000801'
  ),
  'deletion queues one opaque purge reference'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 8
    FROM viberacing_private.audit_events
  ),
  'successful security-sensitive state changes have bounded audit events'
);

DELETE FROM viberacing_private.profiles
WHERE profile_id = '00000000-0000-4000-8000-000000000102';

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 2
      AND pg_catalog.bool_and(profile_id IS NULL)
    FROM viberacing_private.audit_events
    WHERE audit_event_id IN (
      '00000000-0000-4000-8000-000000001102',
      '00000000-0000-4000-8000-000000001401'
    )
  ),
  'profile purge redacts audit linkage without blocking deletion'
);

RESET ROLE;
SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT purged_profiles = 1
    FROM viberacing_api.purge_profile_deletions(10)
  ),
  'the Jobs purge consumes the exact queued deletion request'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM viberacing_private.profiles
    WHERE profile_id = '00000000-0000-4000-8000-000000000101'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.invites
    WHERE invite_id = '00000000-0000-4000-8000-000000000001'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.sessions
    WHERE profile_id = '00000000-0000-4000-8000-000000000101'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.passkeys
    WHERE profile_id = '00000000-0000-4000-8000-000000000101'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.codex_sources
    WHERE source_id = 'src_' || pg_catalog.repeat('D', 22)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.device_keys
    WHERE device_key_id IN (
      '00000000-0000-4000-8000-000000000601',
      '00000000-0000-4000-8000-000000000602'
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '00000000-0000-4000-8000-000000000701'
  ),
  'primary identity, session, passkey, source, device, invite, and pairing rows are removed'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM viberacing_private.season_entries
    WHERE profile_id = '00000000-0000-4000-8000-000000000101'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.season_daily_scores
    WHERE profile_id = '00000000-0000-4000-8000-000000000101'
  ),
  'profile purge removes open Community score projections'
);

SELECT pg_temp.assert_true(
  (
    SELECT state = 'purged'
      AND profile_id IS NULL
      AND completed_at IS NOT NULL
      AND lease_token_digest IS NULL
      AND lease_expires_at IS NULL
      AND last_error_code IS NULL
    FROM viberacing_private.deletion_jobs
    WHERE deletion_job_id = '00000000-0000-4000-8000-000000000801'
  )
  AND (
    SELECT profile_id IS NULL
    FROM viberacing_private.audit_events
    WHERE audit_event_id = '00000000-0000-4000-8000-000000001501'
      AND event_type = 'deletion.requested'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.deletion_tombstones
    WHERE profile_ref_digest = pg_catalog.decode(pg_catalog.repeat('81', 32), 'hex')
  ),
  'the terminal opaque job and redacted audit remain without inventing a tombstone policy'
);

ROLLBACK;
