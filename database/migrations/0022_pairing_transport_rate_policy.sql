\set ON_ERROR_STOP on

-- Revision 0022: fixed-storage distributed rate windows for anonymous pairing transport.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

CREATE TABLE viberacing_private.pairing_request_windows (
  operation varchar(5) NOT NULL,
  bucket smallint NOT NULL,
  window_started_at timestamptz(3) NOT NULL,
  attempt_count integer NOT NULL,
  CONSTRAINT pairing_request_windows_operation CHECK (operation IN ('start', 'poll')),
  CONSTRAINT pairing_request_windows_bucket CHECK (bucket BETWEEN -1 AND 63),
  CONSTRAINT pairing_request_windows_attempt_count CHECK (
    attempt_count BETWEEN 0 AND 1000001
  ),
  CONSTRAINT pairing_request_windows_identity PRIMARY KEY (operation, bucket)
);

INSERT INTO viberacing_private.pairing_request_windows (
  operation,
  bucket,
  window_started_at,
  attempt_count
)
SELECT
  operation_record.operation,
  bucket_record.bucket,
  TIMESTAMPTZ '1970-01-01 00:00:00+00',
  0
FROM (
  VALUES ('poll'::varchar(5)), ('start'::varchar(5))
) AS operation_record(operation)
CROSS JOIN pg_catalog.generate_series(-1, 63) AS bucket_record(bucket);

ALTER TABLE viberacing_private.pairing_request_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.pairing_request_windows FORCE ROW LEVEL SECURITY;
CREATE POLICY pairing_request_windows_owner_all
  ON viberacing_private.pairing_request_windows
  FOR ALL TO viberacing_owner USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE viberacing_private.pairing_request_windows
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

CREATE FUNCTION viberacing_api.admit_pairing_transport_request(
  p_operation text,
  p_client_identity_digest bytea,
  p_global_limit integer,
  p_bucket_limit integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '5s'
AS $function$
DECLARE
  now_at timestamptz(3) := pg_catalog.statement_timestamp();
  client_bucket smallint;
  global_allowed boolean;
  bucket_allowed boolean;
BEGIN
  IF p_operation IS NULL
    OR p_operation NOT IN ('start', 'poll')
    OR pg_catalog.octet_length(p_client_identity_digest) IS DISTINCT FROM 32
    OR p_global_limit IS NULL
    OR p_global_limit NOT BETWEEN 1 AND 1000000
    OR p_bucket_limit IS NULL
    OR p_bucket_limit NOT BETWEEN 1 AND p_global_limit
    OR p_window_seconds IS NULL
    OR p_window_seconds NOT BETWEEN 1 AND 3600 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  client_bucket := (pg_catalog.get_byte(p_client_identity_digest, 0) % 64)::smallint;

  -- Every caller takes the global row before its fixed client bucket so concurrent requests have
  -- one deterministic lock order. Counts saturate one above the configured limit.
  UPDATE viberacing_private.pairing_request_windows AS window_record
  SET
    window_started_at = CASE
      WHEN window_record.window_started_at
        + pg_catalog.make_interval(secs => p_window_seconds) <= now_at
        THEN now_at
      ELSE window_record.window_started_at
    END,
    attempt_count = CASE
      WHEN window_record.window_started_at
        + pg_catalog.make_interval(secs => p_window_seconds) <= now_at
        THEN 1
      ELSE LEAST(window_record.attempt_count + 1, 1000001)
    END
  WHERE window_record.operation = p_operation
    AND window_record.bucket = -1
  RETURNING window_record.attempt_count <= p_global_limit
  INTO global_allowed;

  UPDATE viberacing_private.pairing_request_windows AS window_record
  SET
    window_started_at = CASE
      WHEN window_record.window_started_at
        + pg_catalog.make_interval(secs => p_window_seconds) <= now_at
        THEN now_at
      ELSE window_record.window_started_at
    END,
    attempt_count = CASE
      WHEN window_record.window_started_at
        + pg_catalog.make_interval(secs => p_window_seconds) <= now_at
        THEN 1
      ELSE LEAST(window_record.attempt_count + 1, 1000001)
    END
  WHERE window_record.operation = p_operation
    AND window_record.bucket = client_bucket
  RETURNING window_record.attempt_count <= p_bucket_limit
  INTO bucket_allowed;

  IF global_allowed IS NULL OR bucket_allowed IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  RETURN global_allowed AND bucket_allowed;
EXCEPTION
  WHEN data_exception OR integrity_constraint_violation OR lock_not_available THEN
    PERFORM viberacing_private.operation_failed();
    RETURN false;
END
$function$;

-- A connector may lose the first successful activation response. Keep the exact unexpired
-- challenge and key readable for an already activated binding so a retry can re-prove possession
-- before the Web application returns source/device identifiers.
CREATE OR REPLACE FUNCTION viberacing_api.read_pairing_verification_material(
  p_poll_verifier_digest bytea
)
RETURNS TABLE (
  pairing_id uuid,
  pairing_challenge bytea,
  public_key bytea,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF pg_catalog.octet_length(p_poll_verifier_digest) IS DISTINCT FROM 32 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  RETURN QUERY
  SELECT
    pairing_record.pairing_id,
    pairing_record.challenge,
    key_record.public_key,
    pairing_record.expires_at
  FROM viberacing_private.pairing_transactions AS pairing_record
  JOIN viberacing_private.device_keys AS key_record
    ON key_record.device_key_id = pairing_record.pending_device_key_id
  WHERE pairing_record.poll_verifier_digest = p_poll_verifier_digest
    AND pairing_record.expires_at >= pg_catalog.statement_timestamp()
    AND (
      (pairing_record.state = 'approved' AND key_record.state = 'pending')
      OR (pairing_record.state = 'activated' AND key_record.state = 'active')
    );
END
$function$;

REVOKE EXECUTE ON FUNCTION viberacing_api.admit_pairing_transport_request(
  text, bytea, integer, integer, integer
) FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

GRANT EXECUTE ON FUNCTION viberacing_api.admit_pairing_transport_request(
  text, bytea, integer, integer, integer
) TO viberacing_web;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (22, 'pairing_transport_rate_policy');

COMMIT;
