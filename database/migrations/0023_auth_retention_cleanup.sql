\set ON_ERROR_STOP on

-- Revision 0023: bounded Jobs-only cleanup for expired authentication ceremony state.
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
      'auth_retention_cleanup'
    )
  );

INSERT INTO viberacing_private.maintenance_locks (capability)
VALUES ('auth_retention_cleanup');

-- The original partial indexes helped live authorization reads but could not bound physical
-- deletion of consumed challenges or terminal recovery authorities. Primary-key lookups continue
-- to serve authorization; these full expiry indexes serve deterministic cleanup.
DROP INDEX viberacing_private.auth_challenges_expiry_idx;
CREATE INDEX auth_challenges_expiry_idx
  ON viberacing_private.auth_challenges (expires_at, challenge_id);

DROP INDEX viberacing_private.recovery_authorities_expiry_idx;
CREATE INDEX recovery_authorities_expiry_idx
  ON viberacing_private.recovery_authorities (expires_at, recovery_authority_id);

CREATE FUNCTION viberacing_api.cleanup_expired_auth_state(
  p_batch_size integer
)
RETURNS TABLE (
  deleted_challenges integer,
  deleted_recovery_authorities integer,
  deleted_used_recovery_codes integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  now_at timestamptz(3);
BEGIN
  IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 1000 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  -- Runtime roles cannot lock this private row directly or choose another lock key.
  PERFORM lock_record.capability
  FROM viberacing_private.maintenance_locks AS lock_record
  WHERE lock_record.capability = 'auth_retention_cleanup'
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  -- Capture server time only after the Jobs mutex. A ceremony that is still live at this point is
  -- never selected, and a security transition already holding a row leaves it for a later batch.
  now_at := pg_catalog.clock_timestamp();

  WITH expired_challenge AS MATERIALIZED (
    SELECT challenge_record.challenge_id
    FROM viberacing_private.auth_challenges AS challenge_record
    WHERE challenge_record.expires_at <= now_at
    ORDER BY challenge_record.expires_at, challenge_record.challenge_id
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  ),
  deleted_challenge AS (
    DELETE FROM viberacing_private.auth_challenges AS challenge_record
    USING expired_challenge
    WHERE challenge_record.challenge_id = expired_challenge.challenge_id
      AND challenge_record.expires_at <= now_at
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer
  INTO deleted_challenges
  FROM deleted_challenge;

  -- Recovery mutations serialize on the profile before touching codes or authorities. Select a
  -- candidate window without row locks, then acquire those profile rows in one stable order before
  -- locking either child class. This preserves that cross-capability order while the private Jobs
  -- mutex continues to serialize cleanup workers.
  WITH candidate_authority AS MATERIALIZED (
    SELECT
      authority_record.recovery_authority_id,
      authority_record.profile_id,
      authority_record.source_recovery_code_id
    FROM viberacing_private.recovery_authorities AS authority_record
    WHERE authority_record.expires_at <= now_at
    ORDER BY authority_record.expires_at, authority_record.recovery_authority_id
    LIMIT p_batch_size
  ),
  locked_profile AS MATERIALIZED (
    SELECT profile_record.profile_id
    FROM viberacing_private.profiles AS profile_record
    JOIN (
      SELECT DISTINCT candidate_record.profile_id
      FROM candidate_authority AS candidate_record
    ) AS candidate_profile
      ON candidate_profile.profile_id = profile_record.profile_id
    ORDER BY profile_record.profile_id
    FOR UPDATE OF profile_record
  ),
  expired_authority AS MATERIALIZED (
    SELECT
      authority_record.recovery_authority_id,
      authority_record.source_recovery_code_id
    FROM viberacing_private.recovery_authorities AS authority_record
    JOIN candidate_authority AS candidate_record
      ON candidate_record.recovery_authority_id = authority_record.recovery_authority_id
      AND candidate_record.profile_id = authority_record.profile_id
      AND candidate_record.source_recovery_code_id = authority_record.source_recovery_code_id
    JOIN locked_profile AS profile_record
      ON profile_record.profile_id = authority_record.profile_id
    WHERE authority_record.expires_at <= now_at
    ORDER BY authority_record.expires_at, authority_record.recovery_authority_id
    FOR UPDATE SKIP LOCKED
  ),
  deleted_authority AS (
    DELETE FROM viberacing_private.recovery_authorities AS authority_record
    USING expired_authority
    WHERE authority_record.recovery_authority_id = expired_authority.recovery_authority_id
      AND authority_record.source_recovery_code_id = expired_authority.source_recovery_code_id
      AND authority_record.expires_at <= now_at
    RETURNING authority_record.source_recovery_code_id
  ),
  deleted_code AS (
    DELETE FROM viberacing_private.recovery_codes AS code_record
    USING deleted_authority
    WHERE code_record.recovery_code_id = deleted_authority.source_recovery_code_id
      AND code_record.used_at IS NOT NULL
      AND code_record.verifier_phc IS NULL
    RETURNING 1
  )
  SELECT
    (SELECT pg_catalog.count(*)::integer FROM deleted_authority),
    (SELECT pg_catalog.count(*)::integer FROM deleted_code)
  INTO deleted_recovery_authorities, deleted_used_recovery_codes;

  RETURN NEXT;
EXCEPTION
  WHEN lock_not_available OR integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
    RETURN;
END
$function$;

REVOKE EXECUTE ON FUNCTION viberacing_api.cleanup_expired_auth_state(integer)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

GRANT EXECUTE ON FUNCTION viberacing_api.cleanup_expired_auth_state(integer)
  TO viberacing_jobs;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (23, 'auth_retention_cleanup');

COMMIT;
