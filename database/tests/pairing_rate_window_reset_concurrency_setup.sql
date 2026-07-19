\set ON_ERROR_STOP on

-- Synthetic fixed-row setup for the pairing-rate reset worker race. The isolated integration
-- database is portless, tmpfs-backed, and destroyed by the runner.

BEGIN;
SET LOCAL ROLE viberacing_owner;

UPDATE viberacing_private.pairing_request_windows
SET
  window_started_at = TIMESTAMPTZ '1970-01-01 00:00:00+00',
  attempt_count = 0;

UPDATE viberacing_private.pairing_request_windows
SET
  window_started_at = pg_catalog.statement_timestamp() - INTERVAL '2 hours',
  attempt_count = CASE bucket WHEN -1 THEN 17 ELSE 9 END
WHERE operation = 'poll'
  AND bucket IN (-1, 2);

COMMIT;
