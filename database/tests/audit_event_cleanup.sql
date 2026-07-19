\set ON_ERROR_STOP on

-- cspell:ignore indexdef indexrelid relname indpred indnkeyatts

-- Deterministic synthetic evidence for bounded database audit-event cleanup. The transaction is
-- rolled back and does not imply an external audit sink, scheduler, backup purge, or deployment.

BEGIN;

CREATE FUNCTION pg_temp.assert_true(condition boolean, label text)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  IF condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'assertion failed: %', label;
  END IF;
END
$function$;

CREATE FUNCTION pg_temp.expect_operation_failure(statement text, label text)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected closed operation failure: %', label;
END
$function$;

CREATE FUNCTION pg_temp.expect_permission_failure(statement text, label text)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RETURN;
  END;
  RAISE EXCEPTION 'expected permission failure: %', label;
END
$function$;

SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (profile_id, github_user_id, handle, state)
VALUES (
  '00000000-0000-4000-8000-000000036101',
  900000000000036101,
  'audit-retention-profile',
  'active'
);

INSERT INTO viberacing_private.audit_events (
  audit_event_id,
  event_type,
  actor_kind,
  profile_id,
  request_id,
  reason_code,
  occurred_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000036201',
    'session.revoked',
    'profile',
    '00000000-0000-4000-8000-000000036101',
    'req_' || pg_catalog.repeat('A', 22),
    NULL,
    pg_catalog.statement_timestamp() - INTERVAL '220 days'
  ),
  (
    '00000000-0000-4000-8000-000000036202',
    'invite.issued',
    'admin',
    NULL,
    'req_' || pg_catalog.repeat('B', 22),
    'BETA_INVITE',
    pg_catalog.statement_timestamp() - INTERVAL '200 days'
  ),
  (
    '00000000-0000-4000-8000-000000036203',
    'device.revoked',
    'profile',
    '00000000-0000-4000-8000-000000036101',
    'req_' || pg_catalog.repeat('C', 22),
    NULL,
    pg_catalog.statement_timestamp() - INTERVAL '180 days'
  ),
  (
    '00000000-0000-4000-8000-000000036204',
    'passkey.authenticated',
    'profile',
    '00000000-0000-4000-8000-000000036101',
    'req_' || pg_catalog.repeat('D', 22),
    NULL,
    pg_catalog.statement_timestamp() - INTERVAL '179 days'
  );

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(index_record.indpred IS NULL)
      AND pg_catalog.bool_and(index_record.indnkeyatts = 2)
      AND pg_catalog.bool_and(
        pg_catalog.pg_get_indexdef(index_record.indexrelid, 1, false) = 'occurred_at'
      )
      AND pg_catalog.bool_and(
        pg_catalog.pg_get_indexdef(index_record.indexrelid, 2, false) = 'audit_event_id'
      )
    FROM pg_catalog.pg_index AS index_record
    JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index_record.indexrelid
    JOIN pg_catalog.pg_namespace AS index_namespace
      ON index_namespace.oid = index_relation.relnamespace
    WHERE index_namespace.nspname = 'viberacing_private'
      AND index_relation.relname = 'audit_events_time_idx'
  ),
  'audit events have one non-partial, deterministically ordered retention index'
);

SET LOCAL ROLE viberacing_jobs;

SELECT pg_temp.assert_true(
  (
    SELECT deleted_audit_events = 1
    FROM viberacing_api.cleanup_expired_audit_events(1)
  ),
  'the first batch deletes only the oldest eligible audit event'
);

SET LOCAL ROLE viberacing_owner;
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM viberacing_private.audit_events
    WHERE audit_event_id = '00000000-0000-4000-8000-000000036201'
  )
  AND EXISTS (
    SELECT 1 FROM viberacing_private.audit_events
    WHERE audit_event_id = '00000000-0000-4000-8000-000000036202'
  ),
  'audit cleanup follows server occurrence time and identifier order'
);

SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.assert_true(
  (
    SELECT deleted_audit_events = 2
    FROM viberacing_api.cleanup_expired_audit_events(10)
  ),
  'the next batch deletes all remaining audit events at or beyond 180 days'
);
SELECT pg_temp.assert_true(
  (
    SELECT deleted_audit_events = 0
    FROM viberacing_api.cleanup_expired_audit_events(10)
  ),
  'audit cleanup is idempotent after eligible rows are gone'
);

SET LOCAL ROLE viberacing_owner;
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM viberacing_private.audit_events
    WHERE audit_event_id = '00000000-0000-4000-8000-000000036204'
      AND profile_id = '00000000-0000-4000-8000-000000036101'
      AND occurred_at > pg_catalog.statement_timestamp() - INTERVAL '180 days'
  ),
  'audit evidence younger than 180 days remains untouched'
);

SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_audit_events(NULL)$sql$,
  'a null audit cleanup batch fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_audit_events(0)$sql$,
  'a zero audit cleanup batch fails closed'
);
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_audit_events(1001)$sql$,
  'an oversized audit cleanup batch fails closed'
);

SET LOCAL ROLE viberacing_web;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_audit_events(1)$sql$,
  'Web cannot run audit-event cleanup'
);
SET LOCAL ROLE viberacing_ingest;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_audit_events(1)$sql$,
  'Ingest cannot run audit-event cleanup'
);
SET LOCAL ROLE viberacing_admin;
SELECT pg_temp.expect_permission_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_audit_events(1)$sql$,
  'Admin cannot run audit-event cleanup'
);

SET LOCAL ROLE viberacing_owner;
DELETE FROM viberacing_private.maintenance_locks
WHERE capability = 'audit_retention_cleanup';
SET LOCAL ROLE viberacing_jobs;
SELECT pg_temp.expect_operation_failure(
  $sql$SELECT * FROM viberacing_api.cleanup_expired_audit_events(1)$sql$,
  'a missing private audit mutex fails audit cleanup closed'
);

ROLLBACK;
