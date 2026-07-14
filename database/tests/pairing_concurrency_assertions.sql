\set ON_ERROR_STOP on

-- Read-only assertions over the committed synthetic race fixtures. The enclosing integration
-- project is ephemeral and is destroyed immediately after the complete test run.

SET ROLE viberacing_owner;

DO $assertion$
DECLARE
  approved_profile uuid;
  approved_source text;
BEGIN
  SELECT approved_profile_id, approved_source_id
  INTO approved_profile, approved_source
  FROM viberacing_private.pairing_transactions
  WHERE pairing_id = '00000000-0000-4000-8000-000000008501'
    AND state = 'approved';

  IF NOT (
    (
      approved_profile = '00000000-0000-4000-8000-000000008101'
      AND approved_source = 'src_' || pg_catalog.repeat('A', 22)
    )
    OR (
      approved_profile = '00000000-0000-4000-8000-000000008102'
      AND approved_source = 'src_' || pg_catalog.repeat('B', 22)
    )
  ) THEN
    RAISE EXCEPTION 'pairing race did not preserve the winning profile/source binding';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.codex_sources
    WHERE source_id IN (
      'src_' || pg_catalog.repeat('A', 22),
      'src_' || pg_catalog.repeat('B', 22)
    )
  ) <> 1 OR (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.auth_challenges
    WHERE challenge_id IN (
      '00000000-0000-4000-8000-000000008701',
      '00000000-0000-4000-8000-000000008702'
    )
      AND authorized_action_used_at IS NOT NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'pairing race created more than one source or action claim';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.codex_sources
    WHERE profile_id = '00000000-0000-4000-8000-000000008103'
  ) <> 32 OR (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id IN (
      '00000000-0000-4000-8000-000000008502',
      '00000000-0000-4000-8000-000000008503'
    )
      AND state = 'approved'
  ) <> 1 OR (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id IN (
      '00000000-0000-4000-8000-000000008502',
      '00000000-0000-4000-8000-000000008503'
    )
      AND state = 'pending'
  ) <> 1 THEN
    RAISE EXCEPTION 'concurrent source creation bypassed or failed to reach the lifetime ceiling';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.device_keys AS key_record
    JOIN viberacing_private.codex_sources AS source_record
      ON source_record.source_id = key_record.source_id
    WHERE source_record.profile_id = '00000000-0000-4000-8000-000000008104'
      AND key_record.state = 'active'
  ) <> 63 OR (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.pairing_transactions
    WHERE approved_profile_id = '00000000-0000-4000-8000-000000008104'
      AND state = 'approved'
      AND expires_at >= pg_catalog.statement_timestamp()
  ) <> 1 OR (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.pairing_transactions
    WHERE approved_profile_id = '00000000-0000-4000-8000-000000008104'
      AND state = 'approved'
      AND expires_at < pg_catalog.statement_timestamp()
  ) <> 1 THEN
    RAISE EXCEPTION 'device authority race mishandled the live ceiling or expired approval';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.pairing_transactions
    WHERE pairing_id IN (
      '00000000-0000-4000-8000-000000008504',
      '00000000-0000-4000-8000-000000008505'
    )
      AND state = 'pending'
  ) <> 1 OR (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.auth_challenges
    WHERE challenge_id IN (
      '00000000-0000-4000-8000-000000008705',
      '00000000-0000-4000-8000-000000008706'
    )
      AND authorized_action_used_at IS NOT NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'device authority race consumed both competing actions';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM viberacing_private.audit_events
    WHERE event_type = 'pairing.approved'
  ) <> 3 THEN
    RAISE EXCEPTION 'concurrency scenarios did not emit exactly one audit per winning approval';
  END IF;
END
$assertion$;

RESET ROLE;
