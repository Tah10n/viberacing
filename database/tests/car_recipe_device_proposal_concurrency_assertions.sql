\set ON_ERROR_STOP on

-- Read-only assertions over the committed synthetic device-proposal race fixture.

SET ROLE viberacing_owner;

DO $assertion$
BEGIN
  IF (
    SELECT state
    FROM viberacing_private.codex_sources
    WHERE source_id = 'src_' || pg_catalog.repeat('4', 22)
  ) IS DISTINCT FROM 'paused'
    OR EXISTS (
      SELECT 1
      FROM viberacing_private.car_recipe_proposals
      WHERE profile_id = '00000000-0000-4000-8000-000000028104'
    )
    OR EXISTS (
      SELECT 1
      FROM viberacing_private.device_nonces
      WHERE device_key_id = '00000000-0000-4000-8000-000000028404'
    )
    OR (
      SELECT pg_catalog.count(*)
      FROM viberacing_private.audit_events
      WHERE audit_event_id = '00000000-0000-4000-8000-000000028804'
        AND event_type = 'source.paused'
    ) <> 1 THEN
    RAISE EXCEPTION 'source pause did not dominate the concurrent device proposal';
  END IF;
END
$assertion$;

RESET ROLE;
