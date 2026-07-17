\set ON_ERROR_STOP on

-- Revision 0024: bounded Jobs-only primary profile deletion purge.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

ALTER TABLE viberacing_private.maintenance_locks
  DROP CONSTRAINT maintenance_locks_capability,
  ADD CONSTRAINT maintenance_locks_capability CHECK (
    capability IN (
      'ingest_retention_cleanup',
      'community_scoring_refresh',
      'pairing_retention_cleanup',
      'auth_retention_cleanup',
      'profile_deletion_purge'
    )
  );

INSERT INTO viberacing_private.maintenance_locks (capability)
VALUES ('profile_deletion_purge');

CREATE FUNCTION viberacing_api.purge_profile_deletions(
  p_batch_size integer
)
RETURNS TABLE (
  purged_profiles integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  candidate record;
  pairing_candidate record;
  changed_rows bigint;
  locked_profile_id uuid;
  locked_mutex_count bigint;
  now_at timestamptz(3);
BEGIN
  IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 10 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  -- A profile cascade intersects every current Jobs capability. Lock all private mutexes in one
  -- stable order before any user row so cleanup, scoring, and purge cannot form a cross-capability
  -- deadlock. Other Jobs functions lock only their own row and therefore never wait in reverse.
  PERFORM lock_record.capability
  FROM viberacing_private.maintenance_locks AS lock_record
  WHERE lock_record.capability IN (
    'auth_retention_cleanup',
    'community_scoring_refresh',
    'ingest_retention_cleanup',
    'pairing_retention_cleanup',
    'profile_deletion_purge'
  )
  ORDER BY lock_record.capability
  FOR UPDATE;

  GET DIAGNOSTICS locked_mutex_count = ROW_COUNT;
  IF locked_mutex_count <> 5 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  now_at := pg_catalog.clock_timestamp();
  purged_profiles := 0;

  FOR candidate IN
    SELECT
      job_record.deletion_job_id,
      job_record.profile_id
    FROM viberacing_private.deletion_jobs AS job_record
    WHERE job_record.state IN ('queued', 'retry_wait')
      AND job_record.profile_id IS NOT NULL
      AND job_record.available_at <= now_at
    ORDER BY
      job_record.available_at,
      job_record.requested_at,
      job_record.deletion_job_id
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  LOOP
    locked_profile_id := NULL;
    SELECT profile_record.profile_id
    INTO locked_profile_id
    FROM viberacing_private.profiles AS profile_record
    WHERE profile_record.profile_id = candidate.profile_id
      AND profile_record.state = 'deletion_pending'
    FOR UPDATE SKIP LOCKED;

    IF locked_profile_id IS NULL THEN
      -- A concurrent security transition may already own the profile. Leave that exact job for a
      -- later call, but fail closed if committed state no longer matches a deletion request.
      IF NOT EXISTS (
        SELECT 1
        FROM viberacing_private.profiles AS profile_record
        WHERE profile_record.profile_id = candidate.profile_id
          AND profile_record.state = 'deletion_pending'
      ) THEN
        PERFORM viberacing_private.operation_failed();
      END IF;
      CONTINUE;
    END IF;

    -- Pairing rows use deliberate RESTRICT references to sources, devices, sessions, and
    -- passkeys. Remove every profile-bound pairing first, and remove only its still-authority-free
    -- pending key. Activated/revoked source-bound keys are removed by the profile cascade below.
    FOR pairing_candidate IN
      SELECT
        pairing_record.pairing_id,
        pairing_record.pending_device_key_id
      FROM viberacing_private.pairing_transactions AS pairing_record
      WHERE pairing_record.approved_profile_id = locked_profile_id
      ORDER BY pairing_record.pairing_id
      FOR UPDATE
    LOOP
      DELETE FROM viberacing_private.pairing_transactions AS pairing_record
      WHERE pairing_record.pairing_id = pairing_candidate.pairing_id
        AND pairing_record.approved_profile_id = locked_profile_id
        AND pairing_record.pending_device_key_id = pairing_candidate.pending_device_key_id;

      GET DIAGNOSTICS changed_rows = ROW_COUNT;
      IF changed_rows <> 1 THEN
        PERFORM viberacing_private.operation_failed();
      END IF;

      DELETE FROM viberacing_private.device_keys AS key_record
      WHERE key_record.device_key_id = pairing_candidate.pending_device_key_id
        AND key_record.state = 'pending'
        AND key_record.source_id IS NULL
        AND key_record.device_id IS NULL;
    END LOOP;

    -- Mark the job terminal before deleting its profile because the profile foreign key uses
    -- ON DELETE SET NULL and non-terminal queue states require a non-null profile. Both changes
    -- remain invisible unless this entire transaction commits.
    UPDATE viberacing_private.deletion_jobs AS job_record
    SET
      state = 'purged',
      lease_token_digest = NULL,
      lease_expires_at = NULL,
      completed_at = now_at,
      last_error_code = NULL
    WHERE job_record.deletion_job_id = candidate.deletion_job_id
      AND job_record.profile_id = locked_profile_id
      AND job_record.state IN ('queued', 'retry_wait')
      AND job_record.available_at <= now_at;

    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    IF changed_rows <> 1 THEN
      PERFORM viberacing_private.operation_failed();
    END IF;

    DELETE FROM viberacing_private.profiles AS profile_record
    WHERE profile_record.profile_id = locked_profile_id
      AND profile_record.state = 'deletion_pending';

    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    IF changed_rows <> 1 THEN
      PERFORM viberacing_private.operation_failed();
    END IF;

    purged_profiles := purged_profiles + 1;
  END LOOP;

  RETURN NEXT;
EXCEPTION
  WHEN lock_not_available OR integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
    RETURN;
END
$function$;

REVOKE EXECUTE ON FUNCTION viberacing_api.purge_profile_deletions(integer)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

GRANT EXECUTE ON FUNCTION viberacing_api.purge_profile_deletions(integer)
  TO viberacing_jobs;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (24, 'profile_deletion_purge');

COMMIT;
