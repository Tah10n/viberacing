\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;

SELECT pg_catalog.pg_advisory_xact_lock(824762001);

CREATE SCHEMA viberacing_private AUTHORIZATION viberacing_owner;
CREATE SCHEMA viberacing_api AUTHORIZATION viberacing_owner;

REVOKE ALL ON SCHEMA viberacing_private FROM PUBLIC;
REVOKE ALL ON SCHEMA viberacing_api FROM PUBLIC;
GRANT USAGE ON SCHEMA viberacing_api
  TO viberacing_web, viberacing_ingest, viberacing_jobs, viberacing_admin;

CREATE TABLE viberacing_private.schema_migrations (
  revision integer PRIMARY KEY,
  name text NOT NULL UNIQUE,
  applied_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  CONSTRAINT schema_migrations_revision_positive CHECK (revision > 0),
  CONSTRAINT schema_migrations_name_canonical
    CHECK (name ~ '^[a-z][a-z0-9_]{2,62}$')
);

CREATE TABLE viberacing_private.profiles (
  profile_id uuid PRIMARY KEY,
  github_user_id bigint NOT NULL UNIQUE,
  handle varchar(24) NOT NULL UNIQUE,
  locale varchar(2) NOT NULL DEFAULT 'en',
  theme varchar(16) NOT NULL DEFAULT 'classic',
  motion_preference varchar(16) NOT NULL DEFAULT 'system',
  public_visibility varchar(8) NOT NULL DEFAULT 'hidden',
  provider_breakdown_visible boolean NOT NULL DEFAULT false,
  state varchar(20) NOT NULL DEFAULT 'enrolling',
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  hidden_at timestamptz,
  deletion_requested_at timestamptz,
  CONSTRAINT profiles_github_user_id_positive CHECK (github_user_id > 0),
  CONSTRAINT profiles_handle_canonical
    CHECK (handle ~ '^[a-z0-9](?:[a-z0-9_-]{1,22}[a-z0-9])$'),
  CONSTRAINT profiles_locale_closed CHECK (locale IN ('en', 'ru')),
  CONSTRAINT profiles_theme_closed CHECK (theme IN ('classic', 'neon', 'mono')),
  CONSTRAINT profiles_motion_closed CHECK (motion_preference IN ('system', 'reduce')),
  CONSTRAINT profiles_visibility_closed CHECK (public_visibility IN ('public', 'hidden')),
  CONSTRAINT profiles_state_closed CHECK (state IN ('enrolling', 'active', 'deletion_pending')),
  CONSTRAINT profiles_time_order CHECK (
    updated_at >= created_at
    AND (hidden_at IS NULL OR hidden_at >= created_at)
    AND (deletion_requested_at IS NULL OR deletion_requested_at >= created_at)
  ),
  CONSTRAINT profiles_hidden_shape CHECK (
    (public_visibility = 'public' AND hidden_at IS NULL)
    OR (public_visibility = 'hidden' AND hidden_at IS NOT NULL)
  ),
  CONSTRAINT profiles_deletion_shape CHECK (
    (state = 'deletion_pending'
      AND public_visibility = 'hidden'
      AND hidden_at IS NOT NULL
      AND deletion_requested_at IS NOT NULL)
    OR (state <> 'deletion_pending' AND deletion_requested_at IS NULL)
  )
);

CREATE INDEX profiles_public_handle_idx
  ON viberacing_private.profiles (handle)
  WHERE state = 'active' AND public_visibility = 'public';

CREATE FUNCTION viberacing_private.operation_failed()
RETURNS void
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = 'P0001',
    MESSAGE = 'The operation could not be completed.';
END
$function$;

CREATE FUNCTION viberacing_private.enforce_profile_insert()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.created_at <> NEW.updated_at
    OR NEW.state <> 'enrolling'
    OR NEW.public_visibility <> 'hidden'
    OR NEW.hidden_at IS NULL
    OR NEW.deletion_requested_at IS NOT NULL
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER profiles_enforce_insert
BEFORE INSERT ON viberacing_private.profiles
FOR EACH ROW EXECUTE FUNCTION viberacing_private.enforce_profile_insert();

CREATE FUNCTION viberacing_private.enforce_profile_update()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.profile_id <> OLD.profile_id
    OR NEW.github_user_id <> OLD.github_user_id
    OR NEW.created_at <> OLD.created_at
    OR NEW.updated_at < OLD.updated_at
    OR OLD.state = 'deletion_pending'
    OR (OLD.state = 'enrolling' AND NEW.state NOT IN ('enrolling', 'active', 'deletion_pending'))
    OR (OLD.state = 'active' AND NEW.state NOT IN ('active', 'deletion_pending'))
  THEN
    PERFORM viberacing_private.operation_failed();
  END IF;

  NEW.updated_at := pg_catalog.clock_timestamp();

  IF NEW.public_visibility = 'hidden' AND OLD.public_visibility = 'public' THEN
    NEW.hidden_at := NEW.updated_at;
  ELSIF NEW.public_visibility = 'public' AND OLD.public_visibility = 'hidden' THEN
    NEW.hidden_at := NULL;
  END IF;

  IF NEW.state = 'deletion_pending' AND OLD.state <> 'deletion_pending' THEN
    NEW.public_visibility := 'hidden';
    NEW.hidden_at := NEW.updated_at;
    NEW.deletion_requested_at := NEW.updated_at;
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER profiles_enforce_update
BEFORE UPDATE ON viberacing_private.profiles
FOR EACH ROW EXECUTE FUNCTION viberacing_private.enforce_profile_update();

ALTER TABLE viberacing_private.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.schema_migrations FORCE ROW LEVEL SECURITY;
CREATE POLICY schema_migrations_owner_only ON viberacing_private.schema_migrations
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

ALTER TABLE viberacing_private.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE viberacing_private.profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY profiles_owner_only ON viberacing_private.profiles
  USING (CURRENT_USER = 'viberacing_owner')
  WITH CHECK (CURRENT_USER = 'viberacing_owner');

REVOKE ALL ON ALL TABLES IN SCHEMA viberacing_private FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA viberacing_private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA viberacing_private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA viberacing_api FROM PUBLIC;

INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (1, 'roles_schemas_and_identity');

COMMIT;
