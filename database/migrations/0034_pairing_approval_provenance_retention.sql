\set ON_ERROR_STOP on

-- Revision 0034: bounded Jobs-only redaction of aged pairing approval provenance.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

CREATE OR REPLACE FUNCTION viberacing_private.enforce_pairing_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.pairing_id IS DISTINCT FROM OLD.pairing_id
    OR NEW.poll_verifier_digest IS DISTINCT FROM OLD.poll_verifier_digest
    OR NEW.user_code_digest IS DISTINCT FROM OLD.user_code_digest
    OR NEW.challenge IS DISTINCT FROM OLD.challenge
    OR NEW.pending_device_key_id IS DISTINCT FROM OLD.pending_device_key_id
    OR NEW.device_label IS DISTINCT FROM OLD.device_label
    OR NEW.connector_version IS DISTINCT FROM OLD.connector_version
    OR NEW.os_family IS DISTINCT FROM OLD.os_family
    OR NEW.architecture IS DISTINCT FROM OLD.architecture
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'pending pairing authority is immutable';
  END IF;

  IF (
      NEW.approved_profile_id IS DISTINCT FROM OLD.approved_profile_id
      OR NEW.source_choice IS DISTINCT FROM OLD.source_choice
      OR NEW.approved_source_id IS DISTINCT FROM OLD.approved_source_id
      OR NEW.approved_by_session_id IS DISTINCT FROM OLD.approved_by_session_id
      OR NEW.approved_by_passkey_id IS DISTINCT FROM OLD.approved_by_passkey_id
      OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
    )
    AND NOT (
      OLD.state = 'pending'
      AND NEW.state = 'approved'
      AND OLD.approved_profile_id IS NULL
      AND OLD.source_choice IS NULL
      AND OLD.approved_source_id IS NULL
      AND OLD.approved_by_session_id IS NULL
      AND OLD.approved_by_passkey_id IS NULL
      AND OLD.approved_at IS NULL
      AND NEW.approved_profile_id IS NOT NULL
      AND NEW.source_choice IS NOT NULL
      AND NEW.approved_source_id IS NOT NULL
      AND NEW.approved_by_session_id IS NOT NULL
      AND NEW.approved_by_passkey_id IS NOT NULL
      AND NEW.approved_at IS NOT NULL
    )
    AND NOT (
      OLD.state = 'activated'
      AND NEW.state = 'activated'
      AND OLD.approved_profile_id IS NOT DISTINCT FROM NEW.approved_profile_id
      AND OLD.source_choice IS NOT DISTINCT FROM NEW.source_choice
      AND OLD.approved_source_id IS NOT DISTINCT FROM NEW.approved_source_id
      AND OLD.approved_at IS NOT DISTINCT FROM NEW.approved_at
      AND OLD.approved_by_session_id IS NOT NULL
      AND OLD.approved_by_passkey_id IS NOT NULL
      AND NEW.approved_by_session_id IS NULL
      AND NEW.approved_by_passkey_id IS NULL
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'pairing approval binding is immutable';
  END IF;

  IF (
      NEW.activated_device_id IS DISTINCT FROM OLD.activated_device_id
      OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
    )
    AND NOT (
      OLD.state = 'approved'
      AND NEW.state = 'activated'
      AND OLD.activated_device_id IS NULL
      AND OLD.activated_at IS NULL
      AND NEW.activated_device_id IS NOT NULL
      AND NEW.activated_at IS NOT NULL
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'pairing activation binding is immutable';
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state
    AND NOT (
      (OLD.state = 'pending' AND NEW.state IN ('approved', 'cancelled'))
      OR (OLD.state = 'approved' AND NEW.state IN ('activated', 'cancelled'))
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'invalid pairing state transition';
  END IF;

  RETURN NEW;
END
$function$;

CREATE INDEX pairing_transactions_approval_provenance_retention_idx
  ON viberacing_private.pairing_transactions (activated_at, pairing_id)
  WHERE state = 'activated'
    AND approved_by_session_id IS NOT NULL
    AND approved_by_passkey_id IS NOT NULL;

CREATE FUNCTION viberacing_api.redact_aged_pairing_approval_provenance(
  p_batch_size integer
)
RETURNS TABLE (
  redacted_pairings integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  cutoff_at timestamptz(3);
  locked_mutex_count bigint;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 1000 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  -- Keep the profile-purge order: authentication before pairing, then any user row. This also
  -- prevents session cleanup from observing a half-settled provenance redaction.
  PERFORM lock_record.capability
  FROM viberacing_private.maintenance_locks AS lock_record
  WHERE lock_record.capability IN (
    'auth_retention_cleanup',
    'pairing_retention_cleanup'
  )
  ORDER BY lock_record.capability
  FOR UPDATE;

  GET DIAGNOSTICS locked_mutex_count = ROW_COUNT;
  IF locked_mutex_count <> 2 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  cutoff_at := pg_catalog.clock_timestamp() - INTERVAL '180 days';

  WITH aged_pairing AS MATERIALIZED (
    SELECT pairing_record.pairing_id
    FROM viberacing_private.pairing_transactions AS pairing_record
    WHERE pairing_record.state = 'activated'
      AND pairing_record.activated_at <= cutoff_at
      AND pairing_record.approved_by_session_id IS NOT NULL
      AND pairing_record.approved_by_passkey_id IS NOT NULL
    ORDER BY pairing_record.activated_at, pairing_record.pairing_id
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  ),
  redacted_pairing AS (
    UPDATE viberacing_private.pairing_transactions AS pairing_record
    SET
      approved_by_session_id = NULL,
      approved_by_passkey_id = NULL
    FROM aged_pairing
    WHERE pairing_record.pairing_id = aged_pairing.pairing_id
      AND pairing_record.state = 'activated'
      AND pairing_record.activated_at <= cutoff_at
      AND pairing_record.approved_by_session_id IS NOT NULL
      AND pairing_record.approved_by_passkey_id IS NOT NULL
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer
  INTO redacted_pairings
  FROM redacted_pairing;

  RETURN NEXT;
EXCEPTION
  WHEN lock_not_available OR integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
    RETURN;
END
$function$;

REVOKE EXECUTE ON FUNCTION viberacing_api.redact_aged_pairing_approval_provenance(integer)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

GRANT EXECUTE ON FUNCTION viberacing_api.redact_aged_pairing_approval_provenance(integer)
  TO viberacing_jobs;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (34, 'pairing_approval_provenance_retention');

COMMIT;
