\set ON_ERROR_STOP on

-- Read-only assertions over committed synthetic recovery race fixtures. The enclosing integration
-- environment is isolated and destroyed after the runner finishes.

BEGIN;
SET LOCAL ROLE viberacing_owner;

DO $assertion$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.recovery_codes
    WHERE recovery_code_id = '00000000-0000-4000-8000-000000005701'
      AND used_at IS NOT NULL
      AND verifier_phc IS NULL
  ) THEN
    RAISE EXCEPTION 'single-code recovery race did not terminally scrub the code';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.recovery_authorities
    WHERE profile_id = '00000000-0000-4000-8000-000000005101'
      AND state = 'active'
  ) <> 1 THEN
    RAISE EXCEPTION 'single-code recovery race did not create exactly one active authority';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.audit_events
    WHERE profile_id = '00000000-0000-4000-8000-000000005101'
      AND event_type = 'recovery.started'
  ) <> 1 THEN
    RAISE EXCEPTION 'single-code recovery race did not emit exactly one start audit event';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM viberacing_private.recovery_codes
    WHERE recovery_code_id = '00000000-0000-4000-8000-000000005702'
  ) OR (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.recovery_codes
    WHERE profile_id = '00000000-0000-4000-8000-000000005102'
      AND batch_id = '00000000-0000-4000-8000-000000005612'
      AND used_at IS NULL
      AND verifier_phc IS NOT NULL
  ) <> 8 THEN
    RAISE EXCEPTION 'protective recovery-code rotation did not replace the old batch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM viberacing_private.recovery_authorities
    WHERE profile_id = '00000000-0000-4000-8000-000000005102'
      AND state = 'active'
  ) THEN
    RAISE EXCEPTION 'protective recovery-code rotation left old-code authority active';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.auth_challenges
    WHERE challenge_id = '00000000-0000-4000-8000-000000005802'
      AND authorized_action_used_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'protective recovery-code rotation did not consume exact step-up authority';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.recovery_authorities
    WHERE recovery_authority_id = '00000000-0000-4000-8000-000000005913'
      AND state = 'completed'
      AND completed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'protective recovery completion did not terminally complete authority';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.passkeys
    WHERE passkey_id = '00000000-0000-4000-8000-000000005313'
      AND profile_id = '00000000-0000-4000-8000-000000005103'
      AND state = 'active'
  ) OR EXISTS (
    SELECT 1
    FROM viberacing_private.passkeys
    WHERE passkey_id = '00000000-0000-4000-8000-000000005303'
      AND state = 'active'
  ) THEN
    RAISE EXCEPTION 'protective recovery completion did not replace old passkey authority';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.sessions
    WHERE session_id = '00000000-0000-4000-8000-000000005213'
      AND profile_id = '00000000-0000-4000-8000-000000005103'
      AND state = 'active'
      AND authenticated_by_passkey_id = '00000000-0000-4000-8000-000000005313'
  ) OR EXISTS (
    SELECT 1
    FROM viberacing_private.sessions
    WHERE profile_id = '00000000-0000-4000-8000-000000005103'
      AND session_id <> '00000000-0000-4000-8000-000000005213'
      AND state = 'active'
  ) THEN
    RAISE EXCEPTION 'protective recovery completion left stale browser authority active';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM viberacing_private.recovery_codes
    WHERE profile_id = '00000000-0000-4000-8000-000000005103'
  ) THEN
    RAISE EXCEPTION 'protective recovery completion retained recovery codes';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.audit_events
    WHERE profile_id = '00000000-0000-4000-8000-000000005103'
      AND event_type = 'recovery.completed'
  ) <> 1 THEN
    RAISE EXCEPTION 'protective recovery completion did not emit exactly one completion audit';
  END IF;
END
$assertion$;

ROLLBACK;
