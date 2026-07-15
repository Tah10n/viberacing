\set ON_ERROR_STOP on

BEGIN;
SET LOCAL ROLE viberacing_owner;

DO $assertion$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.sessions
    WHERE session_id IN (
      '00000000-0000-4000-8000-000000006211',
      '00000000-0000-4000-8000-000000006212'
    )
  ) <> 1 THEN
    RAISE EXCEPTION 'single login challenge did not create exactly one session';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.auth_challenges
    WHERE challenge_id = '00000000-0000-4000-8000-000000006601'
      AND consumed_at IS NOT NULL
      AND authorized_action_used_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'single login challenge was not consumed exactly once';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.passkeys
    WHERE passkey_id = '00000000-0000-4000-8000-000000006301'
      AND sign_count = 1
      AND last_used_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'login race did not preserve monotonic passkey usage';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.audit_events
    WHERE profile_id = '00000000-0000-4000-8000-000000006101'
      AND event_type = 'passkey.authenticated'
  ) <> 1 THEN
    RAISE EXCEPTION 'login race did not emit exactly one authentication audit event';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.passkeys
    WHERE passkey_id = '00000000-0000-4000-8000-000000006302'
      AND state = 'revoked'
      AND revoked_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'protective passkey revoke did not win the final state';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM viberacing_private.sessions
    WHERE authenticated_by_passkey_id = '00000000-0000-4000-8000-000000006302'
      AND state = 'active'
  ) THEN
    RAISE EXCEPTION 'revoked passkey retained an active browser session';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.sessions
    WHERE session_id = '00000000-0000-4000-8000-000000006201'
      AND state = 'active'
  ) THEN
    RAISE EXCEPTION 'revocation removed the unrelated surviving passkey session';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id = '00000000-0000-4000-8000-000000006501'
      AND state = 'cancelled'
  ) THEN
    RAISE EXCEPTION 'revocation retained approved device authority from the target passkey';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.audit_events
    WHERE profile_id = '00000000-0000-4000-8000-000000006102'
      AND event_type = 'passkey.revoked'
  ) <> 1 THEN
    RAISE EXCEPTION 'revocation race did not emit exactly one revoke audit event';
  END IF;
END
$assertion$;

ROLLBACK;
