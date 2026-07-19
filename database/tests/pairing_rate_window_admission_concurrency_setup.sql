\set ON_ERROR_STOP on

-- Assert the completed worker race and arm a distinct reset-versus-live-admission race.

BEGIN;
SET LOCAL ROLE viberacing_owner;

DO $assertion$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.pairing_request_windows
    WHERE operation = 'poll'
      AND bucket IN (-1, 2)
      AND window_started_at = TIMESTAMPTZ '1970-01-01 00:00:00+00'
      AND attempt_count = 0
  ) <> 2 THEN
    RAISE EXCEPTION 'concurrent rate-window reset workers did not converge on scrubbed rows';
  END IF;
END
$assertion$;

UPDATE viberacing_private.pairing_request_windows
SET
  window_started_at = pg_catalog.statement_timestamp() - INTERVAL '2 hours',
  attempt_count = CASE bucket WHEN -1 THEN 19 ELSE 8 END
WHERE operation = 'start'
  AND bucket IN (-1, 1);

COMMIT;
