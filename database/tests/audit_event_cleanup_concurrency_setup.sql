\set ON_ERROR_STOP on

-- Synthetic fixtures for the audit-event cleanup worker race. The isolated integration database
-- is portless, tmpfs-backed, and destroyed by the runner.

BEGIN;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.audit_events (
  audit_event_id,
  event_type,
  actor_kind,
  request_id,
  occurred_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000036501',
    'session.revoked',
    'system',
    'req_' || pg_catalog.repeat('E', 22),
    pg_catalog.statement_timestamp() - INTERVAL '220 days'
  ),
  (
    '00000000-0000-4000-8000-000000036502',
    'session.revoked',
    'system',
    'req_' || pg_catalog.repeat('F', 22),
    pg_catalog.statement_timestamp() - INTERVAL '200 days'
  ),
  (
    '00000000-0000-4000-8000-000000036503',
    'session.revoked',
    'system',
    'req_' || pg_catalog.repeat('G', 22),
    pg_catalog.statement_timestamp() - INTERVAL '10 days'
  );

COMMIT;
