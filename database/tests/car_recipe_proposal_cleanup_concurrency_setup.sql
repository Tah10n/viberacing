\set ON_ERROR_STOP on

-- Synthetic fixtures for the CarRecipe-proposal cleanup worker race. The isolated integration
-- database is portless, tmpfs-backed, and destroyed by the runner.

BEGIN;
SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (profile_id, github_user_id, handle, state)
VALUES
  ('00000000-0000-4000-8000-000000028101', 900000000000028101, 'car-cleanup-race-one', 'active'),
  ('00000000-0000-4000-8000-000000028102', 900000000000028102, 'car-cleanup-race-two', 'active'),
  ('00000000-0000-4000-8000-000000028103', 900000000000028103, 'car-cleanup-race-live', 'active');

INSERT INTO viberacing_private.car_recipe_proposals (
  proposal_id,
  profile_id,
  schema_version,
  chassis,
  nose,
  cockpit,
  wing,
  wheels,
  palette,
  trail,
  seed,
  created_at,
  expires_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000028301',
    '00000000-0000-4000-8000-000000028101',
    1,
    'formula',
    'classic',
    'canopy',
    'high',
    'slick',
    'magenta',
    'grid',
    401,
    pg_catalog.statement_timestamp() - INTERVAL '4 hours',
    pg_catalog.statement_timestamp() - INTERVAL '3 hours'
  ),
  (
    '00000000-0000-4000-8000-000000028302',
    '00000000-0000-4000-8000-000000028102',
    1,
    'rally',
    'scoop',
    'rally',
    'low',
    'all-terrain',
    'sunburst',
    'spark',
    402,
    pg_catalog.statement_timestamp() - INTERVAL '3 hours',
    pg_catalog.statement_timestamp() - INTERVAL '2 hours'
  ),
  (
    '00000000-0000-4000-8000-000000028303',
    '00000000-0000-4000-8000-000000028103',
    1,
    'roadster',
    'wedge',
    'open',
    'none',
    'street',
    'mint',
    'none',
    403,
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour'
  );

COMMIT;
