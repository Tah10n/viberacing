\set ON_ERROR_STOP on

-- Read-only assertions over committed synthetic cleanup race fixtures. The enclosing integration
-- project is ephemeral and is destroyed immediately after the complete test run.

SET ROLE viberacing_owner;

DO $assertion$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM viberacing_private.usage_snapshots
    WHERE usage_snapshot_id IN (
      '00000000-0000-4000-8000-000000013501',
      '00000000-0000-4000-8000-000000013502'
    )
  )
    OR EXISTS (
      SELECT 1
      FROM viberacing_private.usage_snapshot_entries
      WHERE usage_snapshot_id IN (
        '00000000-0000-4000-8000-000000013501',
        '00000000-0000-4000-8000-000000013502'
      )
    )
    OR (
      SELECT pg_catalog.count(*)
      FROM viberacing_private.origin_nonces
      WHERE origin_key_id = 'edge_cleanup_race'
    ) <> 1
    OR (
      SELECT pg_catalog.count(*)
      FROM viberacing_private.device_nonces
      WHERE device_key_id = '00000000-0000-4000-8000-000000013401'
    ) <> 1 THEN
    RAISE EXCEPTION 'concurrent cleanup did not remove each expired raw row exactly once';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.origin_nonces
    WHERE origin_key_id = 'edge_cleanup_race'
      AND expires_at > pg_catalog.statement_timestamp()
  ) <> 1
    OR (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.usage_snapshots
    WHERE usage_snapshot_id = '00000000-0000-4000-8000-000000013503'
  ) <> 1
    OR (
      SELECT pg_catalog.count(*)
      FROM viberacing_private.usage_snapshot_entries
      WHERE usage_snapshot_id = '00000000-0000-4000-8000-000000013503'
    ) <> 1
    OR NOT EXISTS (
      SELECT 1
      FROM viberacing_private.device_nonces
      WHERE device_key_id = '00000000-0000-4000-8000-000000013401'
        AND expires_at > pg_catalog.statement_timestamp()
    ) THEN
    RAISE EXCEPTION 'concurrent cleanup removed live ingest state';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.source_day_values
    WHERE source_id = 'src_' || pg_catalog.repeat('C', 22)
      AND accepted_snapshot_id IS NULL
  ) <> 2
    OR (
      SELECT accepted_snapshot_id
      FROM viberacing_private.source_day_values
      WHERE source_id = 'src_' || pg_catalog.repeat('C', 22)
        AND codex_reported_date = '2026-07-15'
    ) <> '00000000-0000-4000-8000-000000013503' THEN
    RAISE EXCEPTION 'concurrent cleanup did not preserve aggregate values and live provenance';
  END IF;
END
$assertion$;

RESET ROLE;
