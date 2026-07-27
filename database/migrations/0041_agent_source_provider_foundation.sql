\set ON_ERROR_STOP on

-- Revision 0041: immutable provider attribution and provider-neutral Community usage submission.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

ALTER TABLE viberacing_private.codex_sources
  ADD COLUMN provider varchar(16) NOT NULL DEFAULT 'codex',
  ADD COLUMN accounting_revision varchar(64) NOT NULL
    DEFAULT 'codex_daily_usage_buckets_v1',
  ADD CONSTRAINT codex_sources_provider CHECK (provider = 'codex'),
  ADD CONSTRAINT codex_sources_accounting_revision CHECK (
    accounting_revision = 'codex_daily_usage_buckets_v1'
  );

CREATE OR REPLACE FUNCTION viberacing_private.enforce_source_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.source_id IS DISTINCT FROM OLD.source_id
    OR NEW.profile_id IS DISTINCT FROM OLD.profile_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'source binding is immutable';
  END IF;

  IF NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.accounting_revision IS DISTINCT FROM OLD.accounting_revision THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'source attribution is immutable';
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state
    AND NOT (
      (OLD.state = 'active' AND NEW.state IN ('paused', 'unlinked', 'quarantined'))
      OR (OLD.state = 'paused' AND NEW.state IN ('active', 'unlinked', 'quarantined'))
      OR (OLD.state = 'quarantined' AND NEW.state IN ('active', 'paused', 'unlinked'))
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'invalid source state transition';
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state THEN
    NEW.state_changed_at := pg_catalog.statement_timestamp();
  ELSIF NEW.state_changed_at IS DISTINCT FROM OLD.state_changed_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '23000',
      MESSAGE = 'source state timestamp is server managed';
  END IF;

  RETURN NEW;
END
$function$;

DROP FUNCTION viberacing_api.read_device_verification_material(text);

CREATE FUNCTION viberacing_api.read_device_verification_material(
  p_device_id text
)
RETURNS TABLE (
  device_key_id uuid,
  source_id text,
  public_key bytea,
  provider text,
  accounting_revision text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF p_device_id IS NULL OR p_device_id !~ '^dev_[A-Za-z0-9_-]{22}$' THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  RETURN QUERY
  SELECT
    device_record.device_key_id,
    device_record.source_id::text,
    device_record.public_key,
    source_record.provider::text,
    source_record.accounting_revision::text
  FROM viberacing_private.device_keys AS device_record
  JOIN viberacing_private.codex_sources AS source_record
    ON source_record.source_id = device_record.source_id
  JOIN viberacing_private.profiles AS profile_record
    ON profile_record.profile_id = source_record.profile_id
  WHERE device_record.device_id = p_device_id
    AND device_record.state = 'active'
    AND source_record.state IN ('active', 'quarantined')
    AND profile_record.state IN ('active', 'hidden');
END
$function$;

CREATE FUNCTION viberacing_api.submit_usage_sync(
  p_device_key_id uuid,
  p_device_id text,
  p_source_id text,
  p_provider text,
  p_accounting_revision text,
  p_usage_snapshot_id uuid,
  p_sync_id text,
  p_observed_at timestamptz,
  p_client_version text,
  p_agent_version text,
  p_body_digest bytea,
  p_signature bytea,
  p_nonce_digest bytea,
  p_reported_dates text[],
  p_daily_token_totals bigint[]
)
RETURNS TABLE (
  outcome text,
  accepted_entries integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  bound_provider text;
  bound_accounting_revision text;
BEGIN
  IF p_provider IS DISTINCT FROM 'codex'
    OR p_accounting_revision IS DISTINCT FROM 'codex_daily_usage_buckets_v1' THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT
    source_record.provider,
    source_record.accounting_revision
  INTO
    bound_provider,
    bound_accounting_revision
  FROM viberacing_private.device_keys AS device_record
  JOIN viberacing_private.codex_sources AS source_record
    ON source_record.source_id = device_record.source_id
  WHERE device_record.device_key_id = p_device_key_id
    AND device_record.device_id = p_device_id
    AND device_record.source_id = p_source_id;

  IF bound_provider IS DISTINCT FROM p_provider
    OR bound_accounting_revision IS DISTINCT FROM p_accounting_revision THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  RETURN QUERY
  SELECT
    submission.outcome,
    submission.accepted_entries
  FROM viberacing_api.submit_community_sync(
    p_device_key_id,
    p_device_id,
    p_source_id,
    p_usage_snapshot_id,
    p_sync_id,
    p_observed_at,
    p_client_version,
    p_agent_version,
    p_body_digest,
    p_signature,
    p_nonce_digest,
    p_reported_dates,
    p_daily_token_totals
  ) AS submission;

  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
EXCEPTION
  WHEN data_exception OR integrity_constraint_violation OR lock_not_available THEN
    PERFORM viberacing_private.operation_failed();
    RETURN;
END
$function$;

REVOKE EXECUTE ON FUNCTION viberacing_api.read_device_verification_material(text)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
REVOKE EXECUTE ON FUNCTION viberacing_api.submit_usage_sync(
  uuid, text, text, text, text, uuid, text, timestamptz, text, text,
  bytea, bytea, bytea, text[], bigint[]
) FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

GRANT EXECUTE ON FUNCTION viberacing_api.read_device_verification_material(text)
  TO viberacing_ingest;
GRANT EXECUTE ON FUNCTION viberacing_api.submit_usage_sync(
  uuid, text, text, text, text, uuid, text, timestamptz, text, text,
  bytea, bytea, bytea, text[], bigint[]
) TO viberacing_ingest;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (41, 'agent_source_provider_foundation');

COMMIT;
