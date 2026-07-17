\set ON_ERROR_STOP on

-- Read-only assertions over committed synthetic CarRecipe-proposal cleanup race fixtures.

SET ROLE viberacing_owner;

DO $assertion$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM viberacing_private.car_recipe_proposals
    WHERE proposal_id IN (
      '00000000-0000-4000-8000-000000028301',
      '00000000-0000-4000-8000-000000028302'
    )
  ) THEN
    RAISE EXCEPTION 'concurrent CarRecipe proposal cleanup did not remove each expired row once';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.car_recipe_proposals
    WHERE proposal_id = '00000000-0000-4000-8000-000000028303'
      AND expires_at > pg_catalog.statement_timestamp()
  ) THEN
    RAISE EXCEPTION 'concurrent CarRecipe proposal cleanup removed live state';
  END IF;
END
$assertion$;

RESET ROLE;
