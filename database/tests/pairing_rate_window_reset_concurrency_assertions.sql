\set ON_ERROR_STOP on

-- Read-only assertions over committed reset-versus-live-admission race state.

SET ROLE viberacing_owner;

DO $assertion$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.pairing_request_windows
  ) <> 130 THEN
    RAISE EXCEPTION 'rate-window races changed the fixed matrix size';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.pairing_request_windows
    WHERE operation = 'start'
      AND bucket IN (-1, 1)
      AND attempt_count = 1
      AND window_started_at > pg_catalog.statement_timestamp() - INTERVAL '5 minutes'
  ) <> 2 THEN
    RAISE EXCEPTION 'live admission did not survive the completed rate-window reset';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM viberacing_private.pairing_request_windows
    WHERE NOT (operation = 'start' AND bucket IN (-1, 1))
      AND (
        attempt_count <> 0
        OR window_started_at <> TIMESTAMPTZ '1970-01-01 00:00:00+00'
      )
  ) THEN
    RAISE EXCEPTION 'rate-window races changed an unrelated fixed row';
  END IF;
END
$assertion$;

RESET ROLE;
