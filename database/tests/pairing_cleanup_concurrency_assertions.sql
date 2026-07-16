\set ON_ERROR_STOP on

-- Read-only assertions over committed synthetic pairing-cleanup race fixtures. The integration
-- runner destroys the enclosing isolated database after the complete test run.

SET ROLE viberacing_owner;

DO $assertion$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id IN (
      '00000000-0000-4000-8000-000000021501',
      '00000000-0000-4000-8000-000000021502'
    )
  )
    OR EXISTS (
      SELECT 1
      FROM viberacing_private.device_keys
      WHERE device_key_id IN (
        '00000000-0000-4000-8000-000000021401',
        '00000000-0000-4000-8000-000000021402'
      )
    ) THEN
    RAISE EXCEPTION 'concurrent pairing cleanup did not remove each expired pair exactly once';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '00000000-0000-4000-8000-000000021503'
      AND state = 'pending'
      AND expires_at > pg_catalog.statement_timestamp()
  )
    OR NOT EXISTS (
      SELECT 1
      FROM viberacing_private.device_keys
      WHERE device_key_id = '00000000-0000-4000-8000-000000021403'
        AND state = 'pending'
    ) THEN
    RAISE EXCEPTION 'concurrent pairing cleanup removed live pending state';
  END IF;
END
$assertion$;

RESET ROLE;
