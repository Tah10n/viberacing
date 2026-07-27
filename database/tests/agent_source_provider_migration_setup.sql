\set ON_ERROR_STOP on

-- Persist one synthetic revision-0040 source so revision 0041 must exercise its attribution backfill.

BEGIN;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (profile_id, github_user_id, handle, state)
VALUES (
  '00000000-0000-4000-8000-000000041801',
  900000000000041801,
  'provider-backfill',
  'active'
);

INSERT INTO viberacing_private.codex_sources (source_id, profile_id)
VALUES (
  'src_' || pg_catalog.lpad('41801', 22, 'U'),
  '00000000-0000-4000-8000-000000041801'
);

COMMIT;
