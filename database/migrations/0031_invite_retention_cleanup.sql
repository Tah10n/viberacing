\set ON_ERROR_STOP on

-- Revision 0031: bounded Jobs-only cleanup for expired unredeemed invites.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

-- The original partial index served only active-invite redemption. Extend the same bounded path to
-- revoked rows that also become deletion-eligible at expiry while preserving redeemed provenance.
DROP INDEX viberacing_private.invites_expiry_idx;
CREATE INDEX invites_expiry_idx
  ON viberacing_private.invites (expires_at, invite_id)
  WHERE state IN ('active', 'revoked');

CREATE FUNCTION viberacing_api.cleanup_expired_invites(
  p_batch_size integer
)
RETURNS TABLE (
  deleted_invites integer
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

  -- Invite verifier deletion shares the private authentication-retention mutex. This serializes
  -- cleanup workers and preserves profile-purge lock order without exposing a caller-selected key.
  PERFORM lock_record.capability
  FROM viberacing_private.maintenance_locks AS lock_record
  WHERE lock_record.capability = 'auth_retention_cleanup'
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  -- Capture server time only after the mutex. Enrollment already holding an invite row settles;
  -- SKIP LOCKED leaves that row for a later call. Redeemed rows are never eligible.
  now_at := pg_catalog.clock_timestamp();

  WITH expired_invite AS MATERIALIZED (
    SELECT invite_record.invite_id
    FROM viberacing_private.invites AS invite_record
    WHERE invite_record.state IN ('active', 'revoked')
      AND invite_record.expires_at <= now_at
    ORDER BY invite_record.expires_at, invite_record.invite_id
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  ),
  deleted_invite AS (
    DELETE FROM viberacing_private.invites AS invite_record
    USING expired_invite
    WHERE invite_record.invite_id = expired_invite.invite_id
      AND invite_record.state IN ('active', 'revoked')
      AND invite_record.expires_at <= now_at
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer
  INTO deleted_invites
  FROM deleted_invite;

  RETURN NEXT;
EXCEPTION
  WHEN lock_not_available OR integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
    RETURN;
END
$function$;

REVOKE EXECUTE ON FUNCTION viberacing_api.cleanup_expired_invites(integer)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

GRANT EXECUTE ON FUNCTION viberacing_api.cleanup_expired_invites(integer)
  TO viberacing_jobs;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (31, 'invite_retention_cleanup');

COMMIT;
