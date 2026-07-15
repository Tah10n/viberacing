\set ON_ERROR_STOP on

-- Read-only assertions over committed synthetic identity race fixtures. The enclosing integration
-- environment is isolated and destroyed after the runner finishes.

BEGIN;
SET LOCAL ROLE viberacing_owner;

DO $assertion$
DECLARE
  enrolled_profile_id uuid;
  replacement_session_id uuid;
BEGIN
  SELECT redeemed_profile_id
  INTO enrolled_profile_id
  FROM viberacing_private.invites
  WHERE invite_id = '00000000-0000-4000-8000-000000004701'
    AND state = 'redeemed'
    AND redeemed_at IS NOT NULL;

  IF enrolled_profile_id IS NULL OR enrolled_profile_id NOT IN (
    '00000000-0000-4000-8000-000000004111',
    '00000000-0000-4000-8000-000000004112'
  ) THEN
    RAISE EXCEPTION 'enrollment race did not redeem the invite for one contender';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.profiles
    WHERE profile_id IN (
      '00000000-0000-4000-8000-000000004111',
      '00000000-0000-4000-8000-000000004112'
    )
  ) <> 1 OR NOT EXISTS (
    SELECT 1
    FROM viberacing_private.profiles
    WHERE profile_id = enrolled_profile_id
      AND state = 'enrolling'
  ) THEN
    RAISE EXCEPTION 'enrollment race did not retain exactly one enrolling profile';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.sessions
    WHERE session_id IN (
      '00000000-0000-4000-8000-000000004211',
      '00000000-0000-4000-8000-000000004212'
    )
  ) <> 1 OR (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.sessions
    WHERE session_id IN (
      '00000000-0000-4000-8000-000000004211',
      '00000000-0000-4000-8000-000000004212'
    )
      AND profile_id = enrolled_profile_id
      AND state = 'active'
      AND authentication_kind = 'enrollment'
      AND authenticated_by_passkey_id IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'enrollment race did not retain exactly one bound session';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.audit_events
    WHERE profile_id IN (
      '00000000-0000-4000-8000-000000004111',
      '00000000-0000-4000-8000-000000004112'
    )
      AND event_type = 'profile.enrolled'
  ) <> 1 THEN
    RAISE EXCEPTION 'enrollment race did not emit exactly one enrollment audit event';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.auth_challenges
    WHERE challenge_id = '00000000-0000-4000-8000-000000004603'
      AND purpose = 'passkey_registration'
      AND consumed_at IS NOT NULL
      AND verified_by_passkey_id IS NULL
      AND authorized_action_used_at IS NULL
  ) THEN
    RAISE EXCEPTION 'challenge race did not consume the registration challenge exactly once';
  END IF;

  SELECT replaced_by_session_id
  INTO replacement_session_id
  FROM viberacing_private.sessions
  WHERE session_id = '00000000-0000-4000-8000-000000004204'
    AND state = 'rotated'
    AND ended_at IS NOT NULL;

  IF replacement_session_id IS NULL OR replacement_session_id NOT IN (
    '00000000-0000-4000-8000-000000004221',
    '00000000-0000-4000-8000-000000004222'
  ) THEN
    RAISE EXCEPTION 'session rotation race did not retain one replacement binding';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.sessions
    WHERE session_id IN (
      '00000000-0000-4000-8000-000000004221',
      '00000000-0000-4000-8000-000000004222'
    )
  ) <> 1 OR (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.sessions
    WHERE session_id IN (
      '00000000-0000-4000-8000-000000004221',
      '00000000-0000-4000-8000-000000004222'
    )
      AND session_id = replacement_session_id
      AND profile_id = '00000000-0000-4000-8000-000000004104'
      AND state = 'active'
      AND authentication_kind = 'passkey'
      AND authenticated_by_passkey_id = '00000000-0000-4000-8000-000000004304'
  ) <> 1 THEN
    RAISE EXCEPTION 'session rotation race did not preserve exact passkey provenance';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.audit_events
    WHERE profile_id = '00000000-0000-4000-8000-000000004104'
      AND event_type = 'session.rotated'
  ) <> 1 THEN
    RAISE EXCEPTION 'session rotation race did not emit exactly one rotation audit event';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.profiles
    WHERE profile_id = '00000000-0000-4000-8000-000000004105'
      AND state = 'deletion_pending'
      AND hidden_at IS NOT NULL
      AND deletion_requested_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'protective deletion did not win the final profile state';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM viberacing_private.sessions
    WHERE profile_id = '00000000-0000-4000-8000-000000004105'
      AND state = 'active'
  ) OR EXISTS (
    SELECT 1
    FROM viberacing_private.passkeys
    WHERE profile_id = '00000000-0000-4000-8000-000000004105'
      AND state = 'active'
  ) THEN
    RAISE EXCEPTION 'protective deletion left browser or passkey authority active';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM viberacing_private.sessions
    WHERE session_id = '00000000-0000-4000-8000-000000004225'
  ) THEN
    RAISE EXCEPTION 'concurrent rotation survived protective deletion';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM viberacing_private.auth_challenges
    WHERE challenge_id = '00000000-0000-4000-8000-000000004605'
  ) THEN
    RAISE EXCEPTION 'protective deletion retained its consumed challenge';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.deletion_jobs
    WHERE deletion_job_id = '00000000-0000-4000-8000-000000004505'
      AND profile_id = '00000000-0000-4000-8000-000000004105'
      AND profile_ref_digest = pg_catalog.decode(pg_catalog.lpad('4505', 64, '0'), 'hex')
      AND state = 'queued'
  ) THEN
    RAISE EXCEPTION 'protective deletion did not queue the exact purge reference';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.audit_events
    WHERE profile_id = '00000000-0000-4000-8000-000000004105'
      AND event_type = 'deletion.requested'
  ) <> 1 THEN
    RAISE EXCEPTION 'deletion race did not emit exactly one deletion audit event';
  END IF;
END
$assertion$;

ROLLBACK;
