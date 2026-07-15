\set ON_ERROR_STOP on

-- Revision 0008: bounded Jobs-only cleanup for expired Community ingest state.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

CREATE TABLE viberacing_private.maintenance_locks (
  capability varchar(32) PRIMARY KEY,
  CONSTRAINT maintenance_locks_capability CHECK (
    capability IN ('ingest_retention_cleanup')
  )
);

INSERT INTO viberacing_private.maintenance_locks (capability)
VALUES ('ingest_retention_cleanup');

ALTER TABLE viberacing_private.maintenance_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.maintenance_locks FORCE ROW LEVEL SECURITY;
CREATE POLICY maintenance_locks_owner_all ON viberacing_private.maintenance_locks
  FOR ALL TO viberacing_owner USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE viberacing_private.maintenance_locks
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

CREATE FUNCTION viberacing_api.cleanup_expired_ingest_state(
  p_batch_size integer
)
RETURNS TABLE (
  deleted_nonces integer,
  deleted_snapshots integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $function$
DECLARE
  now_at timestamptz(3) := pg_catalog.statement_timestamp();
BEGIN
  IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 1000 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  -- Only the owner-defined procedure can lock this private row. Runtime roles cannot seize a
  -- public advisory-lock key to starve cleanup.
  PERFORM lock_record.capability
  FROM viberacing_private.maintenance_locks AS lock_record
  WHERE lock_record.capability = 'ingest_retention_cleanup'
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  WITH expired_nonce AS MATERIALIZED (
    SELECT nonce_record.device_key_id, nonce_record.nonce_digest
    FROM viberacing_private.device_nonces AS nonce_record
    WHERE nonce_record.expires_at <= now_at
    ORDER BY nonce_record.expires_at, nonce_record.device_key_id, nonce_record.nonce_digest
    LIMIT p_batch_size
    FOR UPDATE
  ),
  deleted_nonce AS (
    DELETE FROM viberacing_private.device_nonces AS nonce_record
    USING expired_nonce
    WHERE nonce_record.device_key_id = expired_nonce.device_key_id
      AND nonce_record.nonce_digest = expired_nonce.nonce_digest
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer
  INTO deleted_nonces
  FROM deleted_nonce;

  WITH expired_snapshot AS MATERIALIZED (
    SELECT snapshot_record.usage_snapshot_id
    FROM viberacing_private.usage_snapshots AS snapshot_record
    WHERE snapshot_record.retention_expires_at <= now_at
    ORDER BY snapshot_record.retention_expires_at, snapshot_record.usage_snapshot_id
    LIMIT p_batch_size
    FOR UPDATE
  ),
  deleted_snapshot AS (
    DELETE FROM viberacing_private.usage_snapshots AS snapshot_record
    USING expired_snapshot
    WHERE snapshot_record.usage_snapshot_id = expired_snapshot.usage_snapshot_id
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer
  INTO deleted_snapshots
  FROM deleted_snapshot;

  RETURN NEXT;
EXCEPTION
  WHEN lock_not_available OR integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
    RETURN;
END
$function$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA viberacing_private
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA viberacing_api
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

GRANT EXECUTE ON FUNCTION viberacing_api.issue_invite(
  uuid, bytea, timestamptz, uuid, text, text
) TO viberacing_admin;

GRANT EXECUTE ON FUNCTION viberacing_api.enroll_profile(
  uuid, bytea, uuid, bigint, text, text, text, text, boolean,
  uuid, bytea, timestamptz, uuid, text
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.create_auth_challenge(
  uuid, bytea, uuid, text, bytea, bytea, timestamptz
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.consume_auth_challenge(
  uuid, bytea, uuid, text, bytea, bytea
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.register_initial_passkey(
  uuid, bytea, uuid, uuid, bytea, bytea, text, bigint, boolean, boolean, uuid, text
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.rotate_session(
  uuid, bytea, uuid, bytea, timestamptz, uuid, text
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.revoke_session(uuid, bytea, uuid, text)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.request_profile_deletion(
  uuid, bytea, text, uuid, uuid, bytea, uuid, text
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.start_pairing(
  uuid, bytea, bytea, bytea, uuid, bytea, text, text, text, text, timestamptz
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.read_pairing_for_approval(uuid, bytea, bytea)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.create_pairing_approval_challenge(
  uuid, bytea, uuid, bytea, text, text, uuid, bytea, bytea, timestamptz
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.approve_pairing(
  uuid, bytea, uuid, uuid, bytea, uuid, text
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.read_pairing_verification_material(bytea)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.activate_pairing(bytea, uuid, text, uuid, text)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.poll_pairing_status(bytea)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.read_source_inventory(uuid, bytea)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.pause_source(uuid, bytea, text, uuid, text)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.create_source_action_challenge(
  uuid, bytea, text, text, uuid, bytea, bytea, timestamptz
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.reactivate_source(
  uuid, bytea, text, uuid, bytea, uuid, text
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.unlink_source(
  uuid, bytea, text, uuid, bytea, uuid, text
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.revoke_device(uuid, bytea, text, uuid, text)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.create_passkey_login_challenge(
  uuid, bytea, bytea, timestamptz
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.read_passkey_verification_material(bytea)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.complete_passkey_login(
  uuid, bytea, bytea, uuid, bytea, bigint, boolean,
  uuid, bytea, timestamptz, uuid, text
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.create_passkey_change_challenge(
  uuid, bytea, text, uuid, uuid, bytea, bytea, timestamptz
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.consume_passkey_challenge(
  uuid, bytea, uuid, text, bytea, bytea, uuid, bigint, boolean
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.read_passkey_inventory(uuid, bytea)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.add_passkey(
  uuid, bytea, uuid, bytea, uuid, bytea, bytea, text,
  bigint, boolean, boolean, uuid, text
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.revoke_passkey(
  uuid, bytea, uuid, uuid, bytea, uuid, text
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.create_recovery_change_challenge(
  uuid, bytea, uuid, bytea, bytea, timestamptz
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.replace_recovery_codes(
  uuid, bytea, uuid, bytea, uuid, uuid[], text[], uuid, text
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.read_recovery_code_verification_material(uuid)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.start_recovery(
  uuid, uuid, bytea, bytea, bytea, timestamptz, uuid, text
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.complete_recovery_registration(
  uuid, bytea, bytea, bytea, uuid, bytea, bytea, text,
  bigint, boolean, boolean, uuid, bytea, timestamptz, uuid, text
) TO viberacing_web;

GRANT EXECUTE ON FUNCTION viberacing_api.read_device_verification_material(text)
  TO viberacing_ingest;
GRANT EXECUTE ON FUNCTION viberacing_api.submit_community_sync(
  uuid, text, text, uuid, text, timestamptz, text, text,
  bytea, bytea, bytea, text[], bigint[]
) TO viberacing_ingest;

GRANT EXECUTE ON FUNCTION viberacing_api.cleanup_expired_ingest_state(integer)
  TO viberacing_jobs;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (8, 'ingest_retention_cleanup');

COMMIT;
