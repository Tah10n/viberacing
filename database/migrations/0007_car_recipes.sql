\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824762001);

CREATE TABLE viberacing_private.profile_car_recipes (
  profile_id uuid PRIMARY KEY
    REFERENCES viberacing_private.profiles(profile_id) ON DELETE CASCADE,
  schema_version smallint NOT NULL,
  chassis varchar(8) NOT NULL,
  nose varchar(7) NOT NULL,
  cockpit varchar(6) NOT NULL,
  wing varchar(4) NOT NULL,
  wheels varchar(11) NOT NULL,
  palette varchar(10) NOT NULL,
  trail varchar(5) NOT NULL,
  seed integer NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  CONSTRAINT profile_car_recipes_schema_version_exact CHECK (schema_version = 1),
  CONSTRAINT profile_car_recipes_chassis_closed
    CHECK (chassis IN ('formula', 'rally', 'roadster')),
  CONSTRAINT profile_car_recipes_nose_closed
    CHECK (nose IN ('classic', 'scoop', 'wedge')),
  CONSTRAINT profile_car_recipes_cockpit_closed
    CHECK (cockpit IN ('canopy', 'open', 'rally')),
  CONSTRAINT profile_car_recipes_wing_closed
    CHECK (wing IN ('high', 'low', 'none')),
  CONSTRAINT profile_car_recipes_wheels_closed
    CHECK (wheels IN ('all-terrain', 'slick', 'street')),
  CONSTRAINT profile_car_recipes_palette_closed
    CHECK (palette IN ('magenta', 'mint', 'redline', 'sunburst', 'turbo-blue')),
  CONSTRAINT profile_car_recipes_trail_closed
    CHECK (trail IN ('grid', 'none', 'spark')),
  CONSTRAINT profile_car_recipes_seed_bounded CHECK (seed BETWEEN 0 AND 65535)
);

CREATE TABLE viberacing_private.car_recipe_proposals (
  proposal_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL UNIQUE
    REFERENCES viberacing_private.profiles(profile_id) ON DELETE CASCADE,
  schema_version smallint NOT NULL,
  chassis varchar(8) NOT NULL,
  nose varchar(7) NOT NULL,
  cockpit varchar(6) NOT NULL,
  wing varchar(4) NOT NULL,
  wheels varchar(11) NOT NULL,
  palette varchar(10) NOT NULL,
  trail varchar(5) NOT NULL,
  seed integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT car_recipe_proposals_schema_version_exact CHECK (schema_version = 1),
  CONSTRAINT car_recipe_proposals_chassis_closed
    CHECK (chassis IN ('formula', 'rally', 'roadster')),
  CONSTRAINT car_recipe_proposals_nose_closed
    CHECK (nose IN ('classic', 'scoop', 'wedge')),
  CONSTRAINT car_recipe_proposals_cockpit_closed
    CHECK (cockpit IN ('canopy', 'open', 'rally')),
  CONSTRAINT car_recipe_proposals_wing_closed
    CHECK (wing IN ('high', 'low', 'none')),
  CONSTRAINT car_recipe_proposals_wheels_closed
    CHECK (wheels IN ('all-terrain', 'slick', 'street')),
  CONSTRAINT car_recipe_proposals_palette_closed
    CHECK (palette IN ('magenta', 'mint', 'redline', 'sunburst', 'turbo-blue')),
  CONSTRAINT car_recipe_proposals_trail_closed
    CHECK (trail IN ('grid', 'none', 'spark')),
  CONSTRAINT car_recipe_proposals_seed_bounded CHECK (seed BETWEEN 0 AND 65535),
  CONSTRAINT car_recipe_proposals_expiry_bounded CHECK (
    expires_at > created_at
    AND expires_at <= created_at + interval '24 hours'
  )
);

CREATE INDEX car_recipe_proposals_expiry_idx
  ON viberacing_private.car_recipe_proposals (expires_at, proposal_id);

CREATE FUNCTION viberacing_private.require_active_profile(p_profile_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  PERFORM 1
  FROM viberacing_private.profiles
  WHERE profile_id = p_profile_id
    AND state = 'active';
  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
  RETURN p_profile_id;
END
$function$;

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
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_profile_id uuid;
BEGIN
  v_profile_id := viberacing_private.require_active_profile(
    viberacing_private.authenticate_session(p_session_id, p_session_verifier_digest)
  );
  IF p_proposal_id IS NULL
    OR p_schema_version <> 1
    OR p_chassis NOT IN ('formula', 'rally', 'roadster')
    OR p_nose NOT IN ('classic', 'scoop', 'wedge')
    OR p_cockpit NOT IN ('canopy', 'open', 'rally')
    OR p_wing NOT IN ('high', 'low', 'none')
    OR p_wheels NOT IN ('all-terrain', 'slick', 'street')
    OR p_palette NOT IN ('magenta', 'mint', 'redline', 'sunburst', 'turbo-blue')
    OR p_trail NOT IN ('grid', 'none', 'spark')
    OR p_seed NOT BETWEEN 0 AND 65535
    OR p_expires_at <= v_now
    OR p_expires_at > v_now + interval '24 hours'
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

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
    v_profile_id,
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
  SET proposal_id = EXCLUDED.proposal_id,
      schema_version = EXCLUDED.schema_version,
      chassis = EXCLUDED.chassis,
      nose = EXCLUDED.nose,
      cockpit = EXCLUDED.cockpit,
      wing = EXCLUDED.wing,
      wheels = EXCLUDED.wheels,
      palette = EXCLUDED.palette,
      trail = EXCLUDED.trail,
      seed = EXCLUDED.seed,
      created_at = v_now,
      expires_at = EXCLUDED.expires_at;
  RETURN true;
EXCEPTION
  WHEN unique_violation OR check_violation OR foreign_key_violation THEN
    PERFORM viberacing_private.operation_failed();
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
  proposal_expires_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_profile_id uuid;
BEGIN
  v_profile_id := viberacing_private.require_active_profile(
    viberacing_private.authenticate_session(p_session_id, p_session_verifier_digest)
  );
  RETURN QUERY
  SELECT
    active.schema_version::integer,
    active.chassis::text,
    active.nose::text,
    active.cockpit::text,
    active.wing::text,
    active.wheels::text,
    active.palette::text,
    active.trail::text,
    active.seed,
    proposal.proposal_id,
    proposal.schema_version::integer,
    proposal.chassis::text,
    proposal.nose::text,
    proposal.cockpit::text,
    proposal.wing::text,
    proposal.wheels::text,
    proposal.palette::text,
    proposal.trail::text,
    proposal.seed,
    proposal.expires_at
  FROM (SELECT v_profile_id AS profile_id) AS possessed
  LEFT JOIN viberacing_private.profile_car_recipes AS active
    ON active.profile_id = possessed.profile_id
  LEFT JOIN viberacing_private.car_recipe_proposals AS proposal
    ON proposal.profile_id = possessed.profile_id
    AND proposal.expires_at > pg_catalog.transaction_timestamp();
END
$function$;

CREATE FUNCTION viberacing_api.approve_car_recipe(
  p_session_id uuid,
  p_session_verifier_digest bytea,
  p_proposal_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_profile_id uuid;
  v_proposal viberacing_private.car_recipe_proposals%ROWTYPE;
BEGIN
  v_profile_id := viberacing_private.require_active_profile(
    viberacing_private.authenticate_session(p_session_id, p_session_verifier_digest)
  );
  SELECT proposal.*
  INTO v_proposal
  FROM viberacing_private.car_recipe_proposals AS proposal
  WHERE proposal.proposal_id = p_proposal_id
    AND proposal.profile_id = v_profile_id
    AND proposal.expires_at > v_now
  FOR UPDATE;
  IF v_proposal.proposal_id IS NULL THEN
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
    v_profile_id,
    v_proposal.schema_version,
    v_proposal.chassis,
    v_proposal.nose,
    v_proposal.cockpit,
    v_proposal.wing,
    v_proposal.wheels,
    v_proposal.palette,
    v_proposal.trail,
    v_proposal.seed,
    v_now
  )
  ON CONFLICT (profile_id) DO UPDATE
  SET schema_version = EXCLUDED.schema_version,
      chassis = EXCLUDED.chassis,
      nose = EXCLUDED.nose,
      cockpit = EXCLUDED.cockpit,
      wing = EXCLUDED.wing,
      wheels = EXCLUDED.wheels,
      palette = EXCLUDED.palette,
      trail = EXCLUDED.trail,
      seed = EXCLUDED.seed,
      activated_at = EXCLUDED.activated_at;

  DELETE FROM viberacing_private.car_recipe_proposals
  WHERE proposal_id = p_proposal_id
    AND profile_id = v_profile_id;
  IF NOT FOUND THEN
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
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_profile_id uuid;
BEGIN
  v_profile_id := viberacing_private.require_active_profile(
    viberacing_private.authenticate_session(p_session_id, p_session_verifier_digest)
  );
  DELETE FROM viberacing_private.car_recipe_proposals
  WHERE proposal_id = p_proposal_id
    AND profile_id = v_profile_id
    AND expires_at > pg_catalog.transaction_timestamp();
  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
  RETURN true;
END
$function$;

CREATE FUNCTION viberacing_api.read_car_proposal_device_material(p_device_id text)
RETURNS TABLE (
  device_key_id text,
  public_key bytea
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF p_device_id IS NULL OR p_device_id !~ '^dev_[A-Za-z0-9_-]{22}$' THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
  RETURN QUERY
  SELECT device.device_key_id, device.public_key
  FROM viberacing_private.device_keys AS device
  JOIN viberacing_private.agent_accounts AS account
    ON account.profile_id = device.profile_id
    AND account.agent_account_id = device.agent_account_id
  JOIN viberacing_private.connector_installations AS installation
    ON installation.profile_id = device.profile_id
    AND installation.installation_id = device.installation_id
  JOIN viberacing_private.profiles AS profile
    ON profile.profile_id = device.profile_id
  WHERE device.device_id = p_device_id
    AND device.state = 'active'
    AND account.state = 'active'
    AND installation.state = 'active'
    AND profile.state = 'active'
  LIMIT 1;
END
$function$;

CREATE FUNCTION viberacing_api.propose_car_recipe_from_device(
  p_device_key_id text,
  p_device_id text,
  p_observed_at timestamptz,
  p_nonce_digest bytea,
  p_proposal_id uuid,
  p_schema_version integer,
  p_chassis text,
  p_nose text,
  p_cockpit text,
  p_wing text,
  p_wheels text,
  p_palette text,
  p_trail text,
  p_seed integer
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.date_trunc(
    'milliseconds',
    pg_catalog.clock_timestamp()
  );
  v_profile_id uuid;
BEGIN
  IF p_device_key_id IS NULL
    OR p_device_key_id !~ '^key_[A-Za-z0-9_-]{22}$'
    OR p_device_id IS NULL
    OR p_device_id !~ '^dev_[A-Za-z0-9_-]{22}$'
    OR p_observed_at IS NULL
    OR p_observed_at <> pg_catalog.date_trunc('milliseconds', p_observed_at)
    OR p_observed_at <= v_now - interval '5 minutes'
    OR p_observed_at > v_now + interval '2 minutes'
    OR pg_catalog.octet_length(p_nonce_digest) <> 32
    OR p_proposal_id IS NULL
    OR p_schema_version <> 1
    OR p_chassis NOT IN ('formula', 'rally', 'roadster')
    OR p_nose NOT IN ('classic', 'scoop', 'wedge')
    OR p_cockpit NOT IN ('canopy', 'open', 'rally')
    OR p_wing NOT IN ('high', 'low', 'none')
    OR p_wheels NOT IN ('all-terrain', 'slick', 'street')
    OR p_palette NOT IN ('magenta', 'mint', 'redline', 'sunburst', 'turbo-blue')
    OR p_trail NOT IN ('grid', 'none', 'spark')
    OR p_seed NOT BETWEEN 0 AND 65535
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT device.profile_id
  INTO v_profile_id
  FROM viberacing_private.device_keys AS device
  JOIN viberacing_private.agent_accounts AS account
    ON account.profile_id = device.profile_id
    AND account.agent_account_id = device.agent_account_id
  JOIN viberacing_private.connector_installations AS installation
    ON installation.profile_id = device.profile_id
    AND installation.installation_id = device.installation_id
  JOIN viberacing_private.profiles AS profile
    ON profile.profile_id = device.profile_id
  WHERE device.device_key_id = p_device_key_id
    AND device.device_id = p_device_id
    AND device.state = 'active'
    AND account.state = 'active'
    AND installation.state = 'active'
    AND profile.state = 'active'
  FOR UPDATE OF device, account, installation, profile;
  IF v_profile_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  INSERT INTO viberacing_private.device_nonces (
    device_key_id,
    nonce_digest,
    expires_at
  )
  VALUES (
    p_device_key_id,
    p_nonce_digest,
    v_now + interval '7 minutes'
  );

  UPDATE viberacing_private.device_keys
  SET last_used_at = v_now
  WHERE device_key_id = p_device_key_id
    AND device_id = p_device_id
    AND state = 'active';
  IF NOT FOUND THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

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
  VALUES (
    p_proposal_id,
    v_profile_id,
    p_schema_version,
    p_chassis,
    p_nose,
    p_cockpit,
    p_wing,
    p_wheels,
    p_palette,
    p_trail,
    p_seed,
    v_now,
    v_now + interval '24 hours'
  )
  ON CONFLICT (profile_id) DO UPDATE
  SET proposal_id = EXCLUDED.proposal_id,
      schema_version = EXCLUDED.schema_version,
      chassis = EXCLUDED.chassis,
      nose = EXCLUDED.nose,
      cockpit = EXCLUDED.cockpit,
      wing = EXCLUDED.wing,
      wheels = EXCLUDED.wheels,
      palette = EXCLUDED.palette,
      trail = EXCLUDED.trail,
      seed = EXCLUDED.seed,
      created_at = EXCLUDED.created_at,
      expires_at = EXCLUDED.expires_at;
  RETURN true;
EXCEPTION
  WHEN unique_violation OR check_violation OR foreign_key_violation THEN
    PERFORM viberacing_private.operation_failed();
END
$function$;

ALTER TABLE viberacing_private.profile_car_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.profile_car_recipes FORCE ROW LEVEL SECURITY;
CREATE POLICY profile_car_recipes_owner_only
  ON viberacing_private.profile_car_recipes
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

ALTER TABLE viberacing_private.car_recipe_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.car_recipe_proposals FORCE ROW LEVEL SECURITY;
CREATE POLICY car_recipe_proposals_owner_only
  ON viberacing_private.car_recipe_proposals
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

REVOKE ALL ON TABLE
  viberacing_private.profile_car_recipes,
  viberacing_private.car_recipe_proposals
FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA viberacing_private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA viberacing_api FROM PUBLIC;

GRANT EXECUTE ON FUNCTION viberacing_api.propose_car_recipe(
  uuid, bytea, uuid, integer, text, text, text, text, text, text, text, integer, timestamptz
) TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.read_car_recipe_state(uuid, bytea)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.approve_car_recipe(uuid, bytea, uuid)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.reject_car_recipe(uuid, bytea, uuid)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.read_car_proposal_device_material(text)
  TO viberacing_web;
GRANT EXECUTE ON FUNCTION viberacing_api.propose_car_recipe_from_device(
  text, text, timestamptz, bytea, uuid, integer, text, text, text, text, text, text, text, integer
) TO viberacing_web;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (7, 'car_recipes');

COMMIT;
