\set ON_ERROR_STOP on

-- Deterministic synthetic fixture for the expired origin-nonce replacement race. This file
-- commits only to the isolated, portless, tmpfs-backed PostgreSQL integration project.

BEGIN;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.origin_nonces (origin_key_id, nonce_digest, expires_at)
VALUES
  (
    'edge_race',
    pg_catalog.decode(pg_catalog.repeat('88', 32), 'hex'),
    pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()) - INTERVAL '1 second'
  ),
  (
    'edge_expiring_race',
    pg_catalog.decode(pg_catalog.repeat('99', 32), 'hex'),
    pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()) - INTERVAL '1 second'
  );

COMMIT;
