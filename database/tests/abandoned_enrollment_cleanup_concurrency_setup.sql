\set ON_ERROR_STOP on

-- Synthetic fixtures for abandoned-enrollment worker serialization and activation overlap. The
-- isolated integration database is destroyed by the runner and this setup must never target shared
-- state.

BEGIN;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (
  profile_id,
  github_user_id,
  handle,
  state,
  created_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000038701',
    900000000000038701,
    'abandoned-race-one',
    'enrolling',
    pg_catalog.statement_timestamp() - INTERVAL '3 hours'
  ),
  (
    '00000000-0000-4000-8000-000000038702',
    900000000000038702,
    'abandoned-race-two',
    'enrolling',
    pg_catalog.statement_timestamp() - INTERVAL '2 hours'
  ),
  (
    '00000000-0000-4000-8000-000000038703',
    900000000000038703,
    'enroll-activation-race',
    'enrolling',
    pg_catalog.statement_timestamp() - INTERVAL '1 hour'
  );

INSERT INTO viberacing_private.invites (
  invite_id,
  verifier_digest,
  state,
  created_at,
  expires_at,
  redeemed_at,
  redeemed_profile_id
)
SELECT
  (
    '00000000-0000-4000-8000-' ||
    pg_catalog.lpad((38800 + fixture.ordinal)::text, 12, '0')
  )::uuid,
  pg_catalog.decode(pg_catalog.lpad((38800 + fixture.ordinal)::text, 64, '0'), 'hex'),
  'redeemed',
  pg_catalog.statement_timestamp() - INTERVAL '4 hours',
  pg_catalog.statement_timestamp() - INTERVAL '3 hours',
  pg_catalog.statement_timestamp() - INTERVAL '2 hours',
  fixture.profile_id
FROM (
  VALUES
    (1, '00000000-0000-4000-8000-000000038701'::uuid),
    (2, '00000000-0000-4000-8000-000000038702'::uuid),
    (3, '00000000-0000-4000-8000-000000038703'::uuid)
) AS fixture(ordinal, profile_id);

INSERT INTO viberacing_private.sessions (
  session_id,
  profile_id,
  verifier_digest,
  created_at,
  expires_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000038901',
    '00000000-0000-4000-8000-000000038701',
    pg_catalog.decode(pg_catalog.lpad('38901', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp() - INTERVAL '2 hours',
    pg_catalog.statement_timestamp() - INTERVAL '1 hour'
  ),
  (
    '00000000-0000-4000-8000-000000038902',
    '00000000-0000-4000-8000-000000038702',
    pg_catalog.decode(pg_catalog.lpad('38902', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp() - INTERVAL '2 hours',
    pg_catalog.statement_timestamp() - INTERVAL '1 hour'
  ),
  (
    '00000000-0000-4000-8000-000000038903',
    '00000000-0000-4000-8000-000000038703',
    pg_catalog.decode(pg_catalog.lpad('38903', 64, '0'), 'hex'),
    pg_catalog.statement_timestamp() - INTERVAL '1 minute',
    pg_catalog.statement_timestamp() + INTERVAL '10 minutes'
  );

INSERT INTO viberacing_private.auth_challenges (
  challenge_id,
  profile_id,
  session_id,
  purpose,
  challenge_digest,
  context_digest,
  created_at,
  expires_at,
  consumed_at
)
VALUES (
  '00000000-0000-4000-8000-000000039003',
  '00000000-0000-4000-8000-000000038703',
  '00000000-0000-4000-8000-000000038903',
  'passkey_registration',
  pg_catalog.decode(pg_catalog.lpad('39003', 64, '0'), 'hex'),
  pg_catalog.decode(pg_catalog.lpad('39103', 64, '0'), 'hex'),
  pg_catalog.statement_timestamp() - INTERVAL '1 minute',
  pg_catalog.statement_timestamp() + INTERVAL '10 minutes',
  pg_catalog.statement_timestamp()
);

COMMIT;
