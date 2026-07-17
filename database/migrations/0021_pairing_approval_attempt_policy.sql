\set ON_ERROR_STOP on

-- Revision 0021: session-bound distributed attempt policy for pairing approval lookup.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

ALTER TABLE viberacing_private.sessions
  ADD COLUMN pairing_approval_window_started_at timestamptz(3),
  ADD COLUMN pairing_approval_attempt_count integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT sessions_pairing_approval_attempt_shape CHECK (
    (
      pairing_approval_attempt_count = 0
      AND pairing_approval_window_started_at IS NULL
    )
    OR (
      pairing_approval_attempt_count BETWEEN 1 AND 1001
      AND pairing_approval_window_started_at IS NOT NULL
    )
  );

CREATE FUNCTION viberacing_api.read_pairing_for_approval_limited(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_primary_user_code_digest bytea,
  p_secondary_user_code_digest bytea,
  p_secondary_active boolean,
  p_attempt_limit integer,
  p_window_seconds integer
)
RETURNS TABLE (
  candidate_index smallint,
  pairing_id uuid,
  device_label text,
  connector_version text,
  os_family text,
  architecture text,
  public_key bytea,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $function$
DECLARE
  authenticated_profile_id uuid;
  attempt_count integer;
  candidate_record record;
  matching_count integer := 0;
  now_at timestamptz(3) := pg_catalog.statement_timestamp();
BEGIN
  IF p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32
    OR pg_catalog.octet_length(p_primary_user_code_digest) IS DISTINCT FROM 32
    OR pg_catalog.octet_length(p_secondary_user_code_digest) IS DISTINCT FROM 32
    OR p_secondary_active IS NULL
    OR p_attempt_limit IS NULL
    OR p_attempt_limit NOT BETWEEN 1 AND 1000
    OR p_window_seconds IS NULL
    OR p_window_seconds NOT BETWEEN 1 AND 86400 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  authenticated_profile_id := viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest,
    ARRAY['active']
  );

  UPDATE viberacing_private.sessions AS session_record
  SET
    pairing_approval_window_started_at = CASE
      WHEN session_record.pairing_approval_window_started_at IS NULL
        OR session_record.pairing_approval_window_started_at
          + pg_catalog.make_interval(secs => p_window_seconds) <= now_at
        THEN now_at
      ELSE session_record.pairing_approval_window_started_at
    END,
    pairing_approval_attempt_count = CASE
      WHEN session_record.pairing_approval_window_started_at IS NULL
        OR session_record.pairing_approval_window_started_at
          + pg_catalog.make_interval(secs => p_window_seconds) <= now_at
        THEN 1
      ELSE LEAST(
        session_record.pairing_approval_attempt_count + 1,
        p_attempt_limit + 1
      )
    END
  WHERE session_record.session_id = p_session_id
    AND session_record.profile_id = authenticated_profile_id
  RETURNING session_record.pairing_approval_attempt_count
  INTO attempt_count;

  IF attempt_count IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  IF attempt_count > p_attempt_limit THEN
    RETURN;
  END IF;

  FOR candidate_record IN
    SELECT
      candidate.candidate_index,
      pairing_record.pairing_id,
      pairing_record.device_label::text AS device_label,
      pairing_record.connector_version::text AS connector_version,
      pairing_record.os_family::text AS os_family,
      pairing_record.architecture::text AS architecture,
      key_record.public_key,
      pairing_record.expires_at
    FROM (
      VALUES
        (1::smallint, p_primary_user_code_digest),
        (2::smallint, p_secondary_user_code_digest)
    ) AS candidate(candidate_index, user_code_digest)
    JOIN viberacing_private.pairing_transactions AS pairing_record
      ON pairing_record.user_code_digest = candidate.user_code_digest
    JOIN viberacing_private.device_keys AS key_record
      ON key_record.device_key_id = pairing_record.pending_device_key_id
    WHERE (candidate.candidate_index = 1 OR p_secondary_active)
      AND pairing_record.state = 'pending'
      AND pairing_record.expires_at >= now_at
      AND key_record.state = 'pending'
    ORDER BY candidate.candidate_index
  LOOP
    matching_count := matching_count + 1;
    IF matching_count > 1 THEN
      PERFORM viberacing_private.operation_failed();
    END IF;
    candidate_index := candidate_record.candidate_index;
    pairing_id := candidate_record.pairing_id;
    device_label := candidate_record.device_label;
    connector_version := candidate_record.connector_version;
    os_family := candidate_record.os_family;
    architecture := candidate_record.architecture;
    public_key := candidate_record.public_key;
    expires_at := candidate_record.expires_at;
  END LOOP;

  IF matching_count = 1 THEN
    RETURN NEXT;
  END IF;
END
$function$;

REVOKE EXECUTE ON FUNCTION viberacing_api.read_pairing_for_approval(uuid, bytea, bytea)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
REVOKE EXECUTE ON FUNCTION viberacing_api.read_pairing_for_approval_limited(
  uuid, bytea, bytea, bytea, boolean, integer, integer
) FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

GRANT EXECUTE ON FUNCTION viberacing_api.read_pairing_for_approval_limited(
  uuid, bytea, bytea, bytea, boolean, integer, integer
) TO viberacing_web;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (21, 'pairing_approval_attempt_policy');

COMMIT;
