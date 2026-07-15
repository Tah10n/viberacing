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

SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (
  profile_id,
  github_user_id,
  handle,
  state,
  hidden_at,
  deletion_requested_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000018101',
    900000000000018101,
    'public_alpha',
    'active',
    NULL,
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000018102',
    900000000000018102,
    'public_beta',
    'active',
    NULL,
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000018103',
    900000000000018103,
    'public_gamma',
    'active',
    NULL,
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000018104',
    900000000000018104,
    'hidden_driver',
    'hidden',
    pg_catalog.statement_timestamp(),
    NULL
  ),
  (
    '00000000-0000-4000-8000-000000018105',
    900000000000018105,
    'deleting_driver',
    'deletion_pending',
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000018106',
    900000000000018106,
    'enrolling_driver',
    'enrolling',
    NULL,
    NULL
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
VALUES
  (
    pg_temp.public_score_date(-14),
    '00000000-0000-4000-8000-000000018102',
    400,
    4,
    2,
    1,
    1,
    pg_catalog.statement_timestamp()
  ),
  (
    pg_temp.public_score_date(-14),
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
WHERE season_start = pg_temp.public_score_date(-14);

SET LOCAL ROLE viberacing_web;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 2
      AND pg_catalog.bool_and(season_finalized)
      AND pg_catalog.bool_and(season_end = pg_temp.public_score_date(-8))
      AND pg_catalog.bool_and(score_version = 'community_v1')
    FROM viberacing_api.list_public_community_scores(
      pg_temp.public_score_date(-14),
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

ROLLBACK;
