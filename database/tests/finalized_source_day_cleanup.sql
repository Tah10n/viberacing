\set ON_ERROR_STOP on

-- Deterministic finalized source-day retention evidence. The transaction is rolled back and does
-- not imply a scheduler, correction workflow, backup purge, production login, or deployment.

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

CREATE FUNCTION pg_temp.expect_integrity_failure(statement text, label text)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION
    WHEN integrity_constraint_violation OR numeric_value_out_of_range THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected integrity failure: %', label;
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
  streak_visible
)
VALUES
  (
    '00000000-0000-4000-8000-000000039101',
    900000000000039101,
    'retention-public',
    'active',
    true
  ),
  (
    '00000000-0000-4000-8000-000000039102',
    900000000000039102,
    'retention-recent',
    'active',
    false
  ),
  (
    '00000000-0000-4000-8000-000000039103',
    900000000000039103,
    'retention-open',
    'active',
    false
  ),
  (
    '00000000-0000-4000-8000-000000039104',
    900000000000039104,
    'retention-no-projection',
    'active',
    false
  ),
  (
    '00000000-0000-4000-8000-000000039105',
    900000000000039105,
    'retention-cascade',
    'active',
    false
  ),
  (
    '00000000-0000-4000-8000-000000039106',
    900000000000039106,
    'retention-drift',
    'active',
    false
  );

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES
  ('src_' || pg_catalog.repeat('A', 22), '00000000-0000-4000-8000-000000039101'),
  ('src_' || pg_catalog.repeat('B', 22), '00000000-0000-4000-8000-000000039101'),
  ('src_' || pg_catalog.repeat('C', 22), '00000000-0000-4000-8000-000000039102'),
  ('src_' || pg_catalog.repeat('D', 22), '00000000-0000-4000-8000-000000039103'),
  ('src_' || pg_catalog.repeat('E', 22), '00000000-0000-4000-8000-000000039104'),
  ('src_' || pg_catalog.repeat('F', 22), '00000000-0000-4000-8000-000000039105'),
  ('src_' || pg_catalog.repeat('G', 22), '00000000-0000-4000-8000-000000039106');

INSERT INTO viberacing_private.seasons (
  season_start,
  season_end,
  score_version,
  created_at,
  refreshed_at,
  grace_ends_at
)
VALUES
  (
    DATE '2002-01-07',
    DATE '2002-01-13',
    'community_v1',
    TIMESTAMPTZ '2002-01-07 00:00:00+00',
    TIMESTAMPTZ '2002-01-16 00:30:00+00',
    viberacing_private.community_season_grace_ends_at(DATE '2002-01-07')
  ),
  (
    DATE '2003-01-06',
    DATE '2003-01-12',
    'community_v1',
    TIMESTAMPTZ '2003-01-06 00:00:00+00',
    TIMESTAMPTZ '2003-01-15 00:30:00+00',
    viberacing_private.community_season_grace_ends_at(DATE '2003-01-06')
  ),
  (
    DATE '2004-01-05',
    DATE '2004-01-11',
    'community_v1',
    TIMESTAMPTZ '2004-01-05 00:00:00+00',
    TIMESTAMPTZ '2004-01-14 00:30:00+00',
    viberacing_private.community_season_grace_ends_at(DATE '2004-01-05')
  );

-- This terminal season intentionally bypasses the open-to-finalized transition and therefore has
-- no rounded projection. Cleanup must preserve its exact state conservatively.
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
  DATE '2005-01-03',
  DATE '2005-01-09',
  'community_v1',
  TIMESTAMPTZ '2005-01-03 00:00:00+00',
  TIMESTAMPTZ '2005-01-12 00:30:00+00',
  'finalized',
  viberacing_private.community_season_grace_ends_at(DATE '2005-01-03'),
  TIMESTAMPTZ '2005-01-12 01:00:00+00'
);

INSERT INTO viberacing_private.source_day_values (
  source_id,
  codex_reported_date,
  tokens,
  accepted_sync_id,
  accepted_device_id,
  first_accepted_at,
  last_accepted_at
)
VALUES
  (
    'src_' || pg_catalog.repeat('A', 22),
    DATE '2002-01-07',
    100,
    'syn_' || pg_catalog.repeat('A', 22),
    'dev_' || pg_catalog.repeat('A', 22),
    TIMESTAMPTZ '2002-01-09 08:00:00+00',
    TIMESTAMPTZ '2002-01-09 09:00:00+00'
  ),
  (
    'src_' || pg_catalog.repeat('A', 22),
    DATE '2002-01-08',
    200,
    'syn_' || pg_catalog.repeat('B', 22),
    'dev_' || pg_catalog.repeat('A', 22),
    TIMESTAMPTZ '2002-01-10 08:00:00+00',
    TIMESTAMPTZ '2002-01-10 09:00:00+00'
  ),
  (
    'src_' || pg_catalog.repeat('B', 22),
    DATE '2002-01-08',
    300,
    'syn_' || pg_catalog.repeat('C', 22),
    'dev_' || pg_catalog.repeat('B', 22),
    TIMESTAMPTZ '2002-01-11 08:00:00+00',
    TIMESTAMPTZ '2002-01-11 09:00:00+00'
  ),
  (
    'src_' || pg_catalog.repeat('C', 22),
    DATE '2003-01-06',
    100,
    'syn_' || pg_catalog.repeat('D', 22),
    'dev_' || pg_catalog.repeat('C', 22),
    TIMESTAMPTZ '2003-01-08 08:00:00+00',
    TIMESTAMPTZ '2003-01-08 09:00:00+00'
  ),
  (
    'src_' || pg_catalog.repeat('D', 22),
    DATE '2004-01-05',
    100,
    'syn_' || pg_catalog.repeat('E', 22),
    'dev_' || pg_catalog.repeat('D', 22),
    TIMESTAMPTZ '2004-01-07 08:00:00+00',
    TIMESTAMPTZ '2004-01-07 09:00:00+00'
  ),
  (
    'src_' || pg_catalog.repeat('E', 22),
    DATE '2005-01-03',
    100,
    'syn_' || pg_catalog.repeat('F', 22),
    'dev_' || pg_catalog.repeat('E', 22),
    TIMESTAMPTZ '2005-01-05 08:00:00+00',
    TIMESTAMPTZ '2005-01-05 09:00:00+00'
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
  DATE '2002-01-07',
  '00000000-0000-4000-8000-000000039101',
  500,
  2,
  2,
  1,
  1,
  TIMESTAMPTZ '2002-01-16 00:30:00+00'
);

INSERT INTO viberacing_private.season_daily_scores (
  season_start,
  profile_id,
  score_date,
  daily_score
)
VALUES
  (
    DATE '2002-01-07',
    '00000000-0000-4000-8000-000000039101',
    DATE '2002-01-07',
    200
  ),
  (
    DATE '2002-01-07',
    '00000000-0000-4000-8000-000000039101',
    DATE '2002-01-08',
    300
  );

UPDATE viberacing_private.seasons
SET state = 'finalized',
  finalized_at = CASE season_start
    WHEN DATE '2002-01-07' THEN TIMESTAMPTZ '2002-01-16 01:00:00+00'
    WHEN DATE '2003-01-06' THEN pg_catalog.statement_timestamp() - INTERVAL '29 days'
  END
WHERE season_start IN (
  DATE '2002-01-07',
  DATE '2003-01-06'
);

SELECT pg_temp.assert_true(
  (
    SELECT last_accepted_date = DATE '2002-01-11'
      AND retained_source_count = 2
      AND source_day_value_count = 3
      AND deleted_source_day_value_count = 0
      AND source_values_purged_at IS NULL
    FROM viberacing_private.finalized_season_profile_freshness
    WHERE season_start = DATE '2002-01-07'
      AND profile_id = '00000000-0000-4000-8000-000000039101'
  ),
  'finalization captures one rounded date and exact bounded source/value inventory'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM viberacing_private.finalized_season_profile_freshness
    WHERE season_start IN (DATE '2004-01-05', DATE '2005-01-03')
  ),
  'open and directly inserted terminal seasons receive no synthetic projection'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$INSERT INTO viberacing_private.finalized_season_profile_freshness (
    season_start,
    profile_id,
    last_accepted_date,
    retained_source_count,
    source_day_value_count
  ) VALUES (
    DATE '2005-01-03',
    '00000000-0000-4000-8000-000000039104',
    DATE '2005-01-05',
    33,
    33
  )$sql$,
  'the finalized projection rejects more than 32 retained sources'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$INSERT INTO viberacing_private.finalized_season_profile_freshness (
    season_start,
    profile_id,
    last_accepted_date,
    retained_source_count,
    source_day_value_count
  ) VALUES (
    DATE '2005-01-03',
    '00000000-0000-4000-8000-000000039104',
    DATE '2005-01-05',
    0,
    1
  )$sql$,
  'the finalized projection requires at least one retained source'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$INSERT INTO viberacing_private.finalized_season_profile_freshness (
    season_start,
    profile_id,
    last_accepted_date,
    retained_source_count,
    source_day_value_count
  ) VALUES (
    DATE '2005-01-03',
    '00000000-0000-4000-8000-000000039104',
    DATE '2005-01-05',
    1,
    0
  )$sql$,
  'the finalized projection cannot retain fewer values than sources'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$INSERT INTO viberacing_private.finalized_season_profile_freshness (
    season_start,
    profile_id,
    last_accepted_date,
    retained_source_count,
    source_day_value_count
  ) VALUES (
    DATE '2005-01-03',
    '00000000-0000-4000-8000-000000039104',
    DATE '2005-01-05',
    1,
    225
  )$sql$,
  'the finalized projection rejects more than 224 source-day values'
);

SELECT pg_temp.expect_operation_failure(
  $sql$INSERT INTO viberacing_private.finalized_season_profile_freshness (
    season_start,
    profile_id,
    last_accepted_date,
    retained_source_count,
    source_day_value_count
  ) VALUES (
    DATE '2004-01-05',
    '00000000-0000-4000-8000-000000039103',
    DATE '2004-01-07',
    1,
    1
  )$sql$,
  'an open season cannot receive a terminal freshness projection'
);

SELECT pg_temp.expect_operation_failure(
  $sql$UPDATE viberacing_private.finalized_season_profile_freshness
    SET last_accepted_date = DATE '2002-01-10'
    WHERE season_start = DATE '2002-01-07'
      AND profile_id = '00000000-0000-4000-8000-000000039101'$sql$,
  'the rounded finalized freshness value is immutable'
);

SELECT pg_temp.expect_operation_failure(
  $sql$UPDATE viberacing_private.finalized_season_profile_freshness
    SET deleted_source_day_value_count = 2
    WHERE season_start = DATE '2002-01-07'
      AND profile_id = '00000000-0000-4000-8000-000000039101'$sql$,
  'cleanup progress cannot skip a row'
);

SELECT pg_temp.expect_operation_failure(
  $sql$DELETE FROM viberacing_private.finalized_season_profile_freshness
    WHERE season_start = DATE '2002-01-07'
      AND profile_id = '00000000-0000-4000-8000-000000039101'$sql$,
  'an active profile cannot lose finalized freshness state'
);

SET LOCAL ROLE viberacing_web;

SELECT pg_temp.assert_true(
  (
    SELECT freshness_days = LEAST(
        65535,
        GREATEST(
          0,
          (pg_catalog.statement_timestamp() AT TIME ZONE 'UTC')::date - DATE '2002-01-11'
        )
      )
      AND weekly_score = 500
      AND source_count = 2
      AND streak_days = 0
    FROM viberacing_api.list_public_community_race_status(DATE '2002-01-07', 100)
    WHERE handle = 'retention-public'
  ),
  'the finalized public status uses the captured rounded freshness before cleanup'
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT deleted_source_day_values = 1
    FROM viberacing_api.cleanup_finalized_source_day_values(1)
  ),
  'batch one removes exactly one oldest finalized source-day value'
);

SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM viberacing_private.source_day_values
    WHERE source_id = 'src_' || pg_catalog.repeat('A', 22)
      AND codex_reported_date = DATE '2002-01-07'
  )
  AND (
    SELECT deleted_source_day_value_count = 1
      AND source_values_purged_at IS NULL
    FROM viberacing_private.finalized_season_profile_freshness
    WHERE season_start = DATE '2002-01-07'
      AND profile_id = '00000000-0000-4000-8000-000000039101'
  ),
  'partial cleanup deletes oldest receipt state and records exact non-terminal progress'
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT deleted_source_day_values = 2
    FROM viberacing_api.cleanup_finalized_source_day_values(1000)
  ),
  'the next batch completes the exact eligible finalized profile inventory'
);

SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM viberacing_private.source_day_values AS source_value
    JOIN viberacing_private.codex_sources AS source_record
      ON source_record.source_id = source_value.source_id
    WHERE source_record.profile_id = '00000000-0000-4000-8000-000000039101'
      AND source_value.codex_reported_date BETWEEN DATE '2002-01-07' AND DATE '2002-01-13'
  )
  AND (
    SELECT deleted_source_day_value_count = 3
      AND source_values_purged_at >= TIMESTAMPTZ '2002-02-15 01:00:00+00'
    FROM viberacing_private.finalized_season_profile_freshness
    WHERE season_start = DATE '2002-01-07'
      AND profile_id = '00000000-0000-4000-8000-000000039101'
  ),
  'terminal progress preserves the rounded projection after every exact value is removed'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 3
    FROM viberacing_private.source_day_values
    WHERE source_id IN (
      'src_' || pg_catalog.repeat('C', 22),
      'src_' || pg_catalog.repeat('D', 22),
      'src_' || pg_catalog.repeat('E', 22)
    )
  ),
  'recent finalized, open, and missing-projection source values remain'
);

SET LOCAL ROLE viberacing_web;

SELECT pg_temp.assert_true(
  (
    SELECT freshness_days = LEAST(
        65535,
        GREATEST(
          0,
          (pg_catalog.statement_timestamp() AT TIME ZONE 'UTC')::date - DATE '2002-01-11'
        )
      )
      AND weekly_score = 500
      AND source_count = 2
      AND streak_days = 0
    FROM viberacing_api.list_public_community_race_status(DATE '2002-01-07', 100)
    WHERE handle = 'retention-public'
  ),
  'physical exact-value cleanup does not change the compatible public status'
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT deleted_source_day_values = 0
    FROM viberacing_api.cleanup_finalized_source_day_values(1000)
  ),
  'finalized source-day cleanup is idempotent after eligible state is gone'
);

SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.seasons (
  season_start,
  season_end,
  score_version,
  created_at,
  refreshed_at,
  grace_ends_at
)
VALUES
  (
    DATE '2006-01-02',
    DATE '2006-01-08',
    'community_v1',
    TIMESTAMPTZ '2006-01-02 00:00:00+00',
    TIMESTAMPTZ '2006-01-11 00:30:00+00',
    viberacing_private.community_season_grace_ends_at(DATE '2006-01-02')
  ),
  (
    DATE '2007-01-01',
    DATE '2007-01-07',
    'community_v1',
    TIMESTAMPTZ '2007-01-01 00:00:00+00',
    TIMESTAMPTZ '2007-01-10 00:30:00+00',
    viberacing_private.community_season_grace_ends_at(DATE '2007-01-01')
  );

INSERT INTO viberacing_private.source_day_values (
  source_id,
  codex_reported_date,
  tokens,
  accepted_sync_id,
  accepted_device_id,
  first_accepted_at,
  last_accepted_at
)
VALUES
  (
    'src_' || pg_catalog.repeat('F', 22),
    DATE '2006-01-02',
    100,
    'syn_' || pg_catalog.repeat('G', 22),
    'dev_' || pg_catalog.repeat('F', 22),
    TIMESTAMPTZ '2006-01-04 08:00:00+00',
    TIMESTAMPTZ '2006-01-04 09:00:00+00'
  ),
  (
    'src_' || pg_catalog.repeat('G', 22),
    DATE '2007-01-01',
    100,
    'syn_' || pg_catalog.repeat('H', 22),
    'dev_' || pg_catalog.repeat('G', 22),
    TIMESTAMPTZ '2007-01-03 08:00:00+00',
    TIMESTAMPTZ '2007-01-03 09:00:00+00'
  ),
  (
    'src_' || pg_catalog.repeat('G', 22),
    DATE '2007-01-02',
    200,
    'syn_' || pg_catalog.repeat('I', 22),
    'dev_' || pg_catalog.repeat('G', 22),
    TIMESTAMPTZ '2007-01-04 08:00:00+00',
    TIMESTAMPTZ '2007-01-04 09:00:00+00'
  );

UPDATE viberacing_private.seasons
SET state = 'finalized',
  finalized_at = CASE season_start
    WHEN DATE '2006-01-02' THEN TIMESTAMPTZ '2006-01-11 01:00:00+00'
    WHEN DATE '2007-01-01' THEN TIMESTAMPTZ '2007-01-10 01:00:00+00'
  END
WHERE season_start IN (DATE '2006-01-02', DATE '2007-01-01');

-- Removing one captured row simulates owner-side drift. The entire Jobs statement must fail closed
-- before it can remove the remaining exact value or advance progress.
DELETE FROM viberacing_private.source_day_values
WHERE source_id = 'src_' || pg_catalog.repeat('G', 22)
  AND codex_reported_date = DATE '2007-01-01';

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_finalized_source_day_values(10)$sql$,
  'captured/live source-day count drift fails cleanup closed'
);

SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM viberacing_private.source_day_values
    WHERE source_id = 'src_' || pg_catalog.repeat('G', 22)
      AND codex_reported_date = DATE '2007-01-02'
  )
  AND (
    SELECT deleted_source_day_value_count = 0
      AND source_values_purged_at IS NULL
    FROM viberacing_private.finalized_season_profile_freshness
    WHERE season_start = DATE '2007-01-01'
      AND profile_id = '00000000-0000-4000-8000-000000039106'
  ),
  'drift failure preserves the remaining exact value and zero progress'
);

UPDATE viberacing_private.profiles
SET state = 'deletion_pending',
  hidden_at = pg_catalog.statement_timestamp(),
  deletion_requested_at = pg_catalog.statement_timestamp()
WHERE profile_id = '00000000-0000-4000-8000-000000039105';
DELETE FROM viberacing_private.profiles
WHERE profile_id = '00000000-0000-4000-8000-000000039105';

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM viberacing_private.finalized_season_profile_freshness
    WHERE season_start = DATE '2006-01-02'
      AND profile_id = '00000000-0000-4000-8000-000000039105'
  ),
  'deletion-pending profile purge can cascade the personal finalized freshness projection'
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_finalized_source_day_values(NULL)$sql$,
  'a null finalized source-day batch fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_finalized_source_day_values(0)$sql$,
  'a zero finalized source-day batch fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_finalized_source_day_values(1001)$sql$,
  'an oversized finalized source-day batch fails closed'
);

SET LOCAL ROLE viberacing_web;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_finalized_source_day_values(1)$sql$,
  'Web cannot clean finalized source-day values'
);
SET LOCAL ROLE viberacing_ingest;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_finalized_source_day_values(1)$sql$,
  'Ingest cannot clean finalized source-day values'
);
SET LOCAL ROLE viberacing_admin;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_finalized_source_day_values(1)$sql$,
  'Admin cannot clean finalized source-day values'
);

SET LOCAL ROLE viberacing_owner;
DELETE FROM viberacing_private.maintenance_locks
WHERE capability = 'community_scoring_refresh';
SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_finalized_source_day_values(1)$sql$,
  'a missing scoring mutex fails finalized source-day cleanup closed'
);

SET LOCAL ROLE viberacing_owner;
INSERT INTO viberacing_private.maintenance_locks (capability)
VALUES ('community_scoring_refresh');
DELETE FROM viberacing_private.maintenance_locks
WHERE capability = 'ingest_retention_cleanup';
SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_finalized_source_day_values(1)$sql$,
  'a missing Ingest-retention mutex fails finalized source-day cleanup closed'
);

SET LOCAL ROLE viberacing_owner;
INSERT INTO viberacing_private.maintenance_locks (capability)
VALUES ('ingest_retention_cleanup');
DELETE FROM viberacing_private.maintenance_locks
WHERE capability = 'profile_deletion_purge';
SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_finalized_source_day_values(1)$sql$,
  'a missing profile-purge mutex fails finalized source-day cleanup closed'
);

ROLLBACK;
