\set ON_ERROR_STOP on

-- Cluster-level role bootstrap. Run this with the protected deployment principal before
-- applying migrations. The roles are intentionally NOLOGIN groups: deployment supplies distinct
-- login principals and grants each principal exactly one runtime group outside this repository.

BEGIN;

DO $bootstrap$
DECLARE
  role_name name;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'viberacing_owner'::name,
    'viberacing_web'::name,
    'viberacing_ingest'::name,
    'viberacing_jobs'::name,
    'viberacing_admin'::name
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE pg_catalog.format(
        'CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
        role_name
      );
    END IF;
  END LOOP;
END
$bootstrap$;

ALTER ROLE viberacing_owner
  WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD NULL;
ALTER ROLE viberacing_web
  WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD NULL;
ALTER ROLE viberacing_ingest
  WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD NULL;
ALTER ROLE viberacing_jobs
  WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD NULL;
ALTER ROLE viberacing_admin
  WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD NULL;

DO $membership_guard$
DECLARE
  unsafe_memberships text;
BEGIN
  SELECT pg_catalog.string_agg(
    pg_catalog.format('%I -> %I', member_role.rolname, granted_role.rolname),
    ', ' ORDER BY member_role.rolname, granted_role.rolname
  )
  INTO unsafe_memberships
  FROM pg_catalog.pg_auth_members AS membership
  JOIN pg_catalog.pg_roles AS member_role ON member_role.oid = membership.member
  JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
  WHERE member_role.rolname IN (
    'viberacing_owner',
    'viberacing_web',
    'viberacing_ingest',
    'viberacing_jobs',
    'viberacing_admin'
  );

  IF unsafe_memberships IS NOT NULL THEN
    RAISE EXCEPTION 'Vibe Racing group roles have unexpected outbound memberships: %', unsafe_memberships;
  END IF;
END
$membership_guard$;

GRANT viberacing_owner TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;

DO $database_grants$
DECLARE
  database_name name := pg_catalog.current_database();
  role_name name;
BEGIN
  EXECUTE pg_catalog.format('REVOKE ALL ON DATABASE %I FROM PUBLIC', database_name);
  EXECUTE pg_catalog.format('GRANT CONNECT ON DATABASE %I TO CURRENT_USER', database_name);
  EXECUTE pg_catalog.format(
    'GRANT CONNECT, CREATE, TEMPORARY ON DATABASE %I TO viberacing_owner',
    database_name
  );
  EXECUTE pg_catalog.format(
    'ALTER DATABASE %I SET search_path TO pg_catalog, pg_temp',
    database_name
  );

  FOREACH role_name IN ARRAY ARRAY[
    'viberacing_web'::name,
    'viberacing_ingest'::name,
    'viberacing_jobs'::name,
    'viberacing_admin'::name
  ] LOOP
    EXECUTE pg_catalog.format('GRANT CONNECT ON DATABASE %I TO %I', database_name, role_name);
    EXECUTE pg_catalog.format(
      'ALTER ROLE %I IN DATABASE %I SET search_path TO pg_catalog, pg_temp',
      role_name,
      database_name
    );
  END LOOP;

  EXECUTE pg_catalog.format(
    'ALTER ROLE viberacing_owner IN DATABASE %I SET search_path TO pg_catalog, pg_temp',
    database_name
  );
END
$database_grants$;

REVOKE ALL ON SCHEMA public FROM PUBLIC;

COMMIT;
