\set ON_ERROR_STOP on

-- Every value below is a deterministic synthetic fixture. The transaction is always rolled back.

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

SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 130
      AND pg_catalog.count(*) FILTER (WHERE bucket = -1) = 2
      AND pg_catalog.count(*) FILTER (WHERE bucket BETWEEN 0 AND 63) = 128
    FROM viberacing_private.pairing_request_windows
  ),
  'pairing rate storage is a fixed 130-row matrix'
);

SELECT pg_temp.assert_true(
  (
    SELECT relrowsecurity AND relforcerowsecurity
    FROM pg_catalog.pg_class
    WHERE oid = 'viberacing_private.pairing_request_windows'::pg_catalog.regclass
  ),
  'pairing rate storage forces row-level security'
);

UPDATE viberacing_private.pairing_request_windows
SET
  window_started_at = pg_catalog.statement_timestamp(),
  attempt_count = 100
WHERE operation = 'start'
  AND bucket IN (-1, 1);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT pg_temp.assert_true(
  NOT viberacing_api.admit_pairing_transport_request(
    'start',
    pg_catalog.decode('01' || pg_catalog.repeat('00', 31), 'hex'),
    10,
    10,
    60
  ),
  'a lower deployment limit denies an existing high-count window'
);

SELECT pg_temp.assert_true(
  NOT viberacing_api.admit_pairing_transport_request(
    'start',
    pg_catalog.decode('01' || pg_catalog.repeat('00', 31), 'hex'),
    20,
    20,
    60
  ),
  'changing limits cannot lower a persisted counter and reopen the window'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

UPDATE viberacing_private.pairing_request_windows
SET
  window_started_at = TIMESTAMPTZ '1970-01-01 00:00:00+00',
  attempt_count = 0
WHERE operation = 'poll';

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT pg_temp.assert_true(
  viberacing_api.admit_pairing_transport_request(
    'poll',
    pg_catalog.decode('01' || pg_catalog.repeat('00', 31), 'hex'),
    3,
    1,
    60
  ),
  'the first global and fixed-bucket attempt is admitted'
);

SELECT pg_temp.assert_true(
  NOT viberacing_api.admit_pairing_transport_request(
    'poll',
    pg_catalog.decode('01' || pg_catalog.repeat('00', 31), 'hex'),
    3,
    1,
    60
  ),
  'the fixed client bucket denies a repeated anonymous identifier'
);

SELECT pg_temp.assert_true(
  viberacing_api.admit_pairing_transport_request(
    'poll',
    pg_catalog.decode('02' || pg_catalog.repeat('00', 31), 'hex'),
    3,
    1,
    60
  ),
  'a second fixed bucket remains available inside the global budget'
);

SELECT pg_temp.assert_true(
  NOT viberacing_api.admit_pairing_transport_request(
    'poll',
    pg_catalog.decode('03' || pg_catalog.repeat('00', 31), 'hex'),
    3,
    1,
    60
  ),
  'the global window limits identifier rotation'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.admit_pairing_transport_request(
      'other',
      pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex'),
      3,
      1,
      60
    )
  $sql$,
  'the operation allowlist is closed'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.admit_pairing_transport_request(
      'poll',
      pg_catalog.decode(pg_catalog.repeat('00', 31), 'hex'),
      3,
      1,
      60
    )
  $sql$,
  'the anonymous client digest length is exact'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

UPDATE viberacing_private.pairing_request_windows
SET
  window_started_at = pg_catalog.statement_timestamp() - INTERVAL '2 seconds',
  attempt_count = 100
WHERE operation = 'poll'
  AND bucket IN (-1, 1);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT pg_temp.assert_true(
  viberacing_api.admit_pairing_transport_request(
    'poll',
    pg_catalog.decode('01' || pg_catalog.repeat('00', 31), 'hex'),
    3,
    1,
    1
  ),
  'an expired global and bucket window resets atomically'
);

ROLLBACK;
