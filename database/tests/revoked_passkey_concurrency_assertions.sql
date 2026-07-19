\set ON_ERROR_STOP on

-- Read-only assertions over committed revoked-passkey cleanup worker-race fixtures.

SET ROLE viberacing_owner;

DO $assertion$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM viberacing_private.passkeys
    WHERE passkey_id IN (
      '00000000-0000-4000-8000-000000039201',
      '00000000-0000-4000-8000-000000039202'
    )
  ) THEN
    RAISE EXCEPTION 'concurrent revoked-passkey workers did not delete both aged rows once';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.passkeys
    WHERE passkey_id IN (
      '00000000-0000-4000-8000-000000039203',
      '00000000-0000-4000-8000-000000039204'
    )
  ) <> 2 OR NOT EXISTS (
    SELECT 1
    FROM viberacing_private.passkeys
    WHERE passkey_id = '00000000-0000-4000-8000-000000039203'
      AND state = 'revoked'
  ) OR NOT EXISTS (
    SELECT 1
    FROM viberacing_private.passkeys
    WHERE passkey_id = '00000000-0000-4000-8000-000000039204'
      AND state = 'active'
  ) THEN
    RAISE EXCEPTION 'concurrent revoked-passkey workers changed recent or active credentials';
  END IF;
END
$assertion$;

RESET ROLE;
