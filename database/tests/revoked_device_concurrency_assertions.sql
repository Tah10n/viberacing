\set ON_ERROR_STOP on

-- Read-only assertions over committed revoked-device cleanup worker-race fixtures.

SET ROLE viberacing_owner;

DO $assertion$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM viberacing_private.device_keys
    WHERE device_key_id IN (
      '00000000-0000-4000-8000-000000041201',
      '00000000-0000-4000-8000-000000041202'
    )
  ) OR EXISTS (
    SELECT 1
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id IN (
      '00000000-0000-4000-8000-000000041301',
      '00000000-0000-4000-8000-000000041302'
    )
  ) THEN
    RAISE EXCEPTION 'concurrent revoked-device workers did not delete both aged pairs once';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.device_keys
    WHERE device_key_id IN (
      '00000000-0000-4000-8000-000000041203',
      '00000000-0000-4000-8000-000000041204'
    )
  ) <> 2 OR (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id IN (
      '00000000-0000-4000-8000-000000041303',
      '00000000-0000-4000-8000-000000041304'
    )
  ) <> 2 OR NOT EXISTS (
    SELECT 1
    FROM viberacing_private.device_keys
    WHERE device_key_id = '00000000-0000-4000-8000-000000041203'
      AND state = 'revoked'
  ) OR NOT EXISTS (
    SELECT 1
    FROM viberacing_private.device_keys
    WHERE device_key_id = '00000000-0000-4000-8000-000000041204'
      AND state = 'active'
  ) THEN
    RAISE EXCEPTION 'concurrent revoked-device workers changed recent or active history';
  END IF;
END
$assertion$;

RESET ROLE;
