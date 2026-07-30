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
  ) OR NOT EXISTS (
    SELECT 1
    FROM viberacing_private.schema_migrations
    WHERE revision = 3
      AND name = 'agent_accounts_installations_and_pairing'
  ) OR NOT EXISTS (
    SELECT 1
    FROM viberacing_private.schema_migrations
    WHERE revision = 4
      AND name = 'usage_ingest_replay_and_idempotency'
  ) OR NOT EXISTS (
    SELECT 1
    FROM viberacing_private.schema_migrations
    WHERE revision = 5
      AND name = 'seasons_ranking_and_snapshots'
  ) OR NOT EXISTS (
    SELECT 1
    FROM viberacing_private.schema_migrations
    WHERE revision = 6
      AND name = 'retention_deletion_admin_and_audit'
  ) OR NOT EXISTS (
    SELECT 1
    FROM viberacing_private.schema_migrations
    WHERE revision = 7
      AND name = 'car_recipes'
  ) OR (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.schema_migrations
  ) <> 7 THEN
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

  IF v_private_table_count <> 36 OR v_forced_rls_count <> v_private_table_count THEN
    RAISE EXCEPTION 'private tables are not exactly force-RLS protected';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.agent_providers
    WHERE provider_code = 'codex'
      AND state = 'recognized'
  ) OR NOT EXISTS (
    SELECT 1
    FROM viberacing_private.agent_accounting_revisions
    WHERE provider_code = 'codex'
      AND accounting_revision = 1
      AND NOT enabled_for_new_accounts
  ) OR (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.agent_providers
  ) <> 6 THEN
    RAISE EXCEPTION 'closed provider inventory or Codex candidate state is invalid';
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
