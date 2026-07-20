\set ON_ERROR_STOP on

-- Read-only assertions over the two serialized backlog-worker results. The enclosing integration
-- project is ephemeral and is destroyed immediately after the complete test run.

SET ROLE viberacing_owner;

DO $assertion$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.seasons AS season_record
    WHERE season_record.season_start IN (DATE '2001-01-01', DATE '2001-01-08')
      AND season_record.state = 'finalized'
      AND season_record.finalized_at IS NOT NULL
  ) <> 2
    OR (
      SELECT pg_catalog.count(*)
      FROM viberacing_private.season_entries AS entry_record
      WHERE entry_record.season_start IN (DATE '2001-01-01', DATE '2001-01-08')
        AND entry_record.profile_id = '00000000-0000-4000-8000-000000040201'
    ) <> 2
    OR (
      SELECT pg_catalog.count(*)
      FROM viberacing_private.season_daily_scores AS score_record
      WHERE score_record.season_start IN (DATE '2001-01-01', DATE '2001-01-08')
        AND score_record.profile_id = '00000000-0000-4000-8000-000000040201'
    ) <> 14 THEN
    RAISE EXCEPTION 'serialized backlog workers did not finalize exactly two oldest seasons';
  END IF;
END
$assertion$;

RESET ROLE;
