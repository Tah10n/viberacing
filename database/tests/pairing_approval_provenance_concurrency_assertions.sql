\set ON_ERROR_STOP on

-- Read-only assertions over committed pairing approval-provenance worker-race fixtures.

SET ROLE viberacing_owner;

DO $assertion$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id IN (
      '00000000-0000-4000-8000-000000037631',
      '00000000-0000-4000-8000-000000037632'
    )
  ) <> 2 OR EXISTS (
    SELECT 1
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id IN (
      '00000000-0000-4000-8000-000000037631',
      '00000000-0000-4000-8000-000000037632'
    )
      AND (
        approved_by_session_id IS NOT NULL
        OR approved_by_passkey_id IS NOT NULL
        OR state <> 'activated'
        OR approved_source_id <> 'src_' || pg_catalog.lpad('37601', 22, 'P')
        OR activated_device_id NOT IN (
          'dev_' || pg_catalog.lpad('37621', 22, 'P'),
          'dev_' || pg_catalog.lpad('37622', 22, 'P')
        )
      )
  ) THEN
    RAISE EXCEPTION 'concurrent provenance workers did not redact each aged pairing once';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '00000000-0000-4000-8000-000000037633'
      AND state = 'activated'
      AND approved_by_session_id = '00000000-0000-4000-8000-000000037613'
      AND approved_by_passkey_id = '00000000-0000-4000-8000-000000037602'
      AND approved_source_id = 'src_' || pg_catalog.lpad('37601', 22, 'P')
      AND activated_device_id = 'dev_' || pg_catalog.lpad('37623', 22, 'P')
  ) THEN
    RAISE EXCEPTION 'concurrent provenance workers changed recent approval or device binding';
  END IF;
END
$assertion$;

RESET ROLE;
