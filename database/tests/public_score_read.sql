\set ON_ERROR_STOP on

-- Deterministic synthetic score-projection fixtures. The transaction is always rolled back.

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

CREATE FUNCTION pg_temp.public_score_date(p_day_offset integer)
RETURNS date
LANGUAGE sql
STABLE
AS $function$
  SELECT pg_catalog.current_setting('viberacing.test_week_start')::date + p_day_offset
$function$;

CREATE FUNCTION pg_temp.public_score_utc_day_offset()
RETURNS integer
LANGUAGE sql
STABLE
AS $function$
  SELECT pg_catalog.date_part(
    'isodow',
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC'
  )::integer - 1
$function$;

CREATE FUNCTION pg_temp.public_score_received_at(p_max_age_days integer)
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $function$
  SELECT (
    (
      (pg_catalog.statement_timestamp() AT TIME ZONE 'UTC')::date
      - LEAST(pg_temp.public_score_utc_day_offset(), p_max_age_days)
    )::timestamp AT TIME ZONE 'UTC'
  )
$function$;

SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (
  profile_id,
  github_user_id,
  handle,
  state,
  streak_visible,
  hidden_at,
  deletion_requested_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000018101',
    900000000000018101,
    'public_alpha',
    'active',
    true,
    NULL,
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000018102',
    900000000000018102,
    'public_beta',
    'active',
    false,
    NULL,
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000018103',
    900000000000018103,
    'public_gamma',
    'active',
    true,
    NULL,
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000018104',
    900000000000018104,
    'hidden_driver',
    'hidden',
    true,
    pg_catalog.statement_timestamp(),
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000018105',
    900000000000018105,
    'deleting_driver',
    'deletion_pending',
    true,
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000018106',
    900000000000018106,
    'enrolling_driver',
    'enrolling',
    true,
    NULL,
    NULL
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
VALUES
  (
    '00000000-0000-4000-8000-000000018101',
    1,
    'formula',
    'wedge',
    'canopy',
    'high',
    'slick',
    'magenta',
    'spark',
    101
  ),
  (
    '00000000-0000-4000-8000-000000018103',
    1,
    'rally',
    'scoop',
    'rally',
    'high',
    'all-terrain',
    'turbo-blue',
    'spark',
    303
  ),
  (
    '00000000-0000-4000-8000-000000018104',
    1,
    'roadster',
    'classic',
    'open',
    'low',
    'street',
    'sunburst',
    'grid',
    404
  );

INSERT INTO viberacing_private.seasons (
  season_start,
  season_end,
  score_version,
  grace_ends_at
)
VALUES (
  pg_temp.public_score_date(0),
  pg_temp.public_score_date(6),
  'community_v1',
  viberacing_private.community_season_grace_ends_at(pg_temp.public_score_date(0))
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
VALUES
  (
    pg_temp.public_score_date(0),
    '00000000-0000-4000-8000-000000018104',
    900,
    7,
    4,
    1,
    1,
    pg_catalog.statement_timestamp()
  ),
  (
    pg_temp.public_score_date(0),
    '00000000-0000-4000-8000-000000018105',
    800,
    7,
    3,
    2,
    2,
    pg_catalog.statement_timestamp()
  ),
  (
    pg_temp.public_score_date(0),
    '00000000-0000-4000-8000-000000018106',
    750,
    6,
    2,
    3,
    3,
    pg_catalog.statement_timestamp()
  ),
  (
    pg_temp.public_score_date(0),
    '00000000-0000-4000-8000-000000018101',
    700,
    6,
    2,
    4,
    4,
    pg_catalog.statement_timestamp()
  ),
  (
    pg_temp.public_score_date(0),
    '00000000-0000-4000-8000-000000018102',
    500,
    5,
    2,
    5,
    5,
    pg_catalog.statement_timestamp()
  ),
  (
    pg_temp.public_score_date(0),
    '00000000-0000-4000-8000-000000018103',
    500,
    5,
    1,
    5,
    6,
    pg_catalog.statement_timestamp()
  );

INSERT INTO viberacing_private.codex_sources (source_id, profile_id, state)
VALUES
  (
    'src_AAAAAAAAAAAAAAAAAAAAAA',
    '00000000-0000-4000-8000-000000018101',
    'active'
  ),
  (
    'src_BBBBBBBBBBBBBBBBBBBBBB',
    '00000000-0000-4000-8000-000000018102',
    'paused'
  ),
  (
    'src_CCCCCCCCCCCCCCCCCCCCCC',
    '00000000-0000-4000-8000-000000018103',
    'unlinked'
  );

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
VALUES
  (
    'src_AAAAAAAAAAAAAAAAAAAAAA',
    pg_temp.public_score_date(0),
    1000,
    NULL,
    'syn_AAAAAAAAAAAAAAAAAAAAAA',
    'dev_AAAAAAAAAAAAAAAAAAAAAA',
    pg_temp.public_score_received_at(2),
    pg_temp.public_score_received_at(2)
  ),
  (
    'src_BBBBBBBBBBBBBBBBBBBBBB',
    pg_temp.public_score_date(0),
    900,
    NULL,
    'syn_BBBBBBBBBBBBBBBBBBBBBB',
    'dev_BBBBBBBBBBBBBBBBBBBBBB',
    pg_temp.public_score_received_at(1),
    pg_temp.public_score_received_at(1)
  ),
  (
    'src_CCCCCCCCCCCCCCCCCCCCCC',
    pg_temp.public_score_date(0),
    800,
    NULL,
    'syn_CCCCCCCCCCCCCCCCCCCCCC',
    'dev_CCCCCCCCCCCCCCCCCCCCCC',
    pg_temp.public_score_received_at(0),
    pg_temp.public_score_received_at(0)
  ),
  (
    'src_AAAAAAAAAAAAAAAAAAAAAA',
    pg_temp.public_score_date(-1),
    1000,
    NULL,
    'syn_DDDDDDDDDDDDDDDDDDDDDD',
    'dev_AAAAAAAAAAAAAAAAAAAAAA',
    pg_catalog.statement_timestamp() - INTERVAL '7 days',
    pg_catalog.statement_timestamp() - INTERVAL '7 days'
  ),
  -- Keep finalized-profile freshness separate from the immediately previous ISO week, whose
  -- 48-hour grace can still be active on UTC Monday or Tuesday.
  (
    'src_CCCCCCCCCCCCCCCCCCCCCC',
    pg_temp.public_score_date(-8),
    700,
    NULL,
    'syn_EEEEEEEEEEEEEEEEEEEEEE',
    'dev_CCCCCCCCCCCCCCCCCCCCCC',
    pg_catalog.statement_timestamp() - INTERVAL '7 days',
    pg_catalog.statement_timestamp() - INTERVAL '7 days'
  );

INSERT INTO viberacing_private.season_daily_scores (
  season_start,
  profile_id,
  score_date,
  daily_score
)
SELECT
  pg_temp.public_score_date(0),
  profile_score.profile_id,
  pg_temp.public_score_date(day_record.day_offset),
  CASE
    WHEN day_record.day_offset < profile_score.positive_day_count THEN 100
    ELSE 0
  END::smallint
FROM (
  VALUES
    ('00000000-0000-4000-8000-000000018101'::uuid, 6),
    ('00000000-0000-4000-8000-000000018102'::uuid, 5),
    ('00000000-0000-4000-8000-000000018103'::uuid, 5)
) AS profile_score(profile_id, positive_day_count)
CROSS JOIN pg_catalog.generate_series(0, 6) AS day_record(day_offset);

-- This open previous week supplies the cross-week streak. It must not be finalized merely to test
-- terminal metadata because its grace boundary depends on the UTC day of the integration run.
INSERT INTO viberacing_private.seasons (
  season_start,
  season_end,
  score_version,
  grace_ends_at
)
VALUES (
  pg_temp.public_score_date(-7),
  pg_temp.public_score_date(-1),
  'community_v1',
  viberacing_private.community_season_grace_ends_at(pg_temp.public_score_date(-7))
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
  pg_temp.public_score_date(-7),
  '00000000-0000-4000-8000-000000018101',
  700,
  7,
  1,
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
  pg_temp.public_score_date(-7),
  '00000000-0000-4000-8000-000000018101',
  pg_temp.public_score_date(-7 + day_record.day_offset),
  100
FROM pg_catalog.generate_series(0, 6) AS day_record(day_offset);

-- Two weeks back is always beyond the public grace interval for the shared current-week anchor.
-- Use a distinct profile so terminal freshness and streak assertions cannot disturb the open-week
-- cross-week fixture above.
INSERT INTO viberacing_private.seasons (
  season_start,
  season_end,
  score_version,
  grace_ends_at
)
VALUES (
  pg_temp.public_score_date(-14),
  pg_temp.public_score_date(-8),
  'community_v1',
  viberacing_private.community_season_grace_ends_at(pg_temp.public_score_date(-14))
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
  pg_temp.public_score_date(-14),
  '00000000-0000-4000-8000-000000018103',
  700,
  7,
  1,
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
  pg_temp.public_score_date(-14),
  '00000000-0000-4000-8000-000000018103',
  pg_temp.public_score_date(-14 + day_record.day_offset),
  100
FROM pg_catalog.generate_series(0, 6) AS day_record(day_offset);

UPDATE viberacing_private.seasons
SET refreshed_at = pg_catalog.statement_timestamp(),
  state = 'finalized',
  finalized_at = pg_catalog.statement_timestamp()
WHERE season_start = pg_temp.public_score_date(-14);

SET LOCAL ROLE viberacing_web;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 3
    FROM viberacing_api.list_public_community_scores(
      pg_temp.public_score_date(0),
      100
    )
  )
  AND (
    SELECT weekly_score = 700
      AND active_days = 6
      AND source_count = 2
      AND rank_position = 1
      AND display_position = 1
      AND NOT season_finalized
    FROM viberacing_api.list_public_community_scores(
      pg_temp.public_score_date(0),
      100
    )
    WHERE handle = 'public_alpha'
  )
  AND (
    SELECT rank_position = 2 AND display_position = 2
    FROM viberacing_api.list_public_community_scores(
      pg_temp.public_score_date(0),
      100
    )
    WHERE handle = 'public_beta'
  )
  AND (
    SELECT rank_position = 2 AND display_position = 3
    FROM viberacing_api.list_public_community_scores(
      pg_temp.public_score_date(0),
      100
    )
    WHERE handle = 'public_gamma'
  )
  AND (
    SELECT pg_catalog.array_agg(handle) = ARRAY[
      'public_alpha',
      'public_beta',
      'public_gamma'
    ]::text[]
    FROM viberacing_api.list_public_community_scores(
      pg_temp.public_score_date(0),
      100
    )
  ),
  'the public projection excludes non-active profiles and returns fixed shared-rank ordering'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.array_agg(DISTINCT output_key.key ORDER BY output_key.key) = ARRAY[
      'active_days',
      'display_position',
      'handle',
      'rank_position',
      'score_version',
      'season_end',
      'season_finalized',
      'season_start',
      'source_count',
      'weekly_score'
    ]::text[]
    FROM viberacing_api.list_public_community_scores(
      pg_temp.public_score_date(0),
      100
    ) AS score_record
    CROSS JOIN LATERAL pg_catalog.jsonb_object_keys(
      pg_catalog.to_jsonb(score_record)
    ) AS output_key(key)
  ),
  'the score projection contains only the reviewed public field allowlist'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 3
    FROM viberacing_api.list_public_community_race(
      pg_temp.public_score_date(0),
      100
    )
  )
  AND (
    SELECT car_recipe = pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'chassis', 'formula',
      'nose', 'wedge',
      'cockpit', 'canopy',
      'wing', 'high',
      'wheels', 'slick',
      'palette', 'magenta',
      'trail', 'spark',
      'seed', 101
    )
    FROM viberacing_api.list_public_community_race(
      pg_temp.public_score_date(0),
      100
    )
    WHERE handle = 'public_alpha'
  )
  AND (
    SELECT car_recipe IS NULL
    FROM viberacing_api.list_public_community_race(
      pg_temp.public_score_date(0),
      100
    )
    WHERE handle = 'public_beta'
  )
  AND (
    SELECT car_recipe ->> 'palette' = 'turbo-blue'
      AND (car_recipe ->> 'seed')::integer = 303
    FROM viberacing_api.list_public_community_race(
      pg_temp.public_score_date(0),
      100
    )
    WHERE handle = 'public_gamma'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_api.list_public_community_race(
      pg_temp.public_score_date(0),
      100
    )
    WHERE handle = 'hidden_driver'
  ),
  'the race projection adds only an active public recipe and preserves recipe absence'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.array_agg(DISTINCT output_key.key ORDER BY output_key.key) = ARRAY[
      'active_days',
      'car_recipe',
      'display_position',
      'handle',
      'rank_position',
      'score_version',
      'season_end',
      'season_finalized',
      'season_start',
      'source_count',
      'weekly_score'
    ]::text[]
    FROM viberacing_api.list_public_community_race(
      pg_temp.public_score_date(0),
      100
    ) AS race_record
    CROSS JOIN LATERAL pg_catalog.jsonb_object_keys(
      pg_catalog.to_jsonb(race_record)
    ) AS output_key(key)
  ),
  'the race projection contains only the reviewed public field allowlist'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 3
    FROM viberacing_api.list_public_community_race_status(
      pg_temp.public_score_date(0),
      100
    )
  )
  AND (
    SELECT freshness_days = LEAST(pg_temp.public_score_utc_day_offset(), 2)
      AND streak_days = 7 + LEAST(pg_temp.public_score_utc_day_offset() + 1, 6)
      AND car_recipe ->> 'palette' = 'magenta'
    FROM viberacing_api.list_public_community_race_status(
      pg_temp.public_score_date(0),
      100
    )
    WHERE handle = 'public_alpha'
  )
  AND (
    SELECT freshness_days = LEAST(pg_temp.public_score_utc_day_offset(), 1)
      AND streak_days IS NULL
      AND car_recipe IS NULL
    FROM viberacing_api.list_public_community_race_status(
      pg_temp.public_score_date(0),
      100
    )
    WHERE handle = 'public_beta'
  )
  AND (
    SELECT freshness_days = 0
    FROM viberacing_api.list_public_community_race_status(
      pg_temp.public_score_date(0),
      100
    )
    WHERE handle = 'public_gamma'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_api.list_public_community_race_status(
      pg_temp.public_score_date(0),
      100
    )
    WHERE handle = 'hidden_driver'
  ),
  'the status projection rounds accepted server time and respects cross-week streak visibility'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.array_agg(DISTINCT output_key.key ORDER BY output_key.key) = ARRAY[
      'active_days',
      'car_recipe',
      'display_position',
      'freshness_days',
      'handle',
      'rank_position',
      'score_version',
      'season_end',
      'season_finalized',
      'season_start',
      'source_count',
      'streak_days',
      'weekly_score'
    ]::text[]
    FROM viberacing_api.list_public_community_race_status(
      pg_temp.public_score_date(0),
      100
    ) AS status_record
    CROSS JOIN LATERAL pg_catalog.jsonb_object_keys(
      pg_catalog.to_jsonb(status_record)
    ) AS output_key(key)
  ),
  'the status projection contains only the reviewed public field allowlist'
);

SELECT pg_temp.assert_true(
  (
    SELECT season_finalized
      AND freshness_days = 7
      AND streak_days = 7
    FROM viberacing_api.list_public_community_race_status(
      pg_temp.public_score_date(-14),
      100
    )
    WHERE handle = 'public_gamma'
  ),
  'a finalized past season anchors streak on Sunday and keeps freshness day-rounded'
);

SET LOCAL ROLE viberacing_owner;

SAVEPOINT freshness_saturation_fixture;

INSERT INTO viberacing_private.profiles (
  profile_id,
  github_user_id,
  handle,
  state,
  streak_visible,
  hidden_at,
  deletion_requested_at
)
VALUES (
  '00000000-0000-4000-8000-000000018107',
  900000000000018107,
  'public_delta',
  'active',
  true,
  NULL,
  NULL
);

INSERT INTO viberacing_private.codex_sources (source_id, profile_id, state)
VALUES (
  'src_DDDDDDDDDDDDDDDDDDDDDD',
  '00000000-0000-4000-8000-000000018107',
  'active'
);

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
  'src_DDDDDDDDDDDDDDDDDDDDDD',
  pg_temp.public_score_date(0),
  100,
  NULL,
  'syn_EEEEEEEEEEEEEEEEEEEEEE',
  'dev_DDDDDDDDDDDDDDDDDDDDDD',
  pg_catalog.statement_timestamp() - INTERVAL '70000 days',
  pg_catalog.statement_timestamp() - INTERVAL '70000 days'
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
  pg_temp.public_score_date(0),
  '00000000-0000-4000-8000-000000018107',
  100,
  1,
  1,
  7,
  7,
  pg_catalog.statement_timestamp()
);

SET LOCAL ROLE viberacing_web;

SELECT pg_temp.assert_true(
  (
    SELECT freshness_days = 65535
    FROM viberacing_api.list_public_community_race_status(
      pg_temp.public_score_date(0),
      100
    )
    WHERE handle = 'public_delta'
  ),
  'freshness saturates at the public serialization bound'
);

SET LOCAL ROLE viberacing_owner;

ROLLBACK TO SAVEPOINT freshness_saturation_fixture;
RELEASE SAVEPOINT freshness_saturation_fixture;

SET LOCAL ROLE viberacing_web;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 2
    FROM viberacing_api.list_public_community_scores(
      pg_temp.public_score_date(0),
      2
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_api.list_public_community_scores(
      pg_temp.public_score_date(0),
      2
    )
    WHERE display_position > 2
  )
  AND (
    SELECT pg_catalog.array_agg(handle) = ARRAY['public_alpha', 'public_beta']::text[]
    FROM viberacing_api.list_public_community_scores(
      pg_temp.public_score_date(0),
      2
    )
  ),
  'the public result cap is applied after visibility filtering and ranking'
);

SET LOCAL ROLE viberacing_owner;

UPDATE viberacing_private.profiles
SET state = 'hidden',
  hidden_at = pg_catalog.statement_timestamp(),
  updated_at = pg_catalog.statement_timestamp()
WHERE profile_id = '00000000-0000-4000-8000-000000018101';

SET LOCAL ROLE viberacing_web;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 2
      AND pg_catalog.min(rank_position) = 1
      AND pg_catalog.max(rank_position) = 1
      AND pg_catalog.min(display_position) = 1
      AND pg_catalog.max(display_position) = 2
    FROM viberacing_api.list_public_community_scores(
      pg_temp.public_score_date(0),
      100
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_api.list_public_community_scores(
      pg_temp.public_score_date(0),
      100
    )
    WHERE handle = 'public_alpha'
  )
  AND (
    SELECT pg_catalog.array_agg(handle) = ARRAY['public_beta', 'public_gamma']::text[]
    FROM viberacing_api.list_public_community_scores(
      pg_temp.public_score_date(0),
      100
    )
  ),
  'hide takes effect at read time and public ranks close without a hidden-profile gap'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM viberacing_api.list_public_community_race(
      pg_temp.public_score_date(0),
      100
    )
    WHERE handle = 'public_alpha'
  )
  AND (
    SELECT pg_catalog.count(*) = 2
      AND pg_catalog.min(display_position) = 1
      AND pg_catalog.max(display_position) = 2
    FROM viberacing_api.list_public_community_race(
      pg_temp.public_score_date(0),
      100
    )
  ),
  'the race projection removes a hidden profile and its active recipe at read time'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM viberacing_api.list_public_community_race_status(
      pg_temp.public_score_date(0),
      100
    )
    WHERE handle = 'public_alpha'
  )
  AND (
    SELECT pg_catalog.count(*) = 2
      AND pg_catalog.min(display_position) = 1
      AND pg_catalog.max(display_position) = 2
    FROM viberacing_api.list_public_community_race_status(
      pg_temp.public_score_date(0),
      100
    )
  ),
  'the status projection removes a hidden profile and closes its display position at read time'
);

SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT rank_position = 4
      AND display_order = 4
      AND weekly_score = 700
    FROM viberacing_private.season_entries
    WHERE season_start = pg_temp.public_score_date(0)
      AND profile_id = '00000000-0000-4000-8000-000000018101'
  ),
  'visibility-time public ranking does not rewrite the stored season entry'
);

INSERT INTO viberacing_private.seasons (
  season_start,
  season_end,
  score_version,
  grace_ends_at
)
VALUES (
  pg_temp.public_score_date(-21),
  pg_temp.public_score_date(-15),
  'community_v1',
  viberacing_private.community_season_grace_ends_at(pg_temp.public_score_date(-21))
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
VALUES
  (
    pg_temp.public_score_date(-21),
    '00000000-0000-4000-8000-000000018102',
    400,
    4,
    2,
    1,
    1,
    pg_catalog.statement_timestamp()
  ),
  (
    pg_temp.public_score_date(-21),
    '00000000-0000-4000-8000-000000018103',
    300,
    3,
    1,
    2,
    2,
    pg_catalog.statement_timestamp()
  );

UPDATE viberacing_private.seasons
SET refreshed_at = pg_catalog.statement_timestamp(),
  state = 'finalized',
  finalized_at = pg_catalog.statement_timestamp()
WHERE season_start = pg_temp.public_score_date(-21);

SET LOCAL ROLE viberacing_web;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 2
      AND pg_catalog.bool_and(season_finalized)
      AND pg_catalog.bool_and(season_end = pg_temp.public_score_date(-15))
      AND pg_catalog.bool_and(score_version = 'community_v1')
    FROM viberacing_api.list_public_community_scores(
      pg_temp.public_score_date(-21),
      100
    )
  ),
  'the same bounded projection reports terminal season metadata without timestamps'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 0
    FROM viberacing_api.list_public_community_scores(
      pg_temp.public_score_date(7),
      100
    )
  ),
  'a valid season without public score state returns an empty result'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 0
    FROM viberacing_api.list_public_community_race_status(
      pg_temp.public_score_date(7),
      100
    )
  ),
  'a future season without materialized public state returns no status participants'
);

SET LOCAL ROLE viberacing_owner;

SAVEPOINT future_status_fixture;

INSERT INTO viberacing_private.seasons (
  season_start,
  season_end,
  score_version,
  grace_ends_at
)
VALUES (
  pg_temp.public_score_date(7),
  pg_temp.public_score_date(13),
  'community_v1',
  viberacing_private.community_season_grace_ends_at(pg_temp.public_score_date(7))
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
  pg_temp.public_score_date(7),
  '00000000-0000-4000-8000-000000018102',
  100,
  1,
  1,
  1,
  1,
  pg_catalog.statement_timestamp()
);

SET LOCAL ROLE viberacing_web;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
    FROM viberacing_api.list_public_community_race(
      pg_temp.public_score_date(7),
      100
    )
  )
  AND (
    SELECT pg_catalog.count(*) = 0
    FROM viberacing_api.list_public_community_race_status(
      pg_temp.public_score_date(7),
      100
    )
  ),
  'the status projection suppresses a materialized future season without changing legacy race'
);

SET LOCAL ROLE viberacing_owner;

ROLLBACK TO SAVEPOINT future_status_fixture;
RELEASE SAVEPOINT future_status_fixture;

SET LOCAL ROLE viberacing_web;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 0
    FROM viberacing_api.list_public_community_scores(DATE '1999-12-27', 100)
  )
  AND (
    SELECT pg_catalog.count(*) = 0
    FROM viberacing_api.list_public_community_scores(DATE '2099-12-28', 100)
  ),
  'both inclusive public contract calendar boundaries are accepted'
);

SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.list_public_community_scores(NULL, 100)$sql$,
  'a null season fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT *
    FROM viberacing_api.list_public_community_scores(pg_temp.public_score_date(1), 100)
  $sql$,
  'a non-Monday season fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT *
    FROM viberacing_api.list_public_community_scores(DATE '1999-12-20', 100)
  $sql$,
  'a season below the public contract calendar fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT *
    FROM viberacing_api.list_public_community_scores(DATE '2100-01-04', 100)
  $sql$,
  'a season above the public contract calendar fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT *
    FROM viberacing_api.list_public_community_scores(pg_temp.public_score_date(0), NULL)
  $sql$,
  'a null result limit fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT *
    FROM viberacing_api.list_public_community_scores(pg_temp.public_score_date(0), 0)
  $sql$,
  'an empty result limit fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT *
    FROM viberacing_api.list_public_community_scores(pg_temp.public_score_date(0), 101)
  $sql$,
  'a result limit above the public ceiling fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.list_public_community_race(NULL, 100)$sql$,
  'a null race season fails closed through the score boundary'
);
SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT *
    FROM viberacing_api.list_public_community_race(pg_temp.public_score_date(0), 101)
  $sql$,
  'a race result limit above the public ceiling fails closed through the score boundary'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.list_public_community_race_status(NULL, 100)$sql$,
  'a null race status season fails closed through the score boundary'
);
SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT *
    FROM viberacing_api.list_public_community_race_status(
      pg_temp.public_score_date(0),
      101
    )
  $sql$,
  'a race status result limit above the public ceiling fails closed through the score boundary'
);

ROLLBACK;
