\set ON_ERROR_STOP on

-- Revision 0041 must label every pre-existing source and make that attribution immutable.

SET ROLE viberacing_owner;

DO $assertions$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.codex_sources
    WHERE source_id = 'src_' || pg_catalog.lpad('41801', 22, 'U')
      AND provider = 'codex'
      AND accounting_revision = 'codex_daily_usage_buckets_v1'
  ) THEN
    RAISE EXCEPTION 'revision 0041 did not backfill exact source attribution';
  END IF;

  BEGIN
    UPDATE viberacing_private.codex_sources
    SET provider = 'other'
    WHERE source_id = 'src_' || pg_catalog.lpad('41801', 22, 'U');
    RAISE EXCEPTION 'revision 0041 allowed provider attribution mutation';
  EXCEPTION
    WHEN integrity_constraint_violation THEN
      NULL;
  END;

  BEGIN
    UPDATE viberacing_private.codex_sources
    SET accounting_revision = 'other'
    WHERE source_id = 'src_' || pg_catalog.lpad('41801', 22, 'U');
    RAISE EXCEPTION 'revision 0041 allowed accounting revision mutation';
  EXCEPTION
    WHEN integrity_constraint_violation THEN
      NULL;
  END;
END
$assertions$;

RESET ROLE;
