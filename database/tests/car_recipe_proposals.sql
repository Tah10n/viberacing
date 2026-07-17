\set ON_ERROR_STOP on

-- cspell:ignore relname

-- Every value below is a deterministic synthetic fixture. The transaction is always rolled back.

BEGIN;

CREATE FUNCTION pg_temp.assert_true(condition boolean, label text)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  IF condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'assertion failed: %', label;
  END IF;
END
$function$;

CREATE FUNCTION pg_temp.expect_operation_failure(statement text, label text)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      RETURN;
  END;

  RAISE EXCEPTION 'expected closed operation failure: %', label;
END
$function$;

SET LOCAL ROLE viberacing_owner;

INSERT INTO viberacing_private.profiles (profile_id, github_user_id, handle, state)
VALUES
  (
    '00000000-0000-4000-8000-000000026101',
    900000000000026101,
    'recipe-alpha',
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000026102',
    900000000000026102,
    'recipe-beta',
    'active'
  );

INSERT INTO viberacing_private.sessions (
  session_id,
  profile_id,
  verifier_digest,
  expires_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000026201',
    '00000000-0000-4000-8000-000000026101',
    pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour'
  ),
  (
    '00000000-0000-4000-8000-000000026202',
    '00000000-0000-4000-8000-000000026102',
    pg_catalog.decode(pg_catalog.repeat('a2', 32), 'hex'),
    pg_catalog.statement_timestamp() + INTERVAL '1 hour'
  );

INSERT INTO viberacing_private.codex_sources (source_id, profile_id, state)
VALUES
  (
    'src_' || pg_catalog.repeat('A', 22),
    '00000000-0000-4000-8000-000000026101',
    'active'
  ),
  (
    'src_' || pg_catalog.repeat('B', 22),
    '00000000-0000-4000-8000-000000026102',
    'active'
  );

INSERT INTO viberacing_private.device_keys (
  device_key_id,
  device_id,
  source_id,
  public_key,
  label,
  connector_version,
  os_family,
  architecture,
  state,
  activated_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000026401',
    'dev_' || pg_catalog.repeat('A', 22),
    'src_' || pg_catalog.repeat('A', 22),
    pg_catalog.decode(pg_catalog.repeat('b1', 32), 'hex'),
    'Synthetic recipe device A',
    '0.1.0',
    'windows',
    'x86_64',
    'active',
    pg_catalog.statement_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000026402',
    'dev_' || pg_catalog.repeat('B', 22),
    'src_' || pg_catalog.repeat('B', 22),
    pg_catalog.decode(pg_catalog.repeat('b2', 32), 'hex'),
    'Synthetic recipe device B',
    '0.1.0',
    'linux',
    'aarch64',
    'active',
    pg_catalog.statement_timestamp()
  );

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.bool_and(
      table_record.relrowsecurity
      AND table_record.relforcerowsecurity
      AND owner_role.rolname = 'viberacing_owner'
    )
    FROM pg_catalog.pg_class AS table_record
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = table_record.relnamespace
    JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = table_record.relowner
    WHERE namespace.nspname = 'viberacing_private'
      AND table_record.relname IN ('car_recipe_proposals', 'profile_car_recipes')
  ),
  'both CarRecipe tables are owner-defined with forced row-level security'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS runtime_role
    CROSS JOIN (
      VALUES ('car_recipe_proposals'), ('profile_car_recipes')
    ) AS private_table(table_name)
    WHERE runtime_role.rolname IN (
      'viberacing_web',
      'viberacing_ingest',
      'viberacing_jobs',
      'viberacing_admin'
    )
      AND pg_catalog.has_table_privilege(
        runtime_role.rolname,
        'viberacing_private.' || private_table.table_name,
        'SELECT,INSERT,UPDATE,DELETE'
      )
  ),
  'runtime roles have no direct CarRecipe table capability'
);

SELECT pg_temp.assert_true(
  pg_catalog.has_function_privilege(
    'viberacing_web',
    'viberacing_api.propose_car_recipe(uuid,bytea,uuid,integer,text,text,text,text,text,text,text,integer,timestamptz)',
    'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'viberacing_web',
    'viberacing_api.read_car_recipe_state(uuid,bytea)',
    'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'viberacing_web',
    'viberacing_api.approve_car_recipe(uuid,bytea,uuid)',
    'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'viberacing_web',
    'viberacing_api.reject_car_recipe(uuid,bytea,uuid)',
    'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'viberacing_web',
    'viberacing_api.read_car_proposal_device_material(text)',
    'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'viberacing_web',
    'viberacing_api.propose_car_recipe_from_device(uuid,text,timestamptz,bytea,uuid,integer,text,text,text,text,text,text,text,integer)',
    'EXECUTE'
  ),
  'Web alone receives the six closed browser and device proposal capabilities'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS runtime_role
    CROSS JOIN (
      VALUES
        ('viberacing_api.propose_car_recipe(uuid,bytea,uuid,integer,text,text,text,text,text,text,text,integer,timestamptz)'),
        ('viberacing_api.read_car_recipe_state(uuid,bytea)'),
        ('viberacing_api.approve_car_recipe(uuid,bytea,uuid)'),
        ('viberacing_api.reject_car_recipe(uuid,bytea,uuid)'),
        ('viberacing_api.read_car_proposal_device_material(text)'),
        ('viberacing_api.propose_car_recipe_from_device(uuid,text,timestamptz,bytea,uuid,integer,text,text,text,text,text,text,text,integer)')
    ) AS capability(signature)
    WHERE runtime_role.rolname IN ('viberacing_ingest', 'viberacing_jobs', 'viberacing_admin')
      AND pg_catalog.has_function_privilege(runtime_role.rolname, capability.signature, 'EXECUTE')
  ),
  'Ingest, Jobs, and Admin cannot read device proposal material, propose, or activate a car'
);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT pg_temp.assert_true(
  (
    SELECT device_key_id = '00000000-0000-4000-8000-000000026401'
      AND public_key = pg_catalog.decode(pg_catalog.repeat('b1', 32), 'hex')
    FROM viberacing_api.read_car_proposal_device_material(
      'dev_' || pg_catalog.repeat('A', 22)
    )
  ),
  'the proposal ingress reads only exact active device verification material'
);

SELECT pg_temp.assert_true(
  viberacing_api.propose_car_recipe(
    '00000000-0000-4000-8000-000000026201',
    pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
    '00000000-0000-4000-8000-000000026301',
    1,
    'roadster',
    'classic',
    'canopy',
    'none',
    'street',
    'magenta',
    'spark',
    42,
    pg_catalog.statement_timestamp() + INTERVAL '23 hours'
  ),
  'an exact active session creates one bounded proposal'
);

SELECT pg_temp.assert_true(
  (
    SELECT active_schema_version IS NULL
      AND proposal_id = '00000000-0000-4000-8000-000000026301'
      AND proposal_schema_version = 1
      AND proposal_chassis = 'roadster'
      AND proposal_nose = 'classic'
      AND proposal_cockpit = 'canopy'
      AND proposal_wing = 'none'
      AND proposal_wheels = 'street'
      AND proposal_palette = 'magenta'
      AND proposal_trail = 'spark'
      AND proposal_seed = 42
      AND proposal_expires_at > pg_catalog.statement_timestamp()
    FROM viberacing_api.read_car_recipe_state(
      '00000000-0000-4000-8000-000000026201',
      pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex')
    )
  ),
  'the possessed account reads only its exact pending recipe and no active recipe'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.propose_car_recipe(
      '00000000-0000-4000-8000-000000026201',
      pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
      '00000000-0000-4000-8000-000000026302',
      1,
      'roadster',
      'classic',
      'canopy',
      'none',
      'street',
      '#ffffff',
      'spark',
      42,
      pg_catalog.statement_timestamp() + INTERVAL '1 hour'
    )
  $sql$,
  'an arbitrary color is rejected before persistence'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.propose_car_recipe(
      '00000000-0000-4000-8000-000000026201',
      pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
      '00000000-0000-4000-8000-000000026302',
      2,
      'roadster',
      'classic',
      'canopy',
      'none',
      'street',
      'magenta',
      'spark',
      65536,
      pg_catalog.statement_timestamp() + INTERVAL '1 hour'
    )
  $sql$,
  'an unknown version and oversized seed are rejected before persistence'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.approve_car_recipe(
      '00000000-0000-4000-8000-000000026202',
      pg_catalog.decode(pg_catalog.repeat('a2', 32), 'hex'),
      '00000000-0000-4000-8000-000000026301'
    )
  $sql$,
  'another profile cannot approve a possessed proposal ID'
);

SELECT pg_temp.assert_true(
  viberacing_api.approve_car_recipe(
    '00000000-0000-4000-8000-000000026201',
    pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
    '00000000-0000-4000-8000-000000026301'
  ),
  'the exact session explicitly approves its pending proposal'
);

SELECT pg_temp.assert_true(
  (
    SELECT active_schema_version = 1
      AND active_chassis = 'roadster'
      AND active_nose = 'classic'
      AND active_cockpit = 'canopy'
      AND active_wing = 'none'
      AND active_wheels = 'street'
      AND active_palette = 'magenta'
      AND active_trail = 'spark'
      AND active_seed = 42
      AND proposal_id IS NULL
    FROM viberacing_api.read_car_recipe_state(
      '00000000-0000-4000-8000-000000026201',
      pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex')
    )
  ),
  'approval atomically activates only the reviewed recipe and consumes the proposal'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.approve_car_recipe(
      '00000000-0000-4000-8000-000000026201',
      pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
      '00000000-0000-4000-8000-000000026301'
    )
  $sql$,
  'approval cannot be replayed after proposal consumption'
);

SELECT pg_temp.assert_true(
  viberacing_api.propose_car_recipe(
    '00000000-0000-4000-8000-000000026201',
    pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
    '00000000-0000-4000-8000-000000026302',
    1,
    'rally',
    'scoop',
    'rally',
    'high',
    'all-terrain',
    'turbo-blue',
    'grid',
    65535,
    pg_catalog.statement_timestamp() + INTERVAL '23 hours'
  )
  AND viberacing_api.reject_car_recipe(
    '00000000-0000-4000-8000-000000026201',
    pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
    '00000000-0000-4000-8000-000000026302'
  ),
  'the exact session can reject and immediately remove a pending proposal'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

SELECT pg_temp.assert_true(
  (
    SELECT schema_version = 1
      AND chassis = 'roadster'
      AND palette = 'magenta'
      AND seed = 42
    FROM viberacing_private.profile_car_recipes
    WHERE profile_id = '00000000-0000-4000-8000-000000026101'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM viberacing_private.car_recipe_proposals
    WHERE profile_id = '00000000-0000-4000-8000-000000026101'
  ),
  'rejection changes no active recipe and retains no rejected proposal row'
);

UPDATE viberacing_private.profiles
SET state = 'hidden', hidden_at = pg_catalog.statement_timestamp()
WHERE profile_id = '00000000-0000-4000-8000-000000026101';

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT pg_temp.assert_true(
  viberacing_api.propose_car_recipe(
    '00000000-0000-4000-8000-000000026201',
    pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex'),
    '00000000-0000-4000-8000-000000026303',
    1,
    'formula',
    'wedge',
    'open',
    'low',
    'slick',
    'redline',
    'none',
    7,
    pg_catalog.statement_timestamp() + INTERVAL '1 hour'
  ),
  'a hidden profile retains its private car proposal control'
);

SELECT pg_temp.assert_true(
  viberacing_api.propose_car_recipe_from_device(
    '00000000-0000-4000-8000-000000026401',
    'dev_' || pg_catalog.repeat('A', 22),
    pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()),
    pg_catalog.decode(pg_catalog.repeat('c1', 32), 'hex'),
    '00000000-0000-4000-8000-000000026305',
    1,
    'rally',
    'scoop',
    'rally',
    'high',
    'all-terrain',
    'mint',
    'grid',
    1234
  ),
  'an active source-bound device may replace only the private pending proposal of its profile'
);

SELECT pg_temp.assert_true(
  (
    SELECT active_palette = 'magenta'
      AND proposal_id = '00000000-0000-4000-8000-000000026305'
      AND proposal_palette = 'mint'
      AND proposal_seed = 1234
      AND proposal_expires_at > pg_catalog.statement_timestamp() + INTERVAL '23 hours 59 minutes'
    FROM viberacing_api.read_car_recipe_state(
      '00000000-0000-4000-8000-000000026201',
      pg_catalog.decode(pg_catalog.repeat('a1', 32), 'hex')
    )
  ),
  'device ingress changes no active recipe and leaves the exact proposal for browser review'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.propose_car_recipe_from_device(
      '00000000-0000-4000-8000-000000026401',
      'dev_' || pg_catalog.repeat('A', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()),
      pg_catalog.decode(pg_catalog.repeat('c1', 32), 'hex'),
      '00000000-0000-4000-8000-000000026306',
      1,
      'formula',
      'classic',
      'canopy',
      'none',
      'street',
      'redline',
      'none',
      9
    )
  $sql$,
  'a device proposal nonce cannot be replayed with another recipe'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.propose_car_recipe_from_device(
      '00000000-0000-4000-8000-000000026402',
      'dev_' || pg_catalog.repeat('A', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()),
      pg_catalog.decode(pg_catalog.repeat('c2', 32), 'hex'),
      '00000000-0000-4000-8000-000000026306',
      1,
      'formula',
      'classic',
      'canopy',
      'none',
      'street',
      'redline',
      'none',
      9
    )
  $sql$,
  'a device identifier cannot be rebound to another device key or profile'
);

RESET ROLE;
SET LOCAL ROLE viberacing_owner;

UPDATE viberacing_private.codex_sources
SET state = 'paused'
WHERE source_id = 'src_' || pg_catalog.repeat('A', 22);

RESET ROLE;
SET LOCAL ROLE viberacing_web;

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM viberacing_api.read_car_proposal_device_material(
      'dev_' || pg_catalog.repeat('A', 22)
    )
  ),
  'a paused source exposes no device proposal verification material'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.propose_car_recipe_from_device(
      '00000000-0000-4000-8000-000000026401',
      'dev_' || pg_catalog.repeat('A', 22),
      pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()),
      pg_catalog.decode(pg_catalog.repeat('c3', 32), 'hex'),
      '00000000-0000-4000-8000-000000026306',
      1,
      'formula',
      'classic',
      'canopy',
      'none',
      'street',
      'redline',
      'none',
      9
    )
  $sql$,
  'a paused source-bound device cannot create a proposal'
);

SELECT pg_temp.expect_operation_failure(
  $sql$
    SELECT viberacing_api.propose_car_recipe(
      '00000000-0000-4000-8000-000000026201',
      pg_catalog.decode(pg_catalog.repeat('ff', 32), 'hex'),
      '00000000-0000-4000-8000-000000026304',
      1,
      'formula',
      'wedge',
      'open',
      'low',
      'slick',
      'redline',
      'none',
      7,
      pg_catalog.statement_timestamp() + INTERVAL '1 hour'
    )
  $sql$,
  'proposal mutation requires the exact keyed session verifier'
);

ROLLBACK;
