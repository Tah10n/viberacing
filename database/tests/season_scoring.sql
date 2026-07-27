\set ON_ERROR_STOP on

-- cspell:ignore attrelid relname attnum attisdropped attname

-- Deterministic synthetic scoring fixtures. The transaction is always rolled back. Source/day
-- values enter through the production Ingest procedure before the Jobs scoring procedure reads them.

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
    WHEN integrity_constraint_violation THEN
      RETURN;
  END;

  RAISE EXCEPTION 'expected integrity failure: %', label;
END
$function$;

CREATE FUNCTION pg_temp.submit_score_fixture(
  p_device_key_id uuid,
  p_fixture_letter text,
  p_usage_snapshot_id uuid,
  p_seed integer,
  p_dates text[],
  p_tokens bigint[]
)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM submission.outcome
  FROM viberacing_api.submit_usage_sync(
    p_device_key_id,
    'dev_' || pg_catalog.repeat(p_fixture_letter, 22),
    'src_' || pg_catalog.repeat(p_fixture_letter, 22),
    'codex',
    'codex_daily_usage_buckets_v1',
    p_usage_snapshot_id,
    'syn_' || pg_catalog.repeat(p_fixture_letter, 22),
    pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()),
    '1.2.3',
    '4.5.6',
    pg_catalog.decode(pg_catalog.lpad(p_seed::text, 64, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad((p_seed + 1000)::text, 128, '0'), 'hex'),
    pg_catalog.decode(pg_catalog.lpad((p_seed + 2000)::text, 64, '0'), 'hex'),
    p_dates,
    p_tokens
  ) AS submission;
END
$function$;

CREATE FUNCTION pg_temp.scoring_date(p_day_offset integer)
RETURNS date
LANGUAGE sql
STABLE
AS $function$
  SELECT pg_catalog.current_setting('viberacing.test_week_start')::date + p_day_offset
$function$;

SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (profile_id, github_user_id, handle, state)
VALUES
  (
    '00000000-0000-4000-8000-000000014101',
    900000000000014101,
    'score-two-sources',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000014102',
    900000000000014102,
    'score-rounding-tie',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000014103',
    900000000000014103,
    'score-active-days',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000014104',
    900000000000014104,
    'score-quarantine',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000014105',
    900000000000014105,
    'score-weekly-cap',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000014106',
    900000000000014106,
    'score-hidden',
    'active'
  );

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES
  ('src_' || pg_catalog.repeat('A', 22), '00000000-0000-4000-8000-000000014101'),
  ('src_' || pg_catalog.repeat('B', 22), '00000000-0000-4000-8000-000000014101'),
  ('src_' || pg_catalog.repeat('C', 22), '00000000-0000-4000-8000-000000014102'),
  ('src_' || pg_catalog.repeat('D', 22), '00000000-0000-4000-8000-000000014103'),
  ('src_' || pg_catalog.repeat('E', 22), '00000000-0000-4000-8000-000000014104'),
  ('src_' || pg_catalog.repeat('Q', 22), '00000000-0000-4000-8000-000000014104'),
  ('src_' || pg_catalog.repeat('F', 22), '00000000-0000-4000-8000-000000014105'),
  ('src_' || pg_catalog.repeat('H', 22), '00000000-0000-4000-8000-000000014106');

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
    '00000000-0000-4000-8000-000000014401',
    'dev_' || pg_catalog.repeat('A', 22),
    'src_' || pg_catalog.repeat('A', 22),
    pg_catalog.decode(pg_catalog.lpad('14401', 64, '0'), 'hex'),
    'Scoring source A',
    '1.2.3',
    'linux',
    'x86_64',
    'active',
    pg_catalog.statement_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000014402',
    'dev_' || pg_catalog.repeat('B', 22),
    'src_' || pg_catalog.repeat('B', 22),
    pg_catalog.decode(pg_catalog.lpad('14402', 64, '0'), 'hex'),
    'Scoring source B',
    '1.2.3',
    'linux',
    'x86_64',
    'active',
    pg_catalog.statement_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000014403',
    'dev_' || pg_catalog.repeat('C', 22),
    'src_' || pg_catalog.repeat('C', 22),
    pg_catalog.decode(pg_catalog.lpad('14403', 64, '0'), 'hex'),
    'Scoring source C',
    '1.2.3',
    'linux',
    'x86_64',
    'active',
    pg_catalog.statement_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000014404',
    'dev_' || pg_catalog.repeat('D', 22),
    'src_' || pg_catalog.repeat('D', 22),
    pg_catalog.decode(pg_catalog.lpad('14404', 64, '0'), 'hex'),
    'Scoring source D',
    '1.2.3',
    'linux',
    'x86_64',
    'active',
    pg_catalog.statement_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000014405',
    'dev_' || pg_catalog.repeat('E', 22),
    'src_' || pg_catalog.repeat('E', 22),
    pg_catalog.decode(pg_catalog.lpad('14405', 64, '0'), 'hex'),
    'Scoring source E',
    '1.2.3',
    'linux',
    'x86_64',
    'active',
    pg_catalog.statement_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000014406',
    'dev_' || pg_catalog.repeat('Q', 22),
    'src_' || pg_catalog.repeat('Q', 22),
    pg_catalog.decode(pg_catalog.lpad('14406', 64, '0'), 'hex'),
    'Scoring quarantined source',
    '1.2.3',
    'linux',
    'x86_64',
    'active',
    pg_catalog.statement_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000014407',
    'dev_' || pg_catalog.repeat('F', 22),
    'src_' || pg_catalog.repeat('F', 22),
    pg_catalog.decode(pg_catalog.lpad('14407', 64, '0'), 'hex'),
    'Scoring capped source',
    '1.2.3',
    'linux',
    'x86_64',
    'active',
    pg_catalog.statement_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000014408',
    'dev_' || pg_catalog.repeat('H', 22),
    'src_' || pg_catalog.repeat('H', 22),
    pg_catalog.decode(pg_catalog.lpad('14408', 64, '0'), 'hex'),
    'Scoring hidden profile source',
    '1.2.3',
    'linux',
    'x86_64',
    'active',
    pg_catalog.statement_timestamp()
  );

SET LOCAL ROLE viberacing_ingest;

SELECT pg_temp.submit_score_fixture(
  '00000000-0000-4000-8000-000000014401',
  'A',
  '00000000-0000-4000-8000-000000014501',
  14501,
  ARRAY[pg_temp.scoring_date(0)::text],
  ARRAY[10000]::bigint[]
);
SELECT pg_temp.submit_score_fixture(
  '00000000-0000-4000-8000-000000014402',
  'B',
  '00000000-0000-4000-8000-000000014502',
  14502,
  ARRAY[pg_temp.scoring_date(0)::text],
  ARRAY[10000]::bigint[]
);
SELECT pg_temp.submit_score_fixture(
  '00000000-0000-4000-8000-000000014403',
  'C',
  '00000000-0000-4000-8000-000000014503',
  14503,
  ARRAY[pg_temp.scoring_date(0)::text],
  ARRAY[20001]::bigint[]
);
SELECT pg_temp.submit_score_fixture(
  '00000000-0000-4000-8000-000000014404',
  'D',
  '00000000-0000-4000-8000-000000014504',
  14504,
  ARRAY[pg_temp.scoring_date(0)::text, pg_temp.scoring_date(1)::text],
  ARRAY[10000, 1]::bigint[]
);
SELECT pg_temp.submit_score_fixture(
  '00000000-0000-4000-8000-000000014405',
  'E',
  '00000000-0000-4000-8000-000000014505',
  14505,
  ARRAY[pg_temp.scoring_date(0)::text],
  ARRAY[10000]::bigint[]
);
SELECT pg_temp.submit_score_fixture(
  '00000000-0000-4000-8000-000000014406',
  'Q',
  '00000000-0000-4000-8000-000000014506',
  14506,
  ARRAY[pg_temp.scoring_date(0)::text],
  ARRAY[9007199254740991]::bigint[]
);
SELECT pg_temp.submit_score_fixture(
  '00000000-0000-4000-8000-000000014407',
  'F',
  '00000000-0000-4000-8000-000000014507',
  14507,
  ARRAY[
    pg_temp.scoring_date(0)::text,
    pg_temp.scoring_date(1)::text,
    pg_temp.scoring_date(2)::text,
    pg_temp.scoring_date(3)::text,
    pg_temp.scoring_date(4)::text,
    pg_temp.scoring_date(5)::text,
    pg_temp.scoring_date(6)::text
  ],
  ARRAY[
    9007199254740991,
    9007199254740991,
    9007199254740991,
    9007199254740991,
    9007199254740991,
    9007199254740991,
    9007199254740991
  ]::bigint[]
);
SELECT pg_temp.submit_score_fixture(
  '00000000-0000-4000-8000-000000014408',
  'H',
  '00000000-0000-4000-8000-000000014508',
  14508,
  ARRAY[pg_temp.scoring_date(0)::text],
  ARRAY[9007199254740991]::bigint[]
);

SET LOCAL ROLE viberacing_owner;

UPDATE viberacing_private.codex_sources
SET state = 'paused',
  state_changed_at = pg_catalog.statement_timestamp()
WHERE source_id = 'src_' || pg_catalog.repeat('B', 22);

UPDATE viberacing_private.codex_sources
SET state = 'unlinked',
  state_changed_at = pg_catalog.statement_timestamp()
WHERE source_id = 'src_' || pg_catalog.repeat('E', 22);

UPDATE viberacing_private.codex_sources
SET state = 'quarantined',
  state_changed_at = pg_catalog.statement_timestamp()
WHERE source_id = 'src_' || pg_catalog.repeat('Q', 22);

SELECT pg_temp.assert_true(
  (
    SELECT state = 'paused'
    FROM viberacing_private.codex_sources
    WHERE source_id = 'src_' || pg_catalog.repeat('B', 22)
  )
  AND (
    SELECT state = 'unlinked'
    FROM viberacing_private.codex_sources
    WHERE source_id = 'src_' || pg_catalog.repeat('E', 22)
  )
  AND (
    SELECT state = 'quarantined'
    FROM viberacing_private.codex_sources
    WHERE source_id = 'src_' || pg_catalog.repeat('Q', 22)
  ),
  'the scoring fixture covers paused, unlinked, and quarantined source state'
);

UPDATE viberacing_private.profiles
SET state = 'hidden',
  updated_at = pg_catalog.statement_timestamp(),
  hidden_at = pg_catalog.statement_timestamp()
WHERE profile_id = '00000000-0000-4000-8000-000000014106';

SELECT pg_temp.expect_integrity_failure(
  $sql$
    UPDATE viberacing_private.score_versions
    SET daily_cap = 999
    WHERE score_version = 'community_v1'
  $sql$,
  'an existing score version cannot be changed'
);
SELECT pg_temp.expect_integrity_failure(
  $sql$
    DELETE FROM viberacing_private.score_versions
    WHERE score_version = 'community_v1'
  $sql$,
  'an existing score version cannot be deleted'
);

-- Pin this legacy-formula fixture to an already-created season. Without the explicit row, the
-- production cutover would make the expected logarithmic values depend on the integration run date.
INSERT INTO viberacing_private.seasons (
  season_start,
  season_end,
  score_version,
  state,
  grace_ends_at
)
VALUES (
  pg_temp.scoring_date(0),
  pg_temp.scoring_date(6),
  'community_v1',
  'open',
  viberacing_private.community_season_grace_ends_at(pg_temp.scoring_date(0))
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT profile_count = 5
    FROM viberacing_api.refresh_community_season(pg_temp.scoring_date(0))
  ),
  'Jobs refresh materializes exactly the five visible Community profiles'
);

SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT score_version = 'community_v1'
      AND trust_tier = 'community'
      AND formula_code = 'logarithmic_v1'
      AND daily_multiplier = 250
      AND token_scale = 10000
      AND daily_cap = 1000
      AND weekly_cap = 7000
    FROM viberacing_private.score_versions
    WHERE score_version = 'community_v1'
  ),
  'the immutable Community v1 formula matches the canonical plan'
);

SELECT pg_temp.assert_true(
  (
    SELECT season_end = pg_temp.scoring_date(6)
      AND score_version = 'community_v1'
      AND refreshed_at IS NOT NULL
    FROM viberacing_private.seasons
    WHERE season_start = pg_temp.scoring_date(0)
  ),
  'season grouping uses one ISO Monday-through-Sunday range'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    UPDATE viberacing_private.seasons
    SET score_version = 'community_v2'
    WHERE season_start = pg_temp.scoring_date(0)
  $sql$,
  'an existing season cannot be rebound to another score version'
);
SELECT pg_temp.expect_integrity_failure(
  $sql$
    UPDATE viberacing_private.seasons
    SET created_at = created_at - INTERVAL '1 second'
    WHERE season_start = pg_temp.scoring_date(0)
  $sql$,
  'an existing season cannot rewrite its server-managed creation time'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 5
    FROM viberacing_private.season_entries
    WHERE season_start = pg_temp.scoring_date(0)
  )
  AND (
    SELECT pg_catalog.count(*) = 35
    FROM viberacing_private.season_daily_scores
    WHERE season_start = pg_temp.scoring_date(0)
  ),
  'every participating profile receives one entry and exactly seven daily scores'
);

SELECT pg_temp.assert_true(
  (
    SELECT weekly_score = 7000
      AND active_days = 7
      AND contributing_source_count = 1
      AND rank_position = 1
      AND display_order = 1
    FROM viberacing_private.season_entries
    WHERE season_start = pg_temp.scoring_date(0)
      AND profile_id = '00000000-0000-4000-8000-000000014105'
  ),
  'daily and weekly caps apply after safe-integer input'
);

SELECT pg_temp.assert_true(
  (
    SELECT weekly_score = 275
      AND active_days = 1
      AND contributing_source_count = 2
      AND rank_position = 2
      AND display_order = 2
    FROM viberacing_private.season_entries
    WHERE season_start = pg_temp.scoring_date(0)
      AND profile_id = '00000000-0000-4000-8000-000000014101'
  )
  AND (
    SELECT weekly_score = 275
      AND active_days = 1
      AND contributing_source_count = 1
      AND rank_position = 2
      AND display_order = 3
    FROM viberacing_private.season_entries
    WHERE season_start = pg_temp.scoring_date(0)
      AND profile_id = '00000000-0000-4000-8000-000000014102'
  ),
  'distinct active and paused sources sum once before one cap and raw totals do not break a tie'
);

SELECT pg_temp.assert_true(
  (
    SELECT weekly_score = 173
      AND active_days = 2
      AND rank_position = 4
      AND display_order = 4
    FROM viberacing_private.season_entries
    WHERE season_start = pg_temp.scoring_date(0)
      AND profile_id = '00000000-0000-4000-8000-000000014103'
  )
  AND (
    SELECT weekly_score = 173
      AND active_days = 1
      AND contributing_source_count = 1
      AND rank_position = 5
      AND display_order = 5
    FROM viberacing_private.season_entries
    WHERE season_start = pg_temp.scoring_date(0)
      AND profile_id = '00000000-0000-4000-8000-000000014104'
  ),
  'active days break score ties while unlinked history remains and quarantined sources do not'
);

SELECT pg_temp.assert_true(
  (
    SELECT daily_score = 275
    FROM viberacing_private.season_daily_scores
    WHERE season_start = pg_temp.scoring_date(0)
      AND profile_id = '00000000-0000-4000-8000-000000014101'
      AND score_date = pg_temp.scoring_date(0)
  )
  AND (
    SELECT daily_score = 0
    FROM viberacing_private.season_daily_scores
    WHERE season_start = pg_temp.scoring_date(0)
      AND profile_id = '00000000-0000-4000-8000-000000014103'
      AND score_date = pg_temp.scoring_date(1)
  )
  AND (
    SELECT pg_catalog.count(*) = 7
    FROM viberacing_private.season_daily_scores
    WHERE season_start = pg_temp.scoring_date(0)
      AND profile_id = '00000000-0000-4000-8000-000000014105'
      AND daily_score = 1000
  ),
  'daily materialization matches logarithmic rounding and caps'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM viberacing_private.season_entries
    WHERE profile_id = '00000000-0000-4000-8000-000000014106'
  ),
  'a hidden profile is absent from the open-season ranking'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'viberacing_private'
      AND relation.relname IN ('seasons', 'season_entries', 'season_daily_scores')
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND attribute.attname ~ '(token|source_id)'
  ),
  'season materialization stores no raw token total or source identifier'
);

CREATE TEMP TABLE entry_snapshot ON COMMIT DROP AS
SELECT
  season_start,
  profile_id,
  weekly_score,
  active_days,
  contributing_source_count,
  rank_position,
  display_order
FROM viberacing_private.season_entries
WHERE season_start = pg_temp.scoring_date(0);

CREATE TEMP TABLE daily_snapshot ON COMMIT DROP AS
SELECT season_start, profile_id, score_date, daily_score
FROM viberacing_private.season_daily_scores
WHERE season_start = pg_temp.scoring_date(0);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT profile_count = 5
    FROM viberacing_api.refresh_community_season(pg_temp.scoring_date(0))
  ),
  'an exact Jobs rerun succeeds without double-counting'
);

SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  NOT EXISTS (
    (SELECT
      season_start,
      profile_id,
      weekly_score,
      active_days,
      contributing_source_count,
      rank_position,
      display_order
    FROM viberacing_private.season_entries
    WHERE season_start = pg_temp.scoring_date(0)
    EXCEPT
    SELECT * FROM entry_snapshot)
    UNION ALL
    (SELECT * FROM entry_snapshot
    EXCEPT
    SELECT
      season_start,
      profile_id,
      weekly_score,
      active_days,
      contributing_source_count,
      rank_position,
      display_order
    FROM viberacing_private.season_entries
    WHERE season_start = pg_temp.scoring_date(0))
  )
  AND NOT EXISTS (
    (SELECT season_start, profile_id, score_date, daily_score
    FROM viberacing_private.season_daily_scores
    WHERE season_start = pg_temp.scoring_date(0)
    EXCEPT
    SELECT * FROM daily_snapshot)
    UNION ALL
    (SELECT * FROM daily_snapshot
    EXCEPT
    SELECT season_start, profile_id, score_date, daily_score
    FROM viberacing_private.season_daily_scores
    WHERE season_start = pg_temp.scoring_date(0))
  ),
  'Jobs rerun leaves the complete score projection unchanged'
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.refresh_community_season(NULL)$sql$,
  'a null season start fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.refresh_community_season(pg_temp.scoring_date(1))$sql$,
  'a non-Monday season start fails closed'
);

SELECT pg_temp.assert_true(
  (
    SELECT profile_count = 0
    FROM viberacing_api.refresh_community_season(pg_temp.scoring_date(7))
  ),
  'a week without stored source state is a bounded no-op'
);

SET LOCAL ROLE viberacing_owner;
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM viberacing_private.seasons
    WHERE season_start = pg_temp.scoring_date(7)
  ),
  'a no-data refresh cannot grow empty season state'
);

DELETE FROM viberacing_private.maintenance_locks
WHERE capability = 'community_scoring_refresh';
SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.refresh_community_season(pg_temp.scoring_date(0))$sql$,
  'a missing private scoring mutex fails closed'
);

ROLLBACK;
