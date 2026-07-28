DO $assertion$
DECLARE
  v_private_table_count integer;
  v_forced_rls_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.schema_migrations
    WHERE revision = 1
      AND name = 'roles_schemas_and_identity'
  ) OR NOT EXISTS (
    SELECT 1
    FROM viberacing_private.schema_migrations
    WHERE revision = 2
      AND name = 'authentication_passkeys_and_recovery'
  ) THEN
    RAISE EXCEPTION 'clean bootstrap ledger is incomplete';
  END IF;

  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) FILTER (WHERE relation.relrowsecurity AND relation.relforcerowsecurity)::integer
  INTO v_private_table_count, v_forced_rls_count
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'viberacing_private'
    AND relation.relkind = 'r';

  IF v_private_table_count <> 7 OR v_forced_rls_count <> v_private_table_count THEN
    RAISE EXCEPTION 'private tables are not exactly force-RLS protected';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'viberacing_private'
      AND relation.relname IN (
        'codex_sources',
        'source_day_values',
        'score_versions',
        'season_entries',
        'season_daily_scores',
        'usage_snapshots'
      )
  ) THEN
    RAISE EXCEPTION 'legacy Codex or score objects remain';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants AS grant_row
    WHERE grant_row.table_schema = 'viberacing_private'
      AND grant_row.grantee IN (
        'viberacing_web',
        'viberacing_ingest',
        'viberacing_jobs',
        'viberacing_admin',
        'PUBLIC'
      )
  ) THEN
    RAISE EXCEPTION 'runtime or PUBLIC role has a private table grant';
  END IF;
END
$assertion$;
