\set ON_ERROR_STOP on

-- Deterministic historical-season backlog evidence. The transaction is always rolled back. It
-- proves only one bounded data-backed finalization step, not a deployed cadence or capacity.
-- cspell:ignore indisready indisvalid indnkeyatts indpred indexdef indexprs indexrelid indrelid

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

CREATE FUNCTION pg_temp.backlog_season(p_weeks_ago integer)
RETURNS date
LANGUAGE sql
STABLE
AS $function$
  SELECT pg_catalog.current_setting('viberacing.test_week_start')::date - p_weeks_ago * 7
$function$;

SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  pg_catalog.has_function_privilege(
    'viberacing_jobs',
    'viberacing_api.finalize_community_season_backlog()',
    'EXECUTE'
  )
  AND NOT pg_catalog.has_function_privilege(
    'viberacing_web',
    'viberacing_api.finalize_community_season_backlog()',
    'EXECUTE'
  )
  AND NOT pg_catalog.has_function_privilege(
    'viberacing_ingest',
    'viberacing_api.finalize_community_season_backlog()',
    'EXECUTE'
  )
  AND NOT pg_catalog.has_function_privilege(
    'viberacing_admin',
    'viberacing_api.finalize_community_season_backlog()',
    'EXECUTE'
  ),
  'only Jobs can execute the historical season backlog capability'
);

SELECT pg_temp.assert_true(
  (
    SELECT index_record.indisvalid AND index_record.indisready
    FROM pg_catalog.pg_class AS index_class
    JOIN pg_catalog.pg_index AS index_record
      ON index_record.indexrelid = index_class.oid
    WHERE index_class.oid = pg_catalog.to_regclass(
      'viberacing_private.source_day_values_date_idx'
    )
  )
  AND (
    SELECT pg_catalog.count(*) = 1
    FROM pg_catalog.pg_index AS index_record
    WHERE index_record.indrelid = 'viberacing_private.source_day_values'::regclass
      AND index_record.indexprs IS NULL
      AND index_record.indpred IS NULL
      AND index_record.indnkeyatts = 2
      AND pg_catalog.pg_get_indexdef(index_record.indexrelid, 1, true) = 'codex_reported_date'
      AND pg_catalog.pg_get_indexdef(index_record.indexrelid, 2, true) = 'source_id'
  )
  AND (
    SELECT index_record.indisvalid
      AND index_record.indisready
      AND index_record.indpred IS NOT NULL
    FROM pg_catalog.pg_class AS index_class
    JOIN pg_catalog.pg_index AS index_record
      ON index_record.indexrelid = index_class.oid
    WHERE index_class.oid = pg_catalog.to_regclass(
      'viberacing_private.seasons_open_backlog_start_idx'
    )
  ),
  'the backlog capability reuses one source-date index and adds one open-season index'
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT finalized_season_count = 0 AND profile_count = 0
    FROM viberacing_api.finalize_community_season_backlog()
  ),
  'an empty backlog returns one exact zero result'
);

SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (profile_id, github_user_id, handle, state)
VALUES (
  '00000000-0000-4000-8000-000000040101',
  900000000000040101,
  'backlog-driver',
  'active'
);

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES (
  'src_' || pg_catalog.repeat('B', 22),
  '00000000-0000-4000-8000-000000040101'
);

INSERT INTO viberacing_private.seasons (
  season_start,
  season_end,
  score_version,
  created_at,
  grace_ends_at
)
VALUES (
  pg_temp.backlog_season(5),
  pg_temp.backlog_season(5) + 6,
  'community_v1',
  viberacing_private.community_season_grace_ends_at(pg_temp.backlog_season(5))
    - INTERVAL '10 days',
  viberacing_private.community_season_grace_ends_at(pg_temp.backlog_season(5))
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
    'src_' || pg_catalog.repeat('B', 22),
    pg_temp.backlog_season(4),
    10000,
    'syn_' || pg_catalog.repeat('B', 22),
    'dev_' || pg_catalog.repeat('B', 22),
    viberacing_private.community_season_grace_ends_at(pg_temp.backlog_season(4))
      - INTERVAL '1 day',
    viberacing_private.community_season_grace_ends_at(pg_temp.backlog_season(4))
      - INTERVAL '1 hour'
  ),
  (
    'src_' || pg_catalog.repeat('B', 22),
    pg_temp.backlog_season(0),
    20000,
    'syn_' || pg_catalog.repeat('C', 22),
    'dev_' || pg_catalog.repeat('B', 22),
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp()
  );

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT finalized_season_count = 1 AND profile_count = 0
    FROM viberacing_api.finalize_community_season_backlog()
  ),
  'the oldest known no-data open season is finalized first'
);

SELECT pg_temp.assert_true(
  (
    SELECT finalized_season_count = 1 AND profile_count = 1
    FROM viberacing_api.finalize_community_season_backlog()
  ),
  'the next data-backed missing season is materialized and finalized once'
);

SELECT pg_temp.assert_true(
  (
    SELECT finalized_season_count = 0 AND profile_count = 0
    FROM viberacing_api.finalize_community_season_backlog()
  ),
  'a drained eligible backlog converges on the exact zero result'
);

SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 2
    FROM viberacing_private.seasons AS season_record
    WHERE season_record.season_start IN (
        pg_temp.backlog_season(5),
        pg_temp.backlog_season(4)
      )
      AND season_record.state = 'finalized'
      AND season_record.finalized_at IS NOT NULL
  )
  AND (
    SELECT pg_catalog.count(*) = 1
    FROM viberacing_private.season_entries AS entry_record
    WHERE entry_record.season_start = pg_temp.backlog_season(4)
      AND entry_record.profile_id = '00000000-0000-4000-8000-000000040101'
  )
  AND (
    SELECT pg_catalog.count(*) = 7
    FROM viberacing_private.season_daily_scores AS score_record
    WHERE score_record.season_start = pg_temp.backlog_season(4)
      AND score_record.profile_id = '00000000-0000-4000-8000-000000040101'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.seasons AS season_record
    WHERE season_record.season_start = pg_temp.backlog_season(0)
  ),
  'backlog progress is terminal, exact, and does not close the current week'
);

SET LOCAL ROLE viberacing_web;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.finalize_community_season_backlog()$sql$,
  'Web cannot finalize the historical season backlog'
);
SET LOCAL ROLE viberacing_ingest;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.finalize_community_season_backlog()$sql$,
  'Ingest cannot finalize the historical season backlog'
);
SET LOCAL ROLE viberacing_admin;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.finalize_community_season_backlog()$sql$,
  'Admin cannot finalize the historical season backlog'
);

SET LOCAL ROLE viberacing_owner;
DELETE FROM viberacing_private.maintenance_locks
WHERE capability = 'community_scoring_refresh';
SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.finalize_community_season_backlog()$sql$,
  'a missing scoring mutex fails backlog finalization closed'
);

ROLLBACK;
