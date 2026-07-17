\set ON_ERROR_STOP on

-- Revision 0028: device-authenticated CarRecipe proposal ingress without activation authority.
-- Canonical checksum: database/migrations/manifest.json.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);

CREATE FUNCTION viberacing_api.read_car_proposal_device_material(
  p_device_id text
)
RETURNS TABLE (
  device_key_id uuid,
  public_key bytea
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '5s'
AS $function$
BEGIN
  IF p_device_id IS NULL OR p_device_id !~ '^dev_[A-Za-z0-9_-]{22}$' THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  RETURN QUERY
  SELECT
    device_record.device_key_id,
    device_record.public_key
  FROM viberacing_private.device_keys AS device_record
  JOIN viberacing_private.codex_sources AS source_record
    ON source_record.source_id = device_record.source_id
  JOIN viberacing_private.profiles AS profile_record
    ON profile_record.profile_id = source_record.profile_id
  WHERE device_record.device_id = p_device_id
    AND device_record.state = 'active'
    AND source_record.state = 'active'
    AND profile_record.state IN ('active', 'hidden');
END
$function$;

CREATE FUNCTION viberacing_api.propose_car_recipe_from_device(
  p_device_key_id uuid,
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
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '5s'
AS $function$
DECLARE
  candidate_profile_id uuid;
  candidate_source_id text;
  locked_profile_id uuid;
  locked_source_id text;
  locked_device_key_id uuid;
  now_at timestamptz(3);
BEGIN
  IF p_device_key_id IS NULL
    OR p_device_id IS NULL
    OR p_device_id !~ '^dev_[A-Za-z0-9_-]{22}$'
    OR p_observed_at IS NULL
    OR p_observed_at IS DISTINCT FROM pg_catalog.date_trunc('milliseconds', p_observed_at)
    OR pg_catalog.octet_length(p_nonce_digest) IS DISTINCT FROM 32
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
    OR p_seed IS NULL OR p_seed NOT BETWEEN 0 AND 65535 THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT
    source_record.profile_id,
    source_record.source_id
  INTO
    candidate_profile_id,
    candidate_source_id
  FROM viberacing_private.device_keys AS device_record
  JOIN viberacing_private.codex_sources AS source_record
    ON source_record.source_id = device_record.source_id
  WHERE device_record.device_key_id = p_device_key_id
    AND device_record.device_id = p_device_id;

  IF candidate_profile_id IS NULL OR candidate_source_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT profile_record.profile_id
  INTO locked_profile_id
  FROM viberacing_private.profiles AS profile_record
  WHERE profile_record.profile_id = candidate_profile_id
    AND profile_record.state IN ('active', 'hidden')
  FOR UPDATE;

  IF locked_profile_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT source_record.source_id
  INTO locked_source_id
  FROM viberacing_private.codex_sources AS source_record
  WHERE source_record.source_id = candidate_source_id
    AND source_record.profile_id = locked_profile_id
    AND source_record.state = 'active'
  FOR UPDATE;

  IF locked_source_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  SELECT device_record.device_key_id
  INTO locked_device_key_id
  FROM viberacing_private.device_keys AS device_record
  WHERE device_record.device_key_id = p_device_key_id
    AND device_record.device_id = p_device_id
    AND device_record.source_id = locked_source_id
    AND device_record.state = 'active'
  FOR UPDATE;

  IF locked_device_key_id IS NULL THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  now_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  IF p_observed_at <= now_at - INTERVAL '5 minutes'
    OR p_observed_at > now_at + INTERVAL '2 minutes' THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  INSERT INTO viberacing_private.device_nonces (
    device_key_id,
    nonce_digest,
    received_at,
    expires_at
  )
  VALUES (
    locked_device_key_id,
    p_nonce_digest,
    now_at,
    now_at + INTERVAL '7 minutes'
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
    created_at,
    expires_at
  )
  VALUES (
    p_proposal_id,
    locked_profile_id,
    p_schema_version,
    p_chassis,
    p_nose,
    p_cockpit,
    p_wing,
    p_wheels,
    p_palette,
    p_trail,
    p_seed,
    now_at,
    now_at + INTERVAL '24 hours'
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
  WHEN integrity_constraint_violation THEN
    PERFORM viberacing_private.operation_failed();
    RETURN false;
END
$function$;

REVOKE EXECUTE ON FUNCTION viberacing_api.read_car_proposal_device_material(text)
  FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
GRANT EXECUTE ON FUNCTION viberacing_api.read_car_proposal_device_material(text)
  TO viberacing_web;

REVOKE EXECUTE ON FUNCTION viberacing_api.propose_car_recipe_from_device(
  uuid, text, timestamptz, bytea, uuid, integer, text, text, text, text, text, text, text, integer
) FROM PUBLIC, viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;
GRANT EXECUTE ON FUNCTION viberacing_api.propose_car_recipe_from_device(
  uuid, text, timestamptz, bytea, uuid, integer, text, text, text, text, text, text, text, integer
) TO viberacing_web;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (28, 'connector_car_proposal_ingress');

COMMIT;
