\set ON_ERROR_STOP on

-- Revision 0012: persistent, source-key-bound replay protection for Ingest origin proofs.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

CREATE TABLE viberacing_private.origin_nonces (
  origin_key_id varchar(27) NOT NULL,
  nonce_digest bytea NOT NULL,
  expires_at timestamptz(3) NOT NULL,
  CONSTRAINT origin_nonces_key_id_format CHECK (
    origin_key_id ~ '^edge_[A-Za-z0-9_-]{1,22}$'
  ),
  CONSTRAINT origin_nonces_digest_length CHECK (
    pg_catalog.octet_length(nonce_digest) = 32
  ),
  CONSTRAINT origin_nonces_key_digest_unique PRIMARY KEY (origin_key_id, nonce_digest)
);

CREATE INDEX origin_nonces_expiry_idx
  ON viberacing_private.origin_nonces (expires_at, origin_key_id, nonce_digest);

ALTER TABLE viberacing_private.origin_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.origin_nonces FORCE ROW LEVEL SECURITY;
CREATE POLICY origin_nonces_owner_all ON viberacing_private.origin_nonces
  FOR ALL TO viberacing_owner USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE viberacing_private.origin_nonces
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

CREATE FUNCTION viberacing_api.consume_origin_nonce(
  p_origin_key_id text,
  p_nonce_digest bytea,
  p_expires_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '5s'
AS $function$
DECLARE
  now_at timestamptz(3) := pg_catalog.clock_timestamp();
BEGIN
  IF p_origin_key_id IS NULL
    OR p_origin_key_id !~ '^edge_[A-Za-z0-9_-]{1,22}$'
    OR pg_catalog.octet_length(p_nonce_digest) IS DISTINCT FROM 32
    OR p_expires_at IS NULL
    OR p_expires_at IS DISTINCT FROM pg_catalog.date_trunc('milliseconds', p_expires_at)
    OR p_expires_at <= now_at
    OR p_expires_at > now_at + INTERVAL '65 seconds' THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  INSERT INTO viberacing_private.origin_nonces (
    origin_key_id,
    nonce_digest,
    expires_at
  )
  VALUES (
    p_origin_key_id,
    p_nonce_digest,
    p_expires_at
  )
  ON CONFLICT (origin_key_id, nonce_digest)
  DO UPDATE SET expires_at = EXCLUDED.expires_at
  WHERE origin_nonces.expires_at <= pg_catalog.clock_timestamp();

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- A proof can expire while waiting for a conflicting row lock. Remove the exact row written by
  -- this call and reject it instead of reopening a replay window after the proof lifetime ended.
  IF p_expires_at <= pg_catalog.clock_timestamp() THEN
    DELETE FROM viberacing_private.origin_nonces AS nonce_record
    WHERE nonce_record.origin_key_id = p_origin_key_id
      AND nonce_record.nonce_digest = p_nonce_digest
      AND nonce_record.expires_at = p_expires_at;
    RETURN false;
  END IF;

  RETURN true;
EXCEPTION
  WHEN data_exception OR integrity_constraint_violation OR lock_not_available THEN
    PERFORM viberacing_private.operation_failed();
    RETURN false;
END
$function$;

DROP FUNCTION viberacing_api.cleanup_expired_ingest_state(integer);

CREATE FUNCTION viberacing_api.cleanup_expired_ingest_state(
  p_batch_size integer
)
RETURNS TABLE (
  deleted_origin_nonces integer,
  deleted_nonces integer,
  deleted_snapshots integer
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

  -- Only the owner-defined procedure can lock this private row. Runtime roles cannot seize a
  -- public advisory-lock key to starve cleanup.
  PERFORM lock_record.capability
  FROM viberacing_private.maintenance_locks AS lock_record
  WHERE lock_record.capability = 'ingest_retention_cleanup'
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  now_at := pg_catalog.clock_timestamp();

  WITH expired_origin_nonce AS MATERIALIZED (
    SELECT nonce_record.origin_key_id, nonce_record.nonce_digest
    FROM viberacing_private.origin_nonces AS nonce_record
    WHERE nonce_record.expires_at <= now_at
    ORDER BY nonce_record.expires_at, nonce_record.origin_key_id, nonce_record.nonce_digest
    LIMIT p_batch_size
    FOR UPDATE
  ),
  deleted_origin_nonce AS (
    DELETE FROM viberacing_private.origin_nonces AS nonce_record
    USING expired_origin_nonce
    WHERE nonce_record.origin_key_id = expired_origin_nonce.origin_key_id
      AND nonce_record.nonce_digest = expired_origin_nonce.nonce_digest
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer
  INTO deleted_origin_nonces
  FROM deleted_origin_nonce;

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

REVOKE EXECUTE ON FUNCTION viberacing_api.consume_origin_nonce(text, bytea, timestamptz)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
REVOKE EXECUTE ON FUNCTION viberacing_api.cleanup_expired_ingest_state(integer)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

GRANT EXECUTE ON FUNCTION viberacing_api.consume_origin_nonce(text, bytea, timestamptz)
  TO viberacing_ingest;
GRANT EXECUTE ON FUNCTION viberacing_api.cleanup_expired_ingest_state(integer)
  TO viberacing_jobs;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (12, 'origin_replay_store');

COMMIT;
