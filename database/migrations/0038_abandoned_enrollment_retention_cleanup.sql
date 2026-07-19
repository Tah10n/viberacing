\set ON_ERROR_STOP on

-- Revision 0038: bounded Jobs-only cleanup for abandoned enrollment profiles.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

-- Enrollment cleanup walks only the non-public pre-activation state in deterministic order.
CREATE INDEX profiles_enrolling_created_idx
  ON viberacing_private.profiles (created_at, profile_id)
  WHERE state = 'enrolling';

CREATE FUNCTION viberacing_api.cleanup_abandoned_enrollments(
  p_batch_size integer
)
RETURNS TABLE (
  deleted_enrollments integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  candidate_profile_id uuid;
  changed_rows bigint;
  locked_mutex_count bigint;
  now_at timestamptz(3);
BEGIN
  IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 1000 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  -- The profile cascade removes its redeemed invite, sessions, and challenges. Share the exact
  -- authentication and profile-purge mutexes in their existing stable order before touching a
  -- profile row so no cleanup capability can form a reverse lock chain.
  PERFORM lock_record.capability
  FROM viberacing_private.maintenance_locks AS lock_record
  WHERE lock_record.capability IN (
    'auth_retention_cleanup',
    'profile_deletion_purge'
  )
  ORDER BY lock_record.capability
  FOR UPDATE;

  GET DIAGNOSTICS locked_mutex_count = ROW_COUNT;
  IF locked_mutex_count <> 2 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  -- Capture server time only after both mutexes. A registering passkey already holding the profile
  -- row is skipped; any session or challenge whose expiry equals this instant is still preserved.
  now_at := pg_catalog.clock_timestamp();
  deleted_enrollments := 0;

  LOOP
    EXIT WHEN deleted_enrollments >= p_batch_size;
    candidate_profile_id := NULL;

    -- Only the redeemed invite, expired enrollment sessions, expired registration challenges, and
    -- redacted audit linkage may remain. Every other direct profile-bound state fails closed.
    SELECT profile_record.profile_id
    INTO candidate_profile_id
    FROM viberacing_private.profiles AS profile_record
    WHERE profile_record.state = 'enrolling'
      AND EXISTS (
        SELECT 1
        FROM viberacing_private.invites AS invite_record
        WHERE invite_record.redeemed_profile_id = profile_record.profile_id
          AND invite_record.state = 'redeemed'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.sessions AS session_record
        WHERE session_record.profile_id = profile_record.profile_id
          AND (
            session_record.expires_at >= now_at
            OR session_record.authentication_kind <> 'enrollment'
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.auth_challenges AS challenge_record
        WHERE challenge_record.profile_id = profile_record.profile_id
          AND (
            challenge_record.expires_at >= now_at
            OR challenge_record.purpose <> 'passkey_registration'
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.passkeys AS passkey_record
        WHERE passkey_record.profile_id = profile_record.profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.recovery_codes AS recovery_code
        WHERE recovery_code.profile_id = profile_record.profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.recovery_authorities AS recovery_authority
        WHERE recovery_authority.profile_id = profile_record.profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.codex_sources AS source_record
        WHERE source_record.profile_id = profile_record.profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.deletion_jobs AS deletion_job
        WHERE deletion_job.profile_id = profile_record.profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.season_entries AS season_entry
        WHERE season_entry.profile_id = profile_record.profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.profile_car_recipes AS active_recipe
        WHERE active_recipe.profile_id = profile_record.profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.car_recipe_proposals AS pending_recipe
        WHERE pending_recipe.profile_id = profile_record.profile_id
      )
    ORDER BY profile_record.created_at, profile_record.profile_id
    LIMIT 1
    FOR UPDATE OF profile_record SKIP LOCKED;

    EXIT WHEN candidate_profile_id IS NULL;

    -- Repeat every authority and canonical-shape predicate after locking. The profile delete then
    -- atomically removes only its redeemed invite and expired enrollment authority while existing
    -- audit events retain their redacted ON DELETE SET NULL record.
    DELETE FROM viberacing_private.profiles AS profile_record
    WHERE profile_record.profile_id = candidate_profile_id
      AND profile_record.state = 'enrolling'
      AND EXISTS (
        SELECT 1
        FROM viberacing_private.invites AS invite_record
        WHERE invite_record.redeemed_profile_id = profile_record.profile_id
          AND invite_record.state = 'redeemed'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.sessions AS session_record
        WHERE session_record.profile_id = profile_record.profile_id
          AND (
            session_record.expires_at >= now_at
            OR session_record.authentication_kind <> 'enrollment'
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.auth_challenges AS challenge_record
        WHERE challenge_record.profile_id = profile_record.profile_id
          AND (
            challenge_record.expires_at >= now_at
            OR challenge_record.purpose <> 'passkey_registration'
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.passkeys AS passkey_record
        WHERE passkey_record.profile_id = profile_record.profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.recovery_codes AS recovery_code
        WHERE recovery_code.profile_id = profile_record.profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.recovery_authorities AS recovery_authority
        WHERE recovery_authority.profile_id = profile_record.profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.codex_sources AS source_record
        WHERE source_record.profile_id = profile_record.profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.deletion_jobs AS deletion_job
        WHERE deletion_job.profile_id = profile_record.profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.season_entries AS season_entry
        WHERE season_entry.profile_id = profile_record.profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.profile_car_recipes AS active_recipe
        WHERE active_recipe.profile_id = profile_record.profile_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM viberacing_private.car_recipe_proposals AS pending_recipe
        WHERE pending_recipe.profile_id = profile_record.profile_id
      );

    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    IF changed_rows <> 1 THEN
      PERFORM viberacing_private.operation_failed();
    END IF;
    deleted_enrollments := deleted_enrollments + 1;
  END LOOP;

  RETURN NEXT;
EXCEPTION
  WHEN lock_not_available OR integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
    RETURN;
END
$function$;

REVOKE EXECUTE ON FUNCTION viberacing_api.cleanup_abandoned_enrollments(integer)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

GRANT EXECUTE ON FUNCTION viberacing_api.cleanup_abandoned_enrollments(integer)
  TO viberacing_jobs;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (38, 'abandoned_enrollment_retention_cleanup');

COMMIT;
