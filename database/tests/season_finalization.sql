\set ON_ERROR_STOP on

-- Deterministic synthetic finalization fixtures. The transaction is always rolled back. Historical
-- accepted source/day state is seeded as owner because the production Ingest procedure correctly
-- refuses to create accepted state after the server-side grace deadline.

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
    SET CONSTRAINTS ALL IMMEDIATE;
  EXCEPTION
    WHEN integrity_constraint_violation THEN
      RETURN;
  END;

  RAISE EXCEPTION 'expected integrity failure: %', label;
END
$function$;

CREATE FUNCTION pg_temp.closed_season_date(p_day_offset integer)
RETURNS date
LANGUAGE sql
STABLE
AS $function$
  SELECT pg_catalog.current_setting('viberacing.test_week_start')::date - 14 + p_day_offset
$function$;

CREATE FUNCTION pg_temp.current_season_date(p_day_offset integer)
RETURNS date
LANGUAGE sql
STABLE
AS $function$
  SELECT pg_catalog.current_setting('viberacing.test_week_start')::date + p_day_offset
$function$;

SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  viberacing_private.community_season_grace_ends_at(DATE '2026-07-06')
    = TIMESTAMPTZ '2026-07-15T00:00:00.000Z'
  AND NOT viberacing_private.community_season_is_closed(
    DATE '2026-07-06',
    TIMESTAMPTZ '2026-07-14T23:59:59.999Z'
  )
  AND viberacing_private.community_season_is_closed(
    DATE '2026-07-06',
    TIMESTAMPTZ '2026-07-15T00:00:00.000Z'
  ),
  'the 48-hour grace boundary closes exactly at Wednesday 00:00 UTC'
);

INSERT INTO viberacing_private.profiles (profile_id, github_user_id, handle, state)
VALUES
  (
    '00000000-0000-4000-8000-000000016101',
    900000000000016101,
    'finalized-driver',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000016102',
    900000000000016102,
    'late-driver',
    'active'
  );

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES
  (
    'src_' || pg_catalog.repeat('J', 22),
    '00000000-0000-4000-8000-000000016101'
  ),
  (
    'src_' || pg_catalog.repeat('K', 22),
    '00000000-0000-4000-8000-000000016102'
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
    '00000000-0000-4000-8000-000000016401',
    'dev_' || pg_catalog.repeat('J', 22),
    'src_' || pg_catalog.repeat('J', 22),
    pg_catalog.decode(pg_catalog.lpad('16401', 64, '0'), 'hex'),
    'Historical finalization connector',
    '1.2.3',
    'linux',
    'x86_64',
    'active',
    pg_catalog.statement_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000016402',
    'dev_' || pg_catalog.repeat('K', 22),
    'src_' || pg_catalog.repeat('K', 22),
    pg_catalog.decode(pg_catalog.lpad('16402', 64, '0'), 'hex'),
    'Late finalization connector',
    '1.2.3',
    'linux',
    'x86_64',
    'active',
    pg_catalog.statement_timestamp()
  );

INSERT INTO viberacing_private.usage_snapshots (
  usage_snapshot_id,
  device_key_id,
  device_id,
  source_id,
  sync_id,
  observed_at,
  connector_version,
  codex_version,
  body_digest,
  signature,
  nonce_digest,
  outcome,
  quarantine_reason,
  entry_count,
  received_at,
  retention_expires_at
)
VALUES (
  '00000000-0000-4000-8000-000000016501',
  '00000000-0000-4000-8000-000000016401',
  'dev_' || pg_catalog.repeat('J', 22),
  'src_' || pg_catalog.repeat('J', 22),
  'syn_' || pg_catalog.repeat('J', 22),
  viberacing_private.community_season_grace_ends_at(pg_temp.closed_season_date(0))
    - INTERVAL '1 hour',
  '1.2.3',
  '4.5.6',
  pg_catalog.decode(pg_catalog.lpad('16501', 64, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('26501', 128, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('36501', 64, '0'), 'hex'),
  'accepted',
  NULL,
  1,
  viberacing_private.community_season_grace_ends_at(pg_temp.closed_season_date(0))
    - INTERVAL '1 hour',
  viberacing_private.community_season_grace_ends_at(pg_temp.closed_season_date(0))
    + INTERVAL '30 days'
);

INSERT INTO viberacing_private.usage_snapshot_entries (
  usage_snapshot_id,
  codex_reported_date,
  tokens
)
VALUES (
  '00000000-0000-4000-8000-000000016501',
  pg_temp.closed_season_date(0),
  10000
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
  'src_' || pg_catalog.repeat('J', 22),
  pg_temp.closed_season_date(0),
  10000,
  '00000000-0000-4000-8000-000000016501',
  'syn_' || pg_catalog.repeat('J', 22),
  'dev_' || pg_catalog.repeat('J', 22),
  viberacing_private.community_season_grace_ends_at(pg_temp.closed_season_date(0))
    - INTERVAL '1 hour',
  viberacing_private.community_season_grace_ends_at(pg_temp.closed_season_date(0))
    - INTERVAL '1 hour'
);

-- Finalize one explicitly preserved legacy season so the compatibility assertions remain stable
-- after the direct-token cutover and on every later calendar date.
INSERT INTO viberacing_private.seasons (
  season_start,
  season_end,
  score_version,
  state,
  grace_ends_at
)
VALUES (
  pg_temp.closed_season_date(0),
  pg_temp.closed_season_date(6),
  'community_v1',
  'open',
  viberacing_private.community_season_grace_ends_at(pg_temp.closed_season_date(0))
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT profile_count = 1 AND finalized_at IS NOT NULL
    FROM viberacing_api.finalize_community_season(pg_temp.closed_season_date(0))
  ),
  'Jobs atomically materializes and finalizes one closed Community season'
);

SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.set_config(
  'viberacing.test_finalized_at',
  season_record.finalized_at::text,
  false
)
FROM viberacing_private.seasons AS season_record
WHERE season_record.season_start = pg_temp.closed_season_date(0);

SELECT pg_temp.assert_true(
  (
    SELECT state = 'finalized'
      AND season_end = pg_temp.closed_season_date(6)
      AND score_version = 'community_v1'
      AND grace_ends_at = viberacing_private.community_season_grace_ends_at(
        pg_temp.closed_season_date(0)
      )
      AND finalized_at >= grace_ends_at
      AND finalized_at >= refreshed_at
    FROM viberacing_private.seasons
    WHERE season_start = pg_temp.closed_season_date(0)
  )
  AND (
    SELECT weekly_score = 173
      AND active_days = 1
      AND contributing_source_count = 1
      AND rank_position = 1
      AND display_order = 1
    FROM viberacing_private.season_entries
    WHERE season_start = pg_temp.closed_season_date(0)
      AND profile_id = '00000000-0000-4000-8000-000000016101'
  )
  AND (
    SELECT pg_catalog.count(*) = 7
      AND pg_catalog.max(daily_score) = 173
      AND pg_catalog.min(daily_score) = 0
    FROM viberacing_private.season_daily_scores
    WHERE season_start = pg_temp.closed_season_date(0)
      AND profile_id = '00000000-0000-4000-8000-000000016101'
  ),
  'the finalized projection preserves its exact definition, formula, and seven daily rows'
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT result.profile_count = 1
      AND result.finalized_at = pg_catalog.current_setting(
        'viberacing.test_finalized_at'
      )::timestamptz
    FROM viberacing_api.finalize_community_season(
      pg_temp.closed_season_date(0)
    ) AS result
  ),
  'an exact finalization retry returns the original terminal result'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT *
    FROM viberacing_api.refresh_community_season(pg_temp.closed_season_date(0))
  $sql$,
  'an open-season refresh cannot reopen a finalized season'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT *
    FROM viberacing_api.finalize_community_season(pg_temp.current_season_date(0))
  $sql$,
  'Jobs cannot finalize before the server grace deadline'
);

SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.finalize_community_season(DATE '2100-01-04')$sql$,
  'Jobs cannot grow season state outside the bounded ConnectorSync calendar'
);

SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM viberacing_private.seasons
    WHERE season_start = pg_temp.current_season_date(0)
  ),
  'an early finalization failure creates no season state'
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT profile_count = 0 AND finalized_at IS NOT NULL
    FROM viberacing_api.finalize_community_season(pg_temp.closed_season_date(-7))
  ),
  'Jobs records one bounded terminal season when a closed week has no source state'
);

SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT state = 'finalized'
      AND finalized_at >= grace_ends_at
    FROM viberacing_private.seasons
    WHERE season_start = pg_temp.closed_season_date(-7)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.season_entries
    WHERE season_start = pg_temp.closed_season_date(-7)
  ),
  'no-data closure persists only non-personal terminal metadata'
);

SET LOCAL ROLE viberacing_ingest;

SELECT pg_temp.assert_true(
  (
    SELECT outcome = 'quarantined' AND accepted_entries = 0
    FROM viberacing_api.submit_usage_sync(
      '00000000-0000-4000-8000-000000016402',
      'dev_' || pg_catalog.repeat('K', 22),
      'src_' || pg_catalog.repeat('K', 22),
      'codex',
      'codex_daily_usage_buckets_v1',
      '00000000-0000-4000-8000-000000016502',
      'syn_' || pg_catalog.repeat('K', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.transaction_timestamp()),
      '1.2.3',
      '4.5.6',
      pg_catalog.decode(pg_catalog.lpad('16502', 64, '0'), 'hex'),
      pg_catalog.decode(pg_catalog.lpad('26502', 128, '0'), 'hex'),
      pg_catalog.decode(pg_catalog.lpad('36502', 64, '0'), 'hex'),
      ARRAY[pg_temp.closed_season_date(0)::text],
      ARRAY[9007199254740991]::bigint[]
    )
  ),
  'server receive time quarantines a post-grace payload regardless of its reported date'
);

SELECT pg_temp.assert_true(
  (
    SELECT outcome = 'duplicate' AND accepted_entries = 0
    FROM viberacing_api.submit_usage_sync(
      '00000000-0000-4000-8000-000000016402',
      'dev_' || pg_catalog.repeat('K', 22),
      'src_' || pg_catalog.repeat('K', 22),
      'codex',
      'codex_daily_usage_buckets_v1',
      '00000000-0000-4000-8000-000000016502',
      'syn_' || pg_catalog.repeat('K', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.transaction_timestamp()),
      '1.2.3',
      '4.5.6',
      pg_catalog.decode(pg_catalog.lpad('16502', 64, '0'), 'hex'),
      pg_catalog.decode(pg_catalog.lpad('26502', 128, '0'), 'hex'),
      pg_catalog.decode(pg_catalog.lpad('36502', 64, '0'), 'hex'),
      ARRAY[pg_temp.closed_season_date(0)::text],
      ARRAY[9007199254740991]::bigint[]
    )
  ),
  'an exact retry remains idempotent after season closure'
);

SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT outcome = 'quarantined'
      AND quarantine_reason = 'season_closed'
      AND received_at >= viberacing_private.community_season_grace_ends_at(
        pg_temp.closed_season_date(0)
      )
      AND entry_count = 1
    FROM viberacing_private.usage_snapshots
    WHERE usage_snapshot_id = '00000000-0000-4000-8000-000000016502'
  )
  AND (
    SELECT pg_catalog.count(*) = 1
    FROM viberacing_private.usage_snapshot_entries
    WHERE usage_snapshot_id = '00000000-0000-4000-8000-000000016502'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.source_day_values
    WHERE source_id = 'src_' || pg_catalog.repeat('K', 22)
      AND codex_reported_date = pg_temp.closed_season_date(0)
  ),
  'late evidence is retained but cannot change accepted source-day state'
);

UPDATE viberacing_private.codex_sources
SET state = 'quarantined',
  state_changed_at = pg_catalog.statement_timestamp()
WHERE source_id = 'src_' || pg_catalog.repeat('K', 22);

SET LOCAL ROLE viberacing_ingest;

SELECT pg_temp.assert_true(
  (
    SELECT outcome = 'quarantined' AND accepted_entries = 0
    FROM viberacing_api.submit_usage_sync(
      '00000000-0000-4000-8000-000000016402',
      'dev_' || pg_catalog.repeat('K', 22),
      'src_' || pg_catalog.repeat('K', 22),
      'codex',
      'codex_daily_usage_buckets_v1',
      '00000000-0000-4000-8000-000000016503',
      'syn_' || pg_catalog.repeat('R', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()),
      '1.2.3',
      '4.5.6',
      pg_catalog.decode(pg_catalog.lpad('16503', 64, '0'), 'hex'),
      pg_catalog.decode(pg_catalog.lpad('26503', 128, '0'), 'hex'),
      pg_catalog.decode(pg_catalog.lpad('36503', 64, '0'), 'hex'),
      ARRAY[pg_temp.closed_season_date(0)::text],
      ARRAY[9007199254740991]::bigint[]
    )
  ),
  'season closure still quarantines a payload from an already quarantined source'
);

SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT quarantine_reason = 'season_closed'
    FROM viberacing_private.usage_snapshots
    WHERE usage_snapshot_id = '00000000-0000-4000-8000-000000016503'
  ),
  'season_closed takes precedence when more than one quarantine condition applies'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    UPDATE viberacing_private.seasons
    SET refreshed_at = refreshed_at + INTERVAL '1 millisecond'
    WHERE season_start = pg_temp.closed_season_date(0)
  $sql$,
  'a finalized season timestamp cannot be rewritten'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    DELETE FROM viberacing_private.seasons
    WHERE season_start = pg_temp.closed_season_date(0)
  $sql$,
  'a finalized season definition cannot be deleted'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    UPDATE viberacing_private.season_entries
    SET weekly_score = weekly_score + 1
    WHERE season_start = pg_temp.closed_season_date(0)
      AND profile_id = '00000000-0000-4000-8000-000000016101'
  $sql$,
  'a finalized weekly entry cannot be edited'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    DELETE FROM viberacing_private.season_entries
    WHERE season_start = pg_temp.closed_season_date(0)
      AND profile_id = '00000000-0000-4000-8000-000000016101'
  $sql$,
  'a finalized weekly entry cannot be deleted outside profile purge'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    UPDATE viberacing_private.season_daily_scores
    SET daily_score = daily_score + 1
    WHERE season_start = pg_temp.closed_season_date(0)
      AND profile_id = '00000000-0000-4000-8000-000000016101'
      AND score_date = pg_temp.closed_season_date(0)
  $sql$,
  'a finalized daily score cannot be edited'
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    DELETE FROM viberacing_private.season_daily_scores
    WHERE season_start = pg_temp.closed_season_date(0)
      AND profile_id = '00000000-0000-4000-8000-000000016101'
      AND score_date = pg_temp.closed_season_date(0)
  $sql$,
  'a finalized daily score cannot be deleted outside profile purge'
);

INSERT INTO viberacing_private.seasons (
  season_start,
  season_end,
  score_version,
  state,
  grace_ends_at
)
VALUES (
  pg_temp.current_season_date(0),
  pg_temp.current_season_date(6),
  'community_v1',
  'open',
  viberacing_private.community_season_grace_ends_at(
    pg_temp.current_season_date(0)
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
  pg_temp.current_season_date(0),
  '00000000-0000-4000-8000-000000016101',
  0,
  0,
  0,
  1,
  1,
  pg_catalog.statement_timestamp()
);

SELECT pg_temp.expect_integrity_failure(
  $sql$
    UPDATE viberacing_private.season_daily_scores
    SET season_start = pg_temp.current_season_date(0),
      score_date = pg_temp.current_season_date(0)
    WHERE season_start = pg_temp.closed_season_date(0)
      AND profile_id = '00000000-0000-4000-8000-000000016101'
      AND score_date = pg_temp.closed_season_date(0)
  $sql$,
  'a finalized daily score cannot be moved into a valid open-season entry'
);

UPDATE viberacing_private.profiles
SET state = 'deletion_pending',
  hidden_at = pg_catalog.statement_timestamp(),
  deletion_requested_at = pg_catalog.statement_timestamp()
WHERE profile_id = '00000000-0000-4000-8000-000000016101';

DELETE FROM viberacing_private.profiles
WHERE profile_id = '00000000-0000-4000-8000-000000016101';

SELECT pg_temp.assert_true(
  (
    SELECT state = 'finalized'
      AND finalized_at = pg_catalog.current_setting(
        'viberacing.test_finalized_at'
      )::timestamptz
    FROM viberacing_private.seasons
    WHERE season_start = pg_temp.closed_season_date(0)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.season_entries
    WHERE season_start = pg_temp.closed_season_date(0)
      AND profile_id = '00000000-0000-4000-8000-000000016101'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.season_daily_scores
    WHERE season_start = pg_temp.closed_season_date(0)
      AND profile_id = '00000000-0000-4000-8000-000000016101'
  ),
  'profile purge removes personal finalized rows without reopening the season'
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT result.profile_count = 0
      AND result.finalized_at = pg_catalog.current_setting(
        'viberacing.test_finalized_at'
      )::timestamptz
    FROM viberacing_api.finalize_community_season(
      pg_temp.closed_season_date(0)
    ) AS result
  ),
  'an idempotent rerun observes profile purge without rewriting terminal metadata'
);

ROLLBACK;
