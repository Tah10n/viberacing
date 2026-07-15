\set ON_ERROR_STOP on

-- Read-only assertions over the committed synthetic origin replay race fixture.

SET ROLE viberacing_owner;

DO $assertion$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.origin_nonces
    WHERE origin_key_id = 'edge_race'
      AND nonce_digest = pg_catalog.decode(pg_catalog.repeat('88', 32), 'hex')
      AND expires_at > pg_catalog.clock_timestamp()
  ) <> 1 THEN
    RAISE EXCEPTION 'origin replay race did not leave exactly one live consumed tuple';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM viberacing_private.origin_nonces
    WHERE origin_key_id = 'edge_expiring_race'
      AND nonce_digest = pg_catalog.decode(pg_catalog.repeat('99', 32), 'hex')
  ) THEN
    RAISE EXCEPTION 'proof expiry during lock wait left a replay tuple behind';
  END IF;
END
$assertion$;

RESET ROLE;
