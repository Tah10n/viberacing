\set ON_ERROR_STOP on

-- Read-only assertions over committed synthetic authentication-cleanup race fixtures.

SET ROLE viberacing_owner;

DO $assertion$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM viberacing_private.auth_challenges
    WHERE challenge_id IN (
      '00000000-0000-4000-8000-000000024201',
      '00000000-0000-4000-8000-000000024202'
    )
  )
    OR EXISTS (
      SELECT 1
      FROM viberacing_private.recovery_authorities
      WHERE recovery_authority_id IN (
        '00000000-0000-4000-8000-000000024401',
        '00000000-0000-4000-8000-000000024402'
      )
    )
    OR EXISTS (
      SELECT 1
      FROM viberacing_private.recovery_codes
      WHERE recovery_code_id IN (
        '00000000-0000-4000-8000-000000024301',
        '00000000-0000-4000-8000-000000024302'
      )
    ) THEN
    RAISE EXCEPTION 'concurrent authentication cleanup did not remove each expired batch once';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.auth_challenges
    WHERE challenge_id = '00000000-0000-4000-8000-000000024203'
      AND expires_at > pg_catalog.statement_timestamp()
  )
    OR NOT EXISTS (
      SELECT 1
      FROM viberacing_private.recovery_authorities
      WHERE recovery_authority_id = '00000000-0000-4000-8000-000000024403'
        AND state = 'active'
        AND expires_at > pg_catalog.statement_timestamp()
    )
    OR NOT EXISTS (
      SELECT 1
      FROM viberacing_private.recovery_codes
      WHERE recovery_code_id = '00000000-0000-4000-8000-000000024303'
        AND used_at IS NOT NULL
        AND verifier_phc IS NULL
    ) THEN
    RAISE EXCEPTION 'concurrent authentication cleanup removed live authority';
  END IF;
END
$assertion$;

RESET ROLE;
