\set ON_ERROR_STOP on

-- cspell:ignore confrelid conrelid contype indexrelid relname indpred indnkeyatts

-- Deterministic synthetic evidence for abandoned-enrollment cleanup. The transaction is rolled
-- back and does not imply a scheduler, invite repair, notification, or deployed retention evidence.

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

CREATE FUNCTION pg_temp.expect_permission_failure(statement text, label text)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected permission failure: %', label;
END
$function$;

SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (
  profile_id,
  github_user_id,
  handle,
  state,
  created_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000038101',
    900000000000038101,
    'abandoned-oldest',
    'enrolling',
    pg_catalog.statement_timestamp() - INTERVAL '7 hours'
  ),
  (
    '00000000-0000-4000-8000-000000038102',
    900000000000038102,
    'abandoned-next',
    'enrolling',
    pg_catalog.statement_timestamp() - INTERVAL '6 hours'
  ),
  (
    '00000000-0000-4000-8000-000000038103',
    900000000000038103,
    'enrollment-live-session',
    'enrolling',
    pg_catalog.statement_timestamp() - INTERVAL '5 hours'
  ),
  (
    '00000000-0000-4000-8000-000000038104',
    900000000000038104,
    'enrollment-live-proof',
    'enrolling',
    pg_catalog.statement_timestamp() - INTERVAL '4 hours'
  ),
  (
    '00000000-0000-4000-8000-000000038105',
    900000000000038105,
    'activated-enrollment',
    'active',
    pg_catalog.statement_timestamp() - INTERVAL '3 hours'
  ),
  (
    '00000000-0000-4000-8000-000000038106',
    900000000000038106,
    'enrollment-key-drift',
    'enrolling',
    pg_catalog.statement_timestamp() - INTERVAL '2 hours'
  ),
  (
    '00000000-0000-4000-8000-000000038107',
    900000000000038107,
    'enrollment-invite-drift',
    'enrolling',
    pg_catalog.statement_timestamp() - INTERVAL '1 hour'
  ),
  (
    '00000000-0000-4000-8000-000000038108',
    900000000000038108,
    'enrollment-source-drift',
    'enrolling',
    pg_catalog.statement_timestamp() - INTERVAL '30 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000038109',
    900000000000038109,
    'enroll-challenge-drift',
    'enrolling',
    pg_catalog.statement_timestamp() - INTERVAL '29 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000038110',
    900000000000038110,
    'enroll-recovery-code',
    'enrolling',
    pg_catalog.statement_timestamp() - INTERVAL '28 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000038111',
    900000000000038111,
    'enroll-recovery-auth',
    'enrolling',
    pg_catalog.statement_timestamp() - INTERVAL '27 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000038112',
    900000000000038112,
    'enroll-deletion-drift',
    'enrolling',
    pg_catalog.statement_timestamp() - INTERVAL '26 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000038113',
    900000000000038113,
    'enrollment-score-drift',
    'enrolling',
    pg_catalog.statement_timestamp() - INTERVAL '25 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000038114',
    900000000000038114,
    'enroll-active-recipe',
    'enrolling',
    pg_catalog.statement_timestamp() - INTERVAL '24 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000038115',
    900000000000038115,
    'enroll-proposal-drift',
    'enrolling',
    pg_catalog.statement_timestamp() - INTERVAL '23 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000038116',
    900000000000038116,
    'enroll-freshness-drift',
    'enrolling',
    pg_catalog.statement_timestamp() - INTERVAL '22 minutes'
  );

INSERT INTO viberacing_private.invites (
  invite_id,
  verifier_digest,
  state,
  created_at,
  expires_at,
  redeemed_at,
  redeemed_profile_id
)
SELECT
  (
    '00000000-0000-4000-8000-' ||
    pg_catalog.lpad((38200 + fixture.ordinal)::text, 12, '0')
  )::uuid,
  pg_catalog.decode(pg_catalog.lpad((38200 + fixture.ordinal)::text, 64, '0'), 'hex'),
  'redeemed',
  pg_catalog.statement_timestamp() - INTERVAL '8 hours',
  pg_catalog.statement_timestamp() - INTERVAL '7 hours',
  pg_catalog.statement_timestamp() - INTERVAL '6 hours',
  fixture.profile_id
FROM (
  VALUES
    (1, '00000000-0000-4000-8000-000000038101'::uuid),
    (2, '00000000-0000-4000-8000-000000038102'::uuid),
    (3, '00000000-0000-4000-8000-000000038103'::uuid),
    (4, '00000000-0000-4000-8000-000000038104'::uuid),
    (5, '00000000-0000-4000-8000-000000038105'::uuid),
    (6, '00000000-0000-4000-8000-000000038106'::uuid),
    (8, '00000000-0000-4000-8000-000000038108'::uuid),
    (9, '00000000-0000-4000-8000-000000038109'::uuid),
    (10, '00000000-0000-4000-8000-000000038110'::uuid),
    (11, '00000000-0000-4000-8000-000000038111'::uuid),
    (12, '00000000-0000-4000-8000-000000038112'::uuid),
    (13, '00000000-0000-4000-8000-000000038113'::uuid),
    (14, '00000000-0000-4000-8000-000000038114'::uuid),
    (15, '00000000-0000-4000-8000-000000038115'::uuid),
    (16, '00000000-0000-4000-8000-000000038116'::uuid)
) AS fixture(ordinal, profile_id);

INSERT INTO viberacing_private.sessions (
  session_id,
  profile_id,
  verifier_digest,
  created_at,
  expires_at
)
SELECT
  (
    '00000000-0000-4000-8000-' ||
    pg_catalog.lpad((38300 + fixture.ordinal)::text, 12, '0')
  )::uuid,
  fixture.profile_id,
  pg_catalog.decode(pg_catalog.lpad((38300 + fixture.ordinal)::text, 64, '0'), 'hex'),
  pg_catalog.statement_timestamp() - INTERVAL '2 hours',
  CASE
    WHEN fixture.ordinal = 3 THEN pg_catalog.statement_timestamp() + INTERVAL '1 hour'
    ELSE pg_catalog.statement_timestamp() - INTERVAL '1 hour'
  END
FROM (
  VALUES
    (1, '00000000-0000-4000-8000-000000038101'::uuid),
    (2, '00000000-0000-4000-8000-000000038102'::uuid),
    (3, '00000000-0000-4000-8000-000000038103'::uuid),
    (4, '00000000-0000-4000-8000-000000038104'::uuid),
    (5, '00000000-0000-4000-8000-000000038105'::uuid),
    (6, '00000000-0000-4000-8000-000000038106'::uuid),
    (7, '00000000-0000-4000-8000-000000038107'::uuid),
    (8, '00000000-0000-4000-8000-000000038108'::uuid),
    (9, '00000000-0000-4000-8000-000000038109'::uuid),
    (10, '00000000-0000-4000-8000-000000038110'::uuid),
    (11, '00000000-0000-4000-8000-000000038111'::uuid),
    (12, '00000000-0000-4000-8000-000000038112'::uuid),
    (13, '00000000-0000-4000-8000-000000038113'::uuid),
    (14, '00000000-0000-4000-8000-000000038114'::uuid),
    (15, '00000000-0000-4000-8000-000000038115'::uuid),
    (16, '00000000-0000-4000-8000-000000038116'::uuid)
) AS fixture(ordinal, profile_id);

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
VALUES
  (
    '00000000-0000-4000-8000-000000038401',
    '00000000-0000-4000-8000-000000038101',
    '00000000-0000-4000-8000-000000038301',
    'passkey_registration',
    pg_catalog.decode(pg_catalog.lpad('38401', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('38501', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp() - INTERVAL '2 hours',
    pg_catalog.statement_timestamp() - INTERVAL '1 hour'
  ),
  (
    '00000000-0000-4000-8000-000000038404',
    '00000000-0000-4000-8000-000000038104',
    '00000000-0000-4000-8000-000000038304',
    'passkey_registration',
    pg_catalog.decode(pg_catalog.lpad('38404', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('38504', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp() + INTERVAL '5 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000038409',
    '00000000-0000-4000-8000-000000038109',
    '00000000-0000-4000-8000-000000038309',
    'recovery_change',
    pg_catalog.decode(pg_catalog.lpad('38409', 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad('38509', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp() - INTERVAL '2 hours',
    pg_catalog.statement_timestamp() - INTERVAL '1 hour'
  );

INSERT INTO viberacing_private.recovery_codes (
  recovery_code_id,
  profile_id,
  batch_id,
  position,
  verifier_phc,
  created_at,
  used_at
)
VALUES (
  '00000000-0000-4000-8000-000000038510',
  '00000000-0000-4000-8000-000000038110',
  '00000000-0000-4000-8000-000000038610',
  0,
  NULL,
  pg_catalog.statement_timestamp() - INTERVAL '2 hours',
  pg_catalog.statement_timestamp() - INTERVAL '1 hour'
);

INSERT INTO viberacing_private.recovery_authorities (
  recovery_authority_id,
  profile_id,
  source_recovery_code_id,
  verifier_digest,
  challenge_digest,
  context_digest,
  state,
  created_at,
  expires_at,
  revoked_at
)
VALUES (
  '00000000-0000-4000-8000-000000038511',
  '00000000-0000-4000-8000-000000038111',
  '00000000-0000-4000-8000-000000038611',
  pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('b1', 32), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('c1', 32), 'hex'),
  'revoked',
  pg_catalog.statement_timestamp() - INTERVAL '2 hours',
  pg_catalog.statement_timestamp() - INTERVAL '115 minutes',
  pg_catalog.statement_timestamp() - INTERVAL '119 minutes'
);

INSERT INTO viberacing_private.deletion_jobs (
  deletion_job_id,
  profile_id,
  profile_ref_digest
)
VALUES (
  '00000000-0000-4000-8000-000000038512',
  '00000000-0000-4000-8000-000000038112',
  pg_catalog.decode(pg_catalog.repeat('d2', 32), 'hex')
);

INSERT INTO viberacing_private.seasons (
  season_start,
  season_end,
  score_version,
  grace_ends_at
)
VALUES (
  DATE '2099-12-28',
  DATE '2100-01-03',
  'community_v1',
  viberacing_private.community_season_grace_ends_at(DATE '2099-12-28')
);

INSERT INTO viberacing_private.seasons (
  season_start,
  season_end,
  score_version,
  created_at,
  refreshed_at,
  state,
  grace_ends_at,
  finalized_at
)
VALUES (
  DATE '2001-01-01',
  DATE '2001-01-07',
  'community_v1',
  TIMESTAMPTZ '2001-01-01 00:00:00+00',
  TIMESTAMPTZ '2001-01-09 00:00:00+00',
  'finalized',
  viberacing_private.community_season_grace_ends_at(DATE '2001-01-01'),
  TIMESTAMPTZ '2001-01-10 00:00:00+00'
);

INSERT INTO viberacing_private.finalized_season_profile_freshness (
  season_start,
  profile_id,
  last_accepted_date,
  retained_source_count,
  source_day_value_count
)
VALUES (
  DATE '2001-01-01',
  '00000000-0000-4000-8000-000000038116',
  DATE '2001-01-09',
  1,
  1
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
  DATE '2099-12-28',
  '00000000-0000-4000-8000-000000038113',
  1,
  1,
  1,
  1,
  1,
  pg_catalog.statement_timestamp()
);

INSERT INTO viberacing_private.profile_car_recipes (
  profile_id,
  schema_version,
  chassis,
  nose,
  cockpit,
  wing,
  wheels,
  palette,
  trail,
  seed
)
VALUES (
  '00000000-0000-4000-8000-000000038114',
  1,
  'formula',
  'classic',
  'canopy',
  'high',
  'slick',
  'turbo-blue',
  'grid',
  38114
);

INSERT INTO viberacing_private.car_recipe_proposals (
  proposal_id,
  profile_id,
  schema_version,
  chassis,
  nose,
  cockpit,
  wing,
  wheels,
  palette,
  trail,
  seed,
  expires_at
)
VALUES (
  '00000000-0000-4000-8000-000000038515',
  '00000000-0000-4000-8000-000000038115',
  1,
  'rally',
  'scoop',
  'rally',
  'low',
  'all-terrain',
  'sunburst',
  'spark',
  38115,
  pg_catalog.statement_timestamp() + INTERVAL '1 hour'
);

INSERT INTO viberacing_private.passkeys (
  passkey_id,
  profile_id,
  credential_id,
  cose_public_key,
  label
)
VALUES (
  '00000000-0000-4000-8000-000000038506',
  '00000000-0000-4000-8000-000000038106',
  pg_catalog.decode(pg_catalog.repeat('86', 16), 'hex'),
  pg_catalog.decode(pg_catalog.repeat('96', 32), 'hex'),
  'Synthetic drift key'
);

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES (
  'src_' || pg_catalog.repeat('8', 22),
  '00000000-0000-4000-8000-000000038108'
);

INSERT INTO viberacing_private.audit_events (
  audit_event_id,
  event_type,
  actor_kind,
  profile_id,
  request_id
)
VALUES (
  '00000000-0000-4000-8000-000000038601',
  'profile.enrolled',
  'profile',
  '00000000-0000-4000-8000-000000038101',
  'req_' || pg_catalog.repeat('A', 22)
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(index_record.indpred IS NOT NULL)
      AND pg_catalog.bool_and(index_record.indnkeyatts = 2)
    FROM pg_catalog.pg_index AS index_record
    JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index_record.indexrelid
    WHERE index_relation.relname = 'profiles_enrolling_created_idx'
  ),
  'the abandoned-enrollment candidate index is partial and deterministically ordered'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.array_agg(profile_child.relname ORDER BY profile_child.relname) = ARRAY[
      'audit_events',
      'auth_challenges',
      'car_recipe_proposals',
      'codex_sources',
      'deletion_jobs',
      'finalized_season_profile_freshness',
      'invites',
      'passkeys',
      'profile_car_recipes',
      'recovery_authorities',
      'recovery_codes',
      'season_entries',
      'sessions'
    ]::text[]
    FROM (
      SELECT DISTINCT child_relation.relname::text AS relname
      FROM pg_catalog.pg_constraint AS foreign_key
      JOIN pg_catalog.pg_class AS child_relation ON child_relation.oid = foreign_key.conrelid
      WHERE foreign_key.contype = 'f'
        AND foreign_key.confrelid = 'viberacing_private.profiles'::regclass
    ) AS profile_child
  ),
  'the cleanup review inventories every direct profile foreign-key relation'
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT deleted_enrollments = 1
    FROM viberacing_api.cleanup_abandoned_enrollments(1)
  ),
  'the first batch removes only the oldest abandoned enrollment'
);

SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM viberacing_private.profiles
    WHERE profile_id = '00000000-0000-4000-8000-000000038101'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.profiles
    WHERE profile_id = '00000000-0000-4000-8000-000000038102'
  ),
  'the batch follows profile creation and identifier order'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM viberacing_private.invites
    WHERE redeemed_profile_id = '00000000-0000-4000-8000-000000038101'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.sessions
    WHERE profile_id = '00000000-0000-4000-8000-000000038101'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.auth_challenges
    WHERE profile_id = '00000000-0000-4000-8000-000000038101'
  ),
  'the profile cascade removes its redeemed invite and expired enrollment authority'
);

SELECT pg_temp.assert_true(
  (
    SELECT profile_id IS NULL
    FROM viberacing_private.audit_events
    WHERE audit_event_id = '00000000-0000-4000-8000-000000038601'
  ),
  'abandoned-enrollment cleanup retains the audit event with redacted profile linkage'
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT deleted_enrollments = 1
    FROM viberacing_api.cleanup_abandoned_enrollments(10)
  ),
  'the next batch removes the remaining canonical abandoned enrollment'
);
SELECT pg_temp.assert_true(
  (
    SELECT deleted_enrollments = 0
    FROM viberacing_api.cleanup_abandoned_enrollments(10)
  ),
  'abandoned-enrollment cleanup is idempotent after eligible rows are gone'
);

SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 14
    FROM viberacing_private.profiles
    WHERE profile_id IN (
      '00000000-0000-4000-8000-000000038103',
      '00000000-0000-4000-8000-000000038104',
      '00000000-0000-4000-8000-000000038105',
      '00000000-0000-4000-8000-000000038106',
      '00000000-0000-4000-8000-000000038107',
      '00000000-0000-4000-8000-000000038108',
      '00000000-0000-4000-8000-000000038109',
      '00000000-0000-4000-8000-000000038110',
      '00000000-0000-4000-8000-000000038111',
      '00000000-0000-4000-8000-000000038112',
      '00000000-0000-4000-8000-000000038113',
      '00000000-0000-4000-8000-000000038114',
      '00000000-0000-4000-8000-000000038115',
      '00000000-0000-4000-8000-000000038116'
    )
  ),
  'live, active, and every non-canonical profile-bound drift shape remain'
);

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM viberacing_private.invites
    WHERE redeemed_profile_id = '00000000-0000-4000-8000-000000038103'
      AND state = 'redeemed'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.auth_challenges
    WHERE profile_id = '00000000-0000-4000-8000-000000038104'
      AND expires_at > pg_catalog.statement_timestamp()
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.passkeys
    WHERE profile_id = '00000000-0000-4000-8000-000000038106'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.codex_sources
    WHERE profile_id = '00000000-0000-4000-8000-000000038108'
  ),
  'preserved profiles retain their exact invite, challenge, passkey, and source state'
);

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM viberacing_private.auth_challenges
    WHERE challenge_id = '00000000-0000-4000-8000-000000038409'
      AND purpose = 'recovery_change'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.recovery_codes
    WHERE recovery_code_id = '00000000-0000-4000-8000-000000038510'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.recovery_authorities
    WHERE recovery_authority_id = '00000000-0000-4000-8000-000000038511'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.deletion_jobs
    WHERE deletion_job_id = '00000000-0000-4000-8000-000000038512'
      AND profile_id = '00000000-0000-4000-8000-000000038112'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.season_entries
    WHERE season_start = DATE '2099-12-28'
      AND profile_id = '00000000-0000-4000-8000-000000038113'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.profile_car_recipes
    WHERE profile_id = '00000000-0000-4000-8000-000000038114'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.car_recipe_proposals
    WHERE proposal_id = '00000000-0000-4000-8000-000000038515'
      AND profile_id = '00000000-0000-4000-8000-000000038115'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.finalized_season_profile_freshness
    WHERE season_start = DATE '2001-01-01'
      AND profile_id = '00000000-0000-4000-8000-000000038116'
  ),
  'cleanup preserves every non-enrollment challenge, recovery, deletion, score, recipe, and freshness row'
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_abandoned_enrollments(NULL)$sql$,
  'a null abandoned-enrollment batch fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_abandoned_enrollments(0)$sql$,
  'a zero abandoned-enrollment batch fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_abandoned_enrollments(1001)$sql$,
  'an oversized abandoned-enrollment batch fails closed'
);

SET LOCAL ROLE viberacing_web;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_abandoned_enrollments(1)$sql$,
  'Web cannot run abandoned-enrollment cleanup'
);
SET LOCAL ROLE viberacing_ingest;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_abandoned_enrollments(1)$sql$,
  'Ingest cannot run abandoned-enrollment cleanup'
);
SET LOCAL ROLE viberacing_admin;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_abandoned_enrollments(1)$sql$,
  'Admin cannot run abandoned-enrollment cleanup'
);

SET LOCAL ROLE viberacing_owner;
DELETE FROM viberacing_private.maintenance_locks
WHERE capability = 'auth_retention_cleanup';
SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_abandoned_enrollments(1)$sql$,
  'a missing private authentication mutex fails abandoned-enrollment cleanup closed'
);

SET LOCAL ROLE viberacing_owner;
INSERT INTO viberacing_private.maintenance_locks (capability)
VALUES ('auth_retention_cleanup');
DELETE FROM viberacing_private.maintenance_locks
WHERE capability = 'profile_deletion_purge';
SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_abandoned_enrollments(1)$sql$,
  'a missing private profile-purge mutex fails abandoned-enrollment cleanup closed'
);

ROLLBACK;
