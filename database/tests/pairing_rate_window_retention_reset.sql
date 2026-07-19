\set ON_ERROR_STOP on

-- Deterministic synthetic evidence for bounded fixed pairing-rate-window reset. The transaction is
-- rolled back and does not imply a scheduler, trusted client identity, monitoring, or deployment.

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

CREATE FUNCTION pg_temp.expect_check_failure(statement text, label text)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION
    WHEN check_violation THEN
      RETURN;
  END;

  RAISE EXCEPTION 'expected check failure: %', label;
END
$function$;

SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 130
      AND pg_catalog.count(*) FILTER (WHERE bucket = -1) = 2
      AND pg_catalog.count(*) FILTER (WHERE bucket BETWEEN 0 AND 63) = 128
    FROM viberacing_private.pairing_request_windows
  ),
  'rate-window reset preserves the complete fixed matrix'
);

SELECT pg_temp.assert_true(
  pg_catalog.to_regprocedure(
    'viberacing_api.reset_expired_pairing_request_windows()'
  ) IS NOT NULL
  AND pg_catalog.to_regprocedure(
    'viberacing_api.reset_expired_pairing_request_windows(integer)'
  ) IS NULL,
  'rate-window reset exposes no caller-selected batch or cutoff'
);

SELECT pg_temp.assert_true(
  NOT pg_catalog.has_function_privilege(
    'public',
    'viberacing_api.reset_expired_pairing_request_windows()',
    'EXECUTE'
  ),
  'PUBLIC cannot execute rate-window reset'
);

UPDATE viberacing_private.pairing_request_windows
SET
  window_started_at = TIMESTAMPTZ '1970-01-01 00:00:00+00',
  attempt_count = 0;

UPDATE viberacing_private.pairing_request_windows
SET
  window_started_at = pg_catalog.statement_timestamp() - INTERVAL '61 minutes',
  attempt_count = CASE bucket WHEN -1 THEN 9 ELSE 4 END
WHERE operation = 'start'
  AND bucket IN (-1, 1);

UPDATE viberacing_private.pairing_request_windows
SET
  window_started_at = pg_catalog.statement_timestamp() - INTERVAL '59 minutes',
  attempt_count = CASE bucket WHEN -1 THEN 8 ELSE 3 END
WHERE operation = 'poll'
  AND bucket IN (-1, 2);

RESET ROLE;
SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT reset_windows = 2
    FROM viberacing_api.reset_expired_pairing_request_windows()
  ),
  'only windows older than the maximum accepted duration reset'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 2
    FROM viberacing_private.pairing_request_windows
    WHERE operation = 'start'
      AND bucket IN (-1, 1)
      AND window_started_at = TIMESTAMPTZ '1970-01-01 00:00:00+00'
      AND attempt_count = 0
  ),
  'eligible global and bucket rows are scrubbed in place'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 2
    FROM viberacing_private.pairing_request_windows
    WHERE operation = 'poll'
      AND bucket IN (-1, 2)
      AND window_started_at > pg_catalog.statement_timestamp() - INTERVAL '1 hour'
      AND attempt_count IN (3, 8)
  ),
  'recent rate windows and counts remain unchanged'
);

RESET ROLE;
SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT reset_windows = 0
    FROM viberacing_api.reset_expired_pairing_request_windows()
  ),
  'repeated reset is idempotent when no maximum-duration window expired'
);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT pg_temp.assert_true(
  viberacing_api.admit_pairing_transport_request(
    'start',
    pg_catalog.decode('01' || pg_catalog.repeat('00', 31), 'hex'),
    3,
    1,
    60
  ),
  'live admission starts a fresh window after Jobs reset'
);

SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.reset_expired_pairing_request_windows()$sql$,
  'Web cannot run rate-window reset'
);

RESET ROLE;
SET LOCAL ROLE viberacing_ingest;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.reset_expired_pairing_request_windows()$sql$,
  'Ingest cannot run rate-window reset'
);

RESET ROLE;
SET LOCAL ROLE viberacing_admin;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.reset_expired_pairing_request_windows()$sql$,
  'Admin cannot run rate-window reset'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.expect_check_failure(
  $sql$
    UPDATE viberacing_private.pairing_request_windows
    SET
      window_started_at = pg_catalog.statement_timestamp(),
      attempt_count = 0
    WHERE operation = 'poll'
      AND bucket = 63
  $sql$,
  'zero count cannot retain a rate-window timestamp'
);

UPDATE viberacing_private.pairing_request_windows
SET
  window_started_at = pg_catalog.statement_timestamp() - INTERVAL '2 hours',
  attempt_count = 11
WHERE operation = 'poll'
  AND bucket = 62;

DELETE FROM viberacing_private.pairing_request_windows
WHERE operation = 'poll'
  AND bucket = 63;

RESET ROLE;
SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.reset_expired_pairing_request_windows()$sql$,
  'a missing fixed matrix row fails reset closed before mutation'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;
SELECT pg_temp.assert_true(
  (
    SELECT attempt_count = 11
    FROM viberacing_private.pairing_request_windows
    WHERE operation = 'poll'
      AND bucket = 62
  ),
  'matrix drift leaves otherwise eligible state unchanged'
);

INSERT INTO viberacing_private.pairing_request_windows (
  operation,
  bucket,
  window_started_at,
  attempt_count
)
VALUES (
  'poll',
  63,
  TIMESTAMPTZ '1970-01-01 00:00:00+00',
  0
);

UPDATE viberacing_private.pairing_request_windows
SET
  window_started_at = TIMESTAMPTZ '1970-01-01 00:00:00+00',
  attempt_count = 0;

UPDATE viberacing_private.pairing_request_windows
SET
  window_started_at = pg_catalog.statement_timestamp() - INTERVAL '2 hours',
  attempt_count = 7
WHERE operation = 'start'
  AND bucket IN (-1, 0);

CREATE FUNCTION pg_temp.reject_second_rate_window_reset()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.operation = 'start' AND OLD.bucket = 0 AND NEW.attempt_count = 0 THEN
    RAISE EXCEPTION 'synthetic reset rollback' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER reject_second_rate_window_reset
BEFORE UPDATE ON viberacing_private.pairing_request_windows
FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_second_rate_window_reset();

RESET ROLE;
SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.reset_expired_pairing_request_windows()$sql$,
  'mid-batch constraint failure is generic and atomic'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;
SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 2
    FROM viberacing_private.pairing_request_windows
    WHERE operation = 'start'
      AND bucket IN (-1, 0)
      AND attempt_count = 7
      AND window_started_at < pg_catalog.statement_timestamp() - INTERVAL '1 hour'
  ),
  'a failed later row rolls back every earlier reset'
);

DROP TRIGGER reject_second_rate_window_reset
  ON viberacing_private.pairing_request_windows;
DROP FUNCTION pg_temp.reject_second_rate_window_reset();

RESET ROLE;
SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.assert_true(
  (
    SELECT reset_windows = 2
    FROM viberacing_api.reset_expired_pairing_request_windows()
  ),
  'eligible windows reset after rollback-only interference is removed'
);

ROLLBACK;
