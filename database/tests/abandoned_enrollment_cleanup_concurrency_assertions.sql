\set ON_ERROR_STOP on

-- Read-only assertions over committed synthetic abandoned-enrollment race fixtures.

SET ROLE viberacing_owner;

DO $assertions$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM viberacing_private.profiles
    WHERE profile_id IN (
      '00000000-0000-4000-8000-000000038701',
      '00000000-0000-4000-8000-000000038702'
    )
  ) THEN
    RAISE EXCEPTION 'abandoned-enrollment workers left an eligible profile behind';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM viberacing_private.invites
    WHERE redeemed_profile_id IN (
      '00000000-0000-4000-8000-000000038701',
      '00000000-0000-4000-8000-000000038702'
    )
  ) THEN
    RAISE EXCEPTION 'abandoned-enrollment workers left redeemed invite state behind';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.profiles
    WHERE profile_id = '00000000-0000-4000-8000-000000038703'
      AND state = 'active'
  ) THEN
    RAISE EXCEPTION 'the in-flight initial passkey activation did not remain authoritative';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.passkeys
    WHERE passkey_id = '00000000-0000-4000-8000-000000039103'
      AND profile_id = '00000000-0000-4000-8000-000000038703'
      AND state = 'active'
  ) THEN
    RAISE EXCEPTION 'the activation race lost its exact initial passkey';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.invites
    WHERE invite_id = '00000000-0000-4000-8000-000000038803'
      AND redeemed_profile_id = '00000000-0000-4000-8000-000000038703'
      AND state = 'redeemed'
  ) THEN
    RAISE EXCEPTION 'the activation race removed redeemed enrollment provenance';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.auth_challenges
    WHERE challenge_id = '00000000-0000-4000-8000-000000039003'
      AND authorized_action_used_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'the activation race did not atomically consume its authorized action';
  END IF;
END
$assertions$;

RESET ROLE;
