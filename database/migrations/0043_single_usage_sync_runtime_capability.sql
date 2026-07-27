\set ON_ERROR_STOP on

-- Revision 0043: confine the Ingest runtime role to the sole unreleased UsageSyncV1 procedure.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

REVOKE EXECUTE ON FUNCTION viberacing_api.submit_community_sync(
  uuid, text, text, uuid, text, timestamptz, text, text,
  bytea, bytea, bytea, text[], bigint[]
) FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (43, 'single_usage_sync_runtime_capability');

COMMIT;
