\set ON_ERROR_STOP on

-- Read-only assertions over committed synthetic session-cleanup race fixtures.

SET ROLE viberacing_owner;

DO $assertion$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM viberacing_private.sessions
    WHERE session_id IN (
      '00000000-0000-4000-8000-000000031201',
      '00000000-0000-4000-8000-000000031202'
    )
  ) THEN
    RAISE EXCEPTION 'concurrent session cleanup did not remove each expired batch once';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.sessions
    WHERE session_id = '00000000-0000-4000-8000-000000031203'
      AND state = 'active'
      AND expires_at > pg_catalog.statement_timestamp()
  ) THEN
    RAISE EXCEPTION 'concurrent session cleanup removed live authority';
  END IF;
END
$assertion$;

RESET ROLE;
