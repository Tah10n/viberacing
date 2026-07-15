\set ON_ERROR_STOP on

-- Every value below is a deterministic synthetic fixture. The transaction is always rolled back.
-- This file exercises only the persistent origin-proof replay boundary.

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

SET LOCAL ROLE viberacing_ingest;

SELECT pg_temp.assert_true(
  viberacing_api.consume_origin_nonce(
    'edge_primary',
    pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex'),
    pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()) + INTERVAL '60 seconds'
  ),
  'the first valid origin proof consumes its key-bound nonce'
);

SELECT pg_temp.assert_true(
  NOT viberacing_api.consume_origin_nonce(
    'edge_primary',
    pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex'),
    pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()) + INTERVAL '60 seconds'
  ),
  'an unexpired exact replay is rejected without an exception oracle'
);

SELECT pg_temp.assert_true(
  viberacing_api.consume_origin_nonce(
    'edge_secondary',
    pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex'),
    pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()) + INTERVAL '60 seconds'
  ),
  'the same digest remains independent under a different reviewed origin key id'
);

SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.origin_nonces (origin_key_id, nonce_digest, expires_at)
VALUES (
  'edge_expired',
  pg_catalog.decode(pg_catalog.repeat('22', 32), 'hex'),
  pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()) - INTERVAL '1 second'
);

SET LOCAL ROLE viberacing_ingest;

SELECT pg_temp.assert_true(
  viberacing_api.consume_origin_nonce(
    'edge_expired',
    pg_catalog.decode(pg_catalog.repeat('22', 32), 'hex'),
    pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()) + INTERVAL '60 seconds'
  ),
  'an expired tuple can be replaced atomically by a fresh proof'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.consume_origin_nonce(
      'primary',
      pg_catalog.decode(pg_catalog.repeat('33', 32), 'hex'),
      pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()) + INTERVAL '60 seconds'
    )
  $sql$,
  'a malformed origin key id fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.consume_origin_nonce(
      'edge_primary',
      pg_catalog.decode(pg_catalog.repeat('33', 31), 'hex'),
      pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()) + INTERVAL '60 seconds'
    )
  $sql$,
  'a non-SHA-256 digest length fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.consume_origin_nonce(
      'edge_primary',
      pg_catalog.decode(pg_catalog.repeat('44', 32), 'hex'),
      pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()) - INTERVAL '1 second'
    )
  $sql$,
  'an already expired proof fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.consume_origin_nonce(
      'edge_primary',
      pg_catalog.decode(pg_catalog.repeat('55', 32), 'hex'),
      pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()) + INTERVAL '66 seconds'
    )
  $sql$,
  'an expiry outside the bounded proof lifetime fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.consume_origin_nonce(
      'edge_primary',
      pg_catalog.decode(pg_catalog.repeat('66', 32), 'hex'),
      pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp())
        + INTERVAL '60 seconds 1 microsecond'
    )
  $sql$,
  'a sub-millisecond expiry fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.consume_origin_nonce(
      NULL,
      pg_catalog.decode(pg_catalog.repeat('77', 32), 'hex'),
      pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()) + INTERVAL '60 seconds'
    )
  $sql$,
  'a null origin key id fails closed'
);

SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 3
    FROM viberacing_private.origin_nonces
  )
  AND (
    SELECT pg_catalog.count(*) = 1
    FROM viberacing_private.origin_nonces
    WHERE origin_key_id = 'edge_expired'
      AND expires_at > pg_catalog.clock_timestamp()
  ),
  'rejections add no rows and expired replacement leaves one live tuple'
);

ROLLBACK;
