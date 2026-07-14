\set ON_ERROR_STOP on

-- Read-only assertions over committed synthetic lifecycle race fixtures. The enclosing integration
-- project is ephemeral and is destroyed immediately after the complete test run.

SET ROLE viberacing_owner;

DO $assertion$
DECLARE
  pause_pairing_state text;
  unlink_pairing_state text;
  unlink_pending_key_state text;
BEGIN
  SELECT state
  INTO pause_pairing_state
  FROM viberacing_private.pairing_transactions
  WHERE pairing_id = '00000000-0000-4000-8000-000000007501';

  IF (
    SELECT state
    FROM viberacing_private.codex_sources
    WHERE source_id = 'src_' || pg_catalog.repeat('L', 22)
  ) <> 'paused'
    OR pause_pairing_state NOT IN ('pending', 'cancelled')
    OR EXISTS (
      SELECT 1
      FROM viberacing_private.pairing_transactions
      WHERE pairing_id = '00000000-0000-4000-8000-000000007501'
        AND state IN ('approved', 'activated')
    )
    OR EXISTS (
      SELECT 1
      FROM viberacing_private.auth_challenges
      WHERE challenge_id = '00000000-0000-4000-8000-000000007701'
        AND authorized_action_used_at IS NULL
    ) THEN
    RAISE EXCEPTION 'pause race left source submission or approved pairing authority live';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.audit_events
    WHERE profile_id = '00000000-0000-4000-8000-000000007101'
      AND event_type = 'source.paused'
  ) <> 1 OR (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.audit_events
    WHERE profile_id = '00000000-0000-4000-8000-000000007101'
      AND event_type = 'pairing.approved'
  ) NOT IN (0, 1) THEN
    RAISE EXCEPTION 'pause race emitted an invalid lifecycle audit outcome';
  END IF;

  SELECT state
  INTO unlink_pairing_state
  FROM viberacing_private.pairing_transactions
  WHERE pairing_id = '00000000-0000-4000-8000-000000007502';

  SELECT state
  INTO unlink_pending_key_state
  FROM viberacing_private.device_keys
  WHERE device_key_id = '00000000-0000-4000-8000-000000007452';

  IF (
    SELECT state
    FROM viberacing_private.codex_sources
    WHERE source_id = 'src_' || pg_catalog.repeat('N', 22)
  ) <> 'unlinked'
    OR EXISTS (
      SELECT 1
      FROM viberacing_private.device_keys
      WHERE source_id = 'src_' || pg_catalog.repeat('N', 22)
        AND state = 'active'
    )
    OR unlink_pairing_state NOT IN ('cancelled', 'activated')
    OR NOT (
      (unlink_pairing_state = 'cancelled' AND unlink_pending_key_state = 'pending')
      OR (unlink_pairing_state = 'activated' AND unlink_pending_key_state = 'revoked')
    )
    OR NOT EXISTS (
      SELECT 1
      FROM viberacing_private.auth_challenges
      WHERE challenge_id = '00000000-0000-4000-8000-000000007702'
        AND authorized_action_used_at IS NOT NULL
    )
    OR EXISTS (
      SELECT 1
      FROM viberacing_private.auth_challenges
      WHERE authorized_source_id = 'src_' || pg_catalog.repeat('N', 22)
        AND authorized_action_used_at IS NULL
    ) THEN
    RAISE EXCEPTION 'unlink race left an inconsistent source, pairing, device, or challenge state';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.audit_events
    WHERE profile_id = '00000000-0000-4000-8000-000000007102'
      AND event_type = 'source.unlinked'
  ) <> 1 OR (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.audit_events
    WHERE profile_id = '00000000-0000-4000-8000-000000007102'
      AND event_type = 'device.activated'
  ) NOT IN (0, 1) THEN
    RAISE EXCEPTION 'unlink race emitted an invalid lifecycle audit outcome';
  END IF;
END
$assertion$;

RESET ROLE;
