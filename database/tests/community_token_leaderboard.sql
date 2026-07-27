\set ON_ERROR_STOP on

-- Deterministic direct-token leaderboard fixtures. The transaction is always rolled back.

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

CREATE FUNCTION pg_temp.token_season(p_week_offset integer)
RETURNS date
LANGUAGE sql
STABLE
AS $function$
  SELECT pg_catalog.current_setting('viberacing.test_week_start')::date
    + (p_week_offset * 7)
$function$;

CREATE FUNCTION pg_temp.add_token_value(
  p_source_id text,
  p_reported_date date,
  p_tokens bigint,
  p_marker text
)
RETURNS void
LANGUAGE sql
AS $function$
  INSERT INTO viberacing_private.source_day_values (
    source_id,
    codex_reported_date,
    tokens,
    accepted_snapshot_id,
    accepted_sync_id,
    accepted_device_id,
    first_accepted_at,
    last_accepted_at
  )
  VALUES (
    p_source_id,
    p_reported_date,
    p_tokens,
    NULL,
    'syn_' || pg_catalog.repeat(p_marker, 22),
    'dev_' || pg_catalog.repeat(p_marker, 22),
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp()
  )
$function$;

SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  viberacing_private.community_score_version_for_season(DATE '2026-07-20')
    = 'community_v1'
  AND viberacing_private.community_score_version_for_season(DATE '2026-07-27')
    = 'community_tokens_v1',
  'the fixed cutover selects direct tokens without rewriting an earlier season'
);

SELECT pg_temp.assert_true(
  (
    SELECT formula_code = 'direct_tokens_v1'
      AND daily_multiplier = 1
      AND token_scale = 1
      AND daily_cap = 1
      AND weekly_cap = 1
    FROM viberacing_private.score_versions
    WHERE score_version = 'community_tokens_v1'
  ),
  'the direct-token score version has one closed immutable definition'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.bool_and(attribute.atttypid = 'pg_catalog.int8'::regtype)
    FROM pg_catalog.pg_attribute AS attribute
    WHERE (
      attribute.attrelid = 'viberacing_private.season_entries'::regclass
      AND attribute.attname = 'weekly_score'
    )
    OR (
      attribute.attrelid = 'viberacing_private.season_daily_scores'::regclass
      AND attribute.attname = 'daily_score'
    )
  ),
  'private season projections retain exact JavaScript-safe token totals'
);

INSERT INTO viberacing_private.profiles (profile_id, github_user_id, handle, state)
VALUES
  ('00000000-0000-4000-8000-000000042101', 900000000000042101, 'token_alpha', 'active'),
  ('00000000-0000-4000-8000-000000042102', 900000000000042102, 'token_beta', 'active'),
  ('00000000-0000-4000-8000-000000042103', 900000000000042103, 'token_champion', 'active'),
  ('00000000-0000-4000-8000-000000042104', 900000000000042104, 'token_hidden', 'active'),
  ('00000000-0000-4000-8000-000000042105', 900000000000042105, 'token_overflow', 'active'),
  ('00000000-0000-4000-8000-000000042106', 900000000000042106, 'token_valid', 'active'),
  ('00000000-0000-4000-8000-000000042107', 900000000000042107, 'legacy_preserved', 'active'),
  ('00000000-0000-4000-8000-000000042108', 900000000000042108, 'token_finalized', 'active');

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES
  (
    'src_' || pg_catalog.repeat('A', 21) || '1',
    '00000000-0000-4000-8000-000000042101'
  ),
  (
    'src_' || pg_catalog.repeat('A', 21) || '2',
    '00000000-0000-4000-8000-000000042101'
  ),
  ('src_' || pg_catalog.repeat('B', 22), '00000000-0000-4000-8000-000000042102'),
  ('src_' || pg_catalog.repeat('C', 22), '00000000-0000-4000-8000-000000042103'),
  ('src_' || pg_catalog.repeat('D', 22), '00000000-0000-4000-8000-000000042104'),
  ('src_' || pg_catalog.repeat('E', 22), '00000000-0000-4000-8000-000000042105'),
  ('src_' || pg_catalog.repeat('F', 22), '00000000-0000-4000-8000-000000042106'),
  ('src_' || pg_catalog.repeat('G', 22), '00000000-0000-4000-8000-000000042107'),
  ('src_' || pg_catalog.repeat('H', 22), '00000000-0000-4000-8000-000000042108');

SELECT pg_temp.add_token_value(
  'src_' || pg_catalog.repeat('A', 21) || '1',
  pg_temp.token_season(0),
  1000,
  'A'
);
SELECT pg_temp.add_token_value(
  'src_' || pg_catalog.repeat('A', 21) || '2',
  pg_temp.token_season(0) + 1,
  500,
  'I'
);
SELECT pg_temp.add_token_value(
  'src_' || pg_catalog.repeat('B', 22),
  pg_temp.token_season(0),
  1500,
  'B'
);
SELECT pg_temp.add_token_value(
  'src_' || pg_catalog.repeat('C', 22),
  pg_temp.token_season(0),
  1600,
  'C'
);
SELECT pg_temp.add_token_value(
  'src_' || pg_catalog.repeat('D', 22),
  pg_temp.token_season(0),
  1700,
  'D'
);
SELECT pg_temp.add_token_value(
  'src_' || pg_catalog.repeat('E', 22),
  pg_temp.token_season(0),
  9007199254740991,
  'E'
);
SELECT pg_temp.add_token_value(
  'src_' || pg_catalog.repeat('E', 22),
  pg_temp.token_season(0) + 1,
  1,
  'E'
);
SELECT pg_temp.add_token_value(
  'src_' || pg_catalog.repeat('F', 22),
  pg_temp.token_season(0),
  100,
  'F'
);
SELECT pg_temp.add_token_value(
  'src_' || pg_catalog.repeat('G', 22),
  pg_temp.token_season(-1),
  1000,
  'G'
);
SELECT pg_temp.add_token_value(
  'src_' || pg_catalog.repeat('H', 22),
  pg_temp.token_season(-2),
  321,
  'H'
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
  '00000000-0000-4000-8000-000000042103',
  1,
  'formula',
  'wedge',
  'canopy',
  'high',
  'slick',
  'mint',
  'spark',
  420
);

-- Create the current season first so this test remains valid on both sides of the fixed cutover.
INSERT INTO viberacing_private.seasons (
  season_start,
  season_end,
  score_version,
  state,
  grace_ends_at
)
VALUES (
  pg_temp.token_season(0),
  pg_temp.token_season(0) + 6,
  'community_tokens_v1',
  'open',
  viberacing_private.community_season_grace_ends_at(pg_temp.token_season(0))
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT profile_count = 5
    FROM viberacing_api.refresh_community_season(pg_temp.token_season(0))
  ),
  'refresh projects valid profiles while one unsafe aggregate cannot block the season'
);

SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 5
    FROM viberacing_private.season_entries
    WHERE season_start = pg_temp.token_season(0)
  )
  AND (
    SELECT pg_catalog.count(*) = 35
    FROM viberacing_private.season_daily_scores
    WHERE season_start = pg_temp.token_season(0)
  ),
  'the direct projection stores one entry and seven exact days per valid profile'
);

SELECT pg_temp.assert_true(
  (
    SELECT weekly_score = 1500
      AND active_days = 2
      AND contributing_source_count = 2
    FROM viberacing_private.season_entries
    WHERE season_start = pg_temp.token_season(0)
      AND profile_id = '00000000-0000-4000-8000-000000042101'
  )
  AND (
    SELECT weekly_score = 1500
      AND active_days = 1
      AND contributing_source_count = 1
    FROM viberacing_private.season_entries
    WHERE season_start = pg_temp.token_season(0)
      AND profile_id = '00000000-0000-4000-8000-000000042102'
  ),
  'source and day totals are exact while active-day and source metadata remain noncompetitive'
);

SELECT pg_temp.assert_true(
  (
    SELECT first_entry.rank_position = second_entry.rank_position
    FROM viberacing_private.season_entries AS first_entry
    JOIN viberacing_private.season_entries AS second_entry
      ON second_entry.season_start = first_entry.season_start
    WHERE first_entry.season_start = pg_temp.token_season(0)
      AND first_entry.profile_id = '00000000-0000-4000-8000-000000042101'
      AND second_entry.profile_id = '00000000-0000-4000-8000-000000042102'
  ),
  'equal token totals share a rank regardless of active days or source count'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM viberacing_private.season_entries
    WHERE season_start = pg_temp.token_season(0)
      AND profile_id = '00000000-0000-4000-8000-000000042105'
  )
  AND EXISTS (
    SELECT 1
    FROM viberacing_private.season_entries
    WHERE season_start = pg_temp.token_season(0)
      AND profile_id = '00000000-0000-4000-8000-000000042106'
      AND weekly_score = 100
  ),
  'one profile exceeding the safe aggregate is omitted without dropping valid profiles'
);

UPDATE viberacing_private.profiles
SET state = 'hidden',
  hidden_at = pg_catalog.statement_timestamp(),
  updated_at = pg_catalog.statement_timestamp()
WHERE profile_id = '00000000-0000-4000-8000-000000042104';

SET LOCAL ROLE viberacing_web;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.array_agg(handle ORDER BY display_position)
      = ARRAY['token_champion', 'token_alpha', 'token_beta', 'token_valid']
      AND pg_catalog.array_agg(weekly_token_total ORDER BY display_position)
        = ARRAY[1600, 1500, 1500, 100]::bigint[]
      AND pg_catalog.array_agg(rank_position ORDER BY display_position)
        = ARRAY[1, 2, 2, 4]
    FROM viberacing_api.list_public_community_token_race_status(
      pg_temp.token_season(0),
      100
    )
  ),
  'the public token projection recomputes visible profile ranks from exact totals only'
);

SELECT pg_temp.assert_true(
  (
    SELECT metric_version = 'community_tokens_v1'
      AND car_recipe ->> 'palette' = 'mint'
      AND freshness_days = 0
    FROM viberacing_api.list_public_community_token_race_status(
      pg_temp.token_season(0),
      100
    )
    WHERE handle = 'token_champion'
  ),
  'the token response retains cosmetic recipe and bounded freshness metadata'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT *
    FROM viberacing_api.list_public_community_token_race_status(NULL, 100)
  $sql$,
  'token projection rejects a missing season'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT *
    FROM viberacing_api.list_public_community_token_race_status(
      pg_temp.token_season(0),
      0
    )
  $sql$,
  'token projection rejects an unbounded limit'
);

SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.seasons (
  season_start,
  season_end,
  score_version,
  state,
  grace_ends_at
)
VALUES (
  pg_temp.token_season(-1),
  pg_temp.token_season(-1) + 6,
  'community_v1',
  'open',
  viberacing_private.community_season_grace_ends_at(pg_temp.token_season(-1))
);

SELECT viberacing_private.materialize_community_season(
  pg_temp.token_season(-1),
  pg_catalog.statement_timestamp()
);

SELECT pg_temp.assert_true(
  (
    SELECT score_version = 'community_v1'
    FROM viberacing_private.seasons
    WHERE season_start = pg_temp.token_season(-1)
  )
  AND (
    SELECT weekly_score BETWEEN 1 AND 7000
    FROM viberacing_private.season_entries
    WHERE season_start = pg_temp.token_season(-1)
      AND profile_id = '00000000-0000-4000-8000-000000042107'
  ),
  'an already defined legacy season keeps the compatible logarithmic projection'
);

SET LOCAL ROLE viberacing_web;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
    FROM viberacing_api.list_public_community_scores(pg_temp.token_season(-1), 100)
  )
  AND (
    SELECT pg_catalog.count(*) = 0
    FROM viberacing_api.list_public_community_token_race_status(
      pg_temp.token_season(-1),
      100
    )
  ),
  'legacy and direct-token public contracts never reinterpret one another'
);

SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.seasons (
  season_start,
  season_end,
  score_version,
  state,
  grace_ends_at
)
VALUES (
  pg_temp.token_season(-2),
  pg_temp.token_season(-2) + 6,
  'community_tokens_v1',
  'open',
  viberacing_private.community_season_grace_ends_at(pg_temp.token_season(-2))
);

CREATE TEMPORARY TABLE first_finalization
ON COMMIT DROP
AS
SELECT *
FROM viberacing_api.finalize_community_season(pg_temp.token_season(-2));

UPDATE viberacing_private.source_day_values
SET tokens = 999,
  last_accepted_at = pg_catalog.statement_timestamp()
WHERE source_id = 'src_' || pg_catalog.repeat('H', 22)
  AND codex_reported_date = pg_temp.token_season(-2);

CREATE TEMPORARY TABLE second_finalization
ON COMMIT DROP
AS
SELECT *
FROM viberacing_api.finalize_community_season(pg_temp.token_season(-2));

SELECT pg_temp.assert_true(
  (
    SELECT first_result.profile_count = 1
      AND second_result.profile_count = 1
      AND first_result.finalized_at = second_result.finalized_at
    FROM first_finalization AS first_result
    CROSS JOIN second_finalization AS second_result
  )
  AND (
    SELECT weekly_score = 321
    FROM viberacing_private.season_entries
    WHERE season_start = pg_temp.token_season(-2)
      AND profile_id = '00000000-0000-4000-8000-000000042108'
  ),
  'finalized token seasons are retry-safe and ignore later source-value growth'
);

SET LOCAL ROLE viberacing_web;

SELECT pg_temp.assert_true(
  (
    SELECT season_finalized
      AND weekly_token_total = 321
      AND freshness_days = 0
    FROM viberacing_api.list_public_community_token_race_status(
      pg_temp.token_season(-2),
      100
    )
    WHERE handle = 'token_finalized'
  ),
  'the finalized token projection remains readable with retained freshness'
);

ROLLBACK;
