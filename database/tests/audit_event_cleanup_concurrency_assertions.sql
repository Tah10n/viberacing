\set ON_ERROR_STOP on

-- Read-only assertions over committed synthetic audit-event cleanup race fixtures.

SET ROLE viberacing_owner;

DO $assertion$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM viberacing_private.audit_events
    WHERE audit_event_id IN (
      '00000000-0000-4000-8000-000000036501',
      '00000000-0000-4000-8000-000000036502'
    )
  ) THEN
    RAISE EXCEPTION 'concurrent audit cleanup did not remove each aged batch once';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.audit_events
    WHERE audit_event_id = '00000000-0000-4000-8000-000000036503'
      AND occurred_at > pg_catalog.statement_timestamp() - INTERVAL '180 days'
  ) THEN
    RAISE EXCEPTION 'concurrent audit cleanup removed retained evidence';
  END IF;
END
$assertion$;

RESET ROLE;
