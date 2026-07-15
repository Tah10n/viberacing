\set ON_ERROR_STOP on

-- Read-only assertions over committed synthetic ingest race fixtures. The enclosing integration
-- project is ephemeral and is destroyed immediately after the complete test run.

CREATE FUNCTION pg_temp.ingest_race_date()
RETURNS date
LANGUAGE sql
STABLE
AS $function$
  SELECT pg_catalog.current_setting('viberacing.test_week_start')::date
$function$;

SET ROLE viberacing_owner;

DO $assertion$
DECLARE
  lower_snapshot_outcome text;
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.usage_snapshots
    WHERE source_id = 'src_' || pg_catalog.repeat('S', 22)
  ) <> 1
    OR (
      SELECT pg_catalog.count(*)
      FROM viberacing_private.device_nonces
      WHERE device_key_id = '00000000-0000-4000-8000-000000011401'
    ) <> 1
    OR (
      SELECT tokens
      FROM viberacing_private.source_day_values
      WHERE source_id = 'src_' || pg_catalog.repeat('S', 22)
        AND codex_reported_date = pg_temp.ingest_race_date()
    ) <> 321 THEN
    RAISE EXCEPTION 'concurrent exact retry created duplicate or inconsistent ingest state';
  END IF;

  SELECT outcome
  INTO lower_snapshot_outcome
  FROM viberacing_private.usage_snapshots
  WHERE usage_snapshot_id = '00000000-0000-4000-8000-000000011502';

  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.usage_snapshots
    WHERE source_id = 'src_' || pg_catalog.repeat('T', 22)
  ) <> 2
    OR lower_snapshot_outcome NOT IN ('accepted', 'quarantined')
    OR (
      SELECT outcome
      FROM viberacing_private.usage_snapshots
      WHERE usage_snapshot_id = '00000000-0000-4000-8000-000000011501'
    ) <> 'accepted'
    OR (
      SELECT tokens = 700
        AND accepted_snapshot_id = '00000000-0000-4000-8000-000000011501'
        AND accepted_device_id = 'dev_' || pg_catalog.repeat('T', 22)
      FROM viberacing_private.source_day_values
      WHERE source_id = 'src_' || pg_catalog.repeat('T', 22)
        AND codex_reported_date = pg_temp.ingest_race_date()
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'concurrent same-source devices did not converge on the monotonic maximum';
  END IF;

  IF (
    SELECT state
    FROM viberacing_private.codex_sources
    WHERE source_id = 'src_' || pg_catalog.repeat('W', 22)
  ) <> 'paused'
    OR (
      SELECT pg_catalog.count(*)
      FROM viberacing_private.usage_snapshots
      WHERE source_id = 'src_' || pg_catalog.repeat('W', 22)
    ) <> 0
    OR EXISTS (
      SELECT 1
      FROM viberacing_private.device_nonces
      WHERE device_key_id = '00000000-0000-4000-8000-000000011404'
    )
    OR EXISTS (
      SELECT 1
      FROM viberacing_private.source_day_values
      WHERE source_id = 'src_' || pg_catalog.repeat('W', 22)
    )
    OR (
      SELECT pg_catalog.count(*)
      FROM viberacing_private.audit_events
      WHERE audit_event_id = '00000000-0000-4000-8000-000000011801'
        AND event_type = 'source.paused'
    ) <> 1 THEN
    RAISE EXCEPTION 'pause race left source or ingest state inconsistent';
  END IF;

  IF (
    SELECT state
    FROM viberacing_private.device_keys
    WHERE device_key_id = '00000000-0000-4000-8000-000000011405'
  ) <> 'revoked'
    OR (
      SELECT pg_catalog.count(*)
      FROM viberacing_private.usage_snapshots
      WHERE device_key_id = '00000000-0000-4000-8000-000000011405'
    ) <> 0
    OR EXISTS (
      SELECT 1
      FROM viberacing_private.device_nonces
      WHERE device_key_id = '00000000-0000-4000-8000-000000011405'
    )
    OR EXISTS (
      SELECT 1
      FROM viberacing_private.source_day_values
      WHERE source_id = 'src_' || pg_catalog.repeat('Z', 22)
    )
    OR (
      SELECT pg_catalog.count(*)
      FROM viberacing_private.audit_events
      WHERE audit_event_id = '00000000-0000-4000-8000-000000011802'
        AND event_type = 'device.revoked'
    ) <> 1 THEN
    RAISE EXCEPTION 'revoke race left device or ingest state inconsistent';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM viberacing_private.usage_snapshots AS snapshot_record
    JOIN viberacing_private.codex_sources AS source_record
      ON source_record.source_id = snapshot_record.source_id
    WHERE source_record.source_id = 'src_' || pg_catalog.repeat('W', 22)
      AND snapshot_record.received_at > source_record.state_changed_at
  ) OR EXISTS (
    SELECT 1
    FROM viberacing_private.usage_snapshots AS snapshot_record
    JOIN viberacing_private.device_keys AS device_record
      ON device_record.device_key_id = snapshot_record.device_key_id
    WHERE device_record.device_key_id = '00000000-0000-4000-8000-000000011405'
      AND snapshot_record.received_at > device_record.revoked_at
  ) THEN
    RAISE EXCEPTION 'protective lifecycle action allowed a later ingest write';
  END IF;
END
$assertion$;

RESET ROLE;
