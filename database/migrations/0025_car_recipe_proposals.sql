\set ON_ERROR_STOP on

-- Revision 0025: session-derived CarRecipe proposal and explicit approval capabilities.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

CREATE TABLE viberacing_private.profile_car_recipes (
  profile_id uuid PRIMARY KEY
    REFERENCES viberacing_private.profiles (profile_id) ON DELETE CASCADE,
  schema_version smallint NOT NULL,
  chassis varchar(8) NOT NULL,
  nose varchar(7) NOT NULL,
  cockpit varchar(6) NOT NULL,
  wing varchar(4) NOT NULL,
  wheels varchar(11) NOT NULL,
  palette varchar(10) NOT NULL,
  trail varchar(5) NOT NULL,
  seed integer NOT NULL,
  activated_at timestamptz(3) NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  CONSTRAINT profile_car_recipes_schema_version CHECK (schema_version = 1),
  CONSTRAINT profile_car_recipes_chassis CHECK (chassis IN ('formula', 'rally', 'roadster')),
  CONSTRAINT profile_car_recipes_nose CHECK (nose IN ('classic', 'scoop', 'wedge')),
  CONSTRAINT profile_car_recipes_cockpit CHECK (cockpit IN ('canopy', 'open', 'rally')),
  CONSTRAINT profile_car_recipes_wing CHECK (wing IN ('high', 'low', 'none')),
  CONSTRAINT profile_car_recipes_wheels CHECK (wheels IN ('all-terrain', 'slick', 'street')),
  CONSTRAINT profile_car_recipes_palette CHECK (
    palette IN ('magenta', 'mint', 'redline', 'sunburst', 'turbo-blue')
  ),
  CONSTRAINT profile_car_recipes_trail CHECK (trail IN ('grid', 'none', 'spark')),
  CONSTRAINT profile_car_recipes_seed CHECK (seed BETWEEN 0 AND 65535)
);

CREATE TABLE viberacing_private.car_recipe_proposals (
  proposal_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL UNIQUE
    REFERENCES viberacing_private.profiles (profile_id) ON DELETE CASCADE,
  schema_version smallint NOT NULL,
  chassis varchar(8) NOT NULL,
  nose varchar(7) NOT NULL,
  cockpit varchar(6) NOT NULL,
  wing varchar(4) NOT NULL,
  wheels varchar(11) NOT NULL,
  palette varchar(10) NOT NULL,
  trail varchar(5) NOT NULL,
  seed integer NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  expires_at timestamptz(3) NOT NULL,
  CONSTRAINT car_recipe_proposals_schema_version CHECK (schema_version = 1),
  CONSTRAINT car_recipe_proposals_chassis CHECK (chassis IN ('formula', 'rally', 'roadster')),
  CONSTRAINT car_recipe_proposals_nose CHECK (nose IN ('classic', 'scoop', 'wedge')),
  CONSTRAINT car_recipe_proposals_cockpit CHECK (cockpit IN ('canopy', 'open', 'rally')),
  CONSTRAINT car_recipe_proposals_wing CHECK (wing IN ('high', 'low', 'none')),
  CONSTRAINT car_recipe_proposals_wheels CHECK (wheels IN ('all-terrain', 'slick', 'street')),
  CONSTRAINT car_recipe_proposals_palette CHECK (
    palette IN ('magenta', 'mint', 'redline', 'sunburst', 'turbo-blue')
  ),
  CONSTRAINT car_recipe_proposals_trail CHECK (trail IN ('grid', 'none', 'spark')),
  CONSTRAINT car_recipe_proposals_seed CHECK (seed BETWEEN 0 AND 65535),
  CONSTRAINT car_recipe_proposals_expiry_order CHECK (expires_at > created_at),
  CONSTRAINT car_recipe_proposals_expiry_bound CHECK (
    expires_at <= created_at + INTERVAL '24 hours'
  )
);

CREATE INDEX car_recipe_proposals_expiry_idx
  ON viberacing_private.car_recipe_proposals (expires_at, proposal_id);

ALTER TABLE viberacing_private.profile_car_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.profile_car_recipes FORCE ROW LEVEL SECURITY;
CREATE POLICY profile_car_recipes_owner_all ON viberacing_private.profile_car_recipes
  FOR ALL TO viberacing_owner USING (true) WITH CHECK (true);

ALTER TABLE viberacing_private.car_recipe_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.car_recipe_proposals FORCE ROW LEVEL SECURITY;
CREATE POLICY car_recipe_proposals_owner_all ON viberacing_private.car_recipe_proposals
  FOR ALL TO viberacing_owner USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE
  viberacing_private.profile_car_recipes,
  viberacing_private.car_recipe_proposals
FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

CREATE FUNCTION viberacing_api.propose_car_recipe(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_proposal_id uuid,
  p_schema_version integer,
  p_chassis text,
  p_nose text,
  p_cockpit text,
  p_wing text,
  p_wheels text,
  p_palette text,
  p_trail text,
  p_seed integer,
  p_expires_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '5s'
AS $function$
DECLARE
  authenticated_profile_id uuid;
  now_at timestamptz(3) := pg_catalog.statement_timestamp();
BEGIN
  IF p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32
    OR p_proposal_id IS NULL
    OR p_schema_version IS DISTINCT FROM 1
    OR p_chassis IS NULL OR p_chassis NOT IN ('formula', 'rally', 'roadster')
    OR p_nose IS NULL OR p_nose NOT IN ('classic', 'scoop', 'wedge')
    OR p_cockpit IS NULL OR p_cockpit NOT IN ('canopy', 'open', 'rally')
    OR p_wing IS NULL OR p_wing NOT IN ('high', 'low', 'none')
    OR p_wheels IS NULL OR p_wheels NOT IN ('all-terrain', 'slick', 'street')
    OR p_palette IS NULL
    OR p_palette NOT IN ('magenta', 'mint', 'redline', 'sunburst', 'turbo-blue')
    OR p_trail IS NULL OR p_trail NOT IN ('grid', 'none', 'spark')
    OR p_seed IS NULL OR p_seed NOT BETWEEN 0 AND 65535
    OR p_expires_at IS NULL
    OR p_expires_at <= now_at
    OR p_expires_at > now_at + INTERVAL '24 hours' THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  authenticated_profile_id := viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest,
    ARRAY['active', 'hidden']
  );

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
    expires_at
  )
  VALUES (
    p_proposal_id,
    authenticated_profile_id,
    p_schema_version,
    p_chassis,
    p_nose,
    p_cockpit,
    p_wing,
    p_wheels,
    p_palette,
    p_trail,
    p_seed,
    p_expires_at
  )
  ON CONFLICT (profile_id) DO UPDATE
  SET
    proposal_id = EXCLUDED.proposal_id,
    schema_version = EXCLUDED.schema_version,
    chassis = EXCLUDED.chassis,
    nose = EXCLUDED.nose,
    cockpit = EXCLUDED.cockpit,
    wing = EXCLUDED.wing,
    wheels = EXCLUDED.wheels,
    palette = EXCLUDED.palette,
    trail = EXCLUDED.trail,
    seed = EXCLUDED.seed,
    created_at = now_at,
    expires_at = EXCLUDED.expires_at;

  RETURN true;
EXCEPTION
  WHEN unique_violation OR check_violation THEN
    PERFORM viberacing_private.operation_failed();
    RETURN false;
END
$function$;

CREATE FUNCTION viberacing_api.read_car_recipe_state(
  p_session_id uuid,
  p_session_verifier_digest bytea
)
RETURNS TABLE (
  active_schema_version integer,
  active_chassis text,
  active_nose text,
  active_cockpit text,
  active_wing text,
  active_wheels text,
  active_palette text,
  active_trail text,
  active_seed integer,
  proposal_id uuid,
  proposal_schema_version integer,
  proposal_chassis text,
  proposal_nose text,
  proposal_cockpit text,
  proposal_wing text,
  proposal_wheels text,
  proposal_palette text,
  proposal_trail text,
  proposal_seed integer,
  proposal_expires_at timestamptz(3)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '5s'
AS $function$
DECLARE
  authenticated_profile_id uuid;
  now_at timestamptz(3) := pg_catalog.statement_timestamp();
BEGIN
  IF p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  authenticated_profile_id := viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest,
    ARRAY['active', 'hidden']
  );

  RETURN QUERY
  SELECT
    active_recipe.schema_version::integer,
    active_recipe.chassis::text,
    active_recipe.nose::text,
    active_recipe.cockpit::text,
    active_recipe.wing::text,
    active_recipe.wheels::text,
    active_recipe.palette::text,
    active_recipe.trail::text,
    active_recipe.seed,
    pending_recipe.proposal_id,
    pending_recipe.schema_version::integer,
    pending_recipe.chassis::text,
    pending_recipe.nose::text,
    pending_recipe.cockpit::text,
    pending_recipe.wing::text,
    pending_recipe.wheels::text,
    pending_recipe.palette::text,
    pending_recipe.trail::text,
    pending_recipe.seed,
    pending_recipe.expires_at
  FROM (SELECT authenticated_profile_id AS profile_id) AS possessed_profile
  LEFT JOIN viberacing_private.profile_car_recipes AS active_recipe
    ON active_recipe.profile_id = possessed_profile.profile_id
  LEFT JOIN viberacing_private.car_recipe_proposals AS pending_recipe
    ON pending_recipe.profile_id = possessed_profile.profile_id
    AND pending_recipe.expires_at > now_at;
END
$function$;

CREATE FUNCTION viberacing_api.approve_car_recipe(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_proposal_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '5s'
AS $function$
DECLARE
  authenticated_profile_id uuid;
  pending_recipe record;
  changed_rows bigint;
  now_at timestamptz(3) := pg_catalog.statement_timestamp();
BEGIN
  IF p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32
    OR p_proposal_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  authenticated_profile_id := viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest,
    ARRAY['active', 'hidden']
  );

  SELECT proposal_record.*
  INTO pending_recipe
  FROM viberacing_private.car_recipe_proposals AS proposal_record
  WHERE proposal_record.proposal_id = p_proposal_id
    AND proposal_record.profile_id = authenticated_profile_id
    AND proposal_record.expires_at > now_at
  FOR UPDATE;

  IF pending_recipe.proposal_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  INSERT INTO viberacing_private.profile_car_recipes (
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
    activated_at
  )
  VALUES (
    authenticated_profile_id,
    pending_recipe.schema_version,
    pending_recipe.chassis,
    pending_recipe.nose,
    pending_recipe.cockpit,
    pending_recipe.wing,
    pending_recipe.wheels,
    pending_recipe.palette,
    pending_recipe.trail,
    pending_recipe.seed,
    now_at
  )
  ON CONFLICT (profile_id) DO UPDATE
  SET
    schema_version = EXCLUDED.schema_version,
    chassis = EXCLUDED.chassis,
    nose = EXCLUDED.nose,
    cockpit = EXCLUDED.cockpit,
    wing = EXCLUDED.wing,
    wheels = EXCLUDED.wheels,
    palette = EXCLUDED.palette,
    trail = EXCLUDED.trail,
    seed = EXCLUDED.seed,
    activated_at = now_at;

  DELETE FROM viberacing_private.car_recipe_proposals AS proposal_record
  WHERE proposal_record.proposal_id = p_proposal_id
    AND proposal_record.profile_id = authenticated_profile_id;

  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  RETURN true;
END
$function$;

CREATE FUNCTION viberacing_api.reject_car_recipe(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_proposal_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '5s'
AS $function$
DECLARE
  authenticated_profile_id uuid;
  changed_rows bigint;
  now_at timestamptz(3) := pg_catalog.statement_timestamp();
BEGIN
  IF p_session_id IS NULL
    OR pg_catalog.octet_length(p_session_verifier_digest) IS DISTINCT FROM 32
    OR p_proposal_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  authenticated_profile_id := viberacing_private.authenticate_session(
    p_session_id,
    p_session_verifier_digest,
    ARRAY['active', 'hidden']
  );

  DELETE FROM viberacing_private.car_recipe_proposals AS proposal_record
  WHERE proposal_record.proposal_id = p_proposal_id
    AND proposal_record.profile_id = authenticated_profile_id
    AND proposal_record.expires_at > now_at;

  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  RETURN true;
END
$function$;

REVOKE EXECUTE ON FUNCTION viberacing_api.propose_car_recipe(
  uuid, bytea, uuid, integer, text, text, text, text, text, text, text, integer, timestamptz
) FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
GRANT EXECUTE ON FUNCTION viberacing_api.propose_car_recipe(
  uuid, bytea, uuid, integer, text, text, text, text, text, text, text, integer, timestamptz
) TO viberacing_web;

REVOKE EXECUTE ON FUNCTION viberacing_api.read_car_recipe_state(uuid, bytea)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
GRANT EXECUTE ON FUNCTION viberacing_api.read_car_recipe_state(uuid, bytea)
  TO viberacing_web;

REVOKE EXECUTE ON FUNCTION viberacing_api.approve_car_recipe(uuid, bytea, uuid)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
GRANT EXECUTE ON FUNCTION viberacing_api.approve_car_recipe(uuid, bytea, uuid)
  TO viberacing_web;

REVOKE EXECUTE ON FUNCTION viberacing_api.reject_car_recipe(uuid, bytea, uuid)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
GRANT EXECUTE ON FUNCTION viberacing_api.reject_car_recipe(uuid, bytea, uuid)
  TO viberacing_web;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (25, 'car_recipe_proposals');

COMMIT;
