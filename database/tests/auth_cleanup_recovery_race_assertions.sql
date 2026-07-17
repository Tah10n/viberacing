\set ON_ERROR_STOP on

-- Read-only assertions for cleanup serialized against a concurrent recovery start. The isolated
-- integration project is destroyed after the complete database run.

SET ROLE viberacing_owner;

DO $assertion$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM viberacing_private.recovery_authorities
    WHERE recovery_authority_id = '00000000-0000-4000-8000-000000024404'
  ) OR EXISTS (
    SELECT 1
    FROM viberacing_private.recovery_codes
    WHERE recovery_code_id = '00000000-0000-4000-8000-000000024304'
  ) THEN
    RAISE EXCEPTION 'authentication cleanup retained expired recovery state after serialization';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.recovery_authorities
    WHERE recovery_authority_id = '00000000-0000-4000-8000-000000024405'
      AND profile_id = '00000000-0000-4000-8000-000000024104'
      AND source_recovery_code_id = '00000000-0000-4000-8000-000000024305'
      AND state = 'active'
      AND expires_at > pg_catalog.statement_timestamp()
  ) OR NOT EXISTS (
    SELECT 1
    FROM viberacing_private.recovery_codes
    WHERE recovery_code_id = '00000000-0000-4000-8000-000000024305'
      AND used_at IS NOT NULL
      AND verifier_phc IS NULL
  ) THEN
    RAISE EXCEPTION 'concurrent recovery start did not retain its new live authority';
  END IF;
END
$assertion$;

RESET ROLE;
