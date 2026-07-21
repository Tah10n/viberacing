import { Buffer } from "node:buffer";

import { Pool } from "pg";

import type { AdminDatabaseConfig } from "./database-config.js";

const loginBoundaryQuery = `SELECT
  (
    CURRENT_USER = SESSION_USER
    AND SESSION_USER = $1::name
  ) AS login_ok,
  (
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      JOIN pg_catalog.pg_roles AS member_role
        ON member_role.oid = membership.member
      JOIN pg_catalog.pg_roles AS granted_role
        ON granted_role.oid = membership.roleid
      WHERE member_role.rolname = SESSION_USER
        AND granted_role.rolname = 'viberacing_admin'
        AND NOT membership.admin_option
        AND NOT membership.inherit_option
        AND membership.set_option
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      JOIN pg_catalog.pg_roles AS member_role
        ON member_role.oid = membership.member
      JOIN pg_catalog.pg_roles AS granted_role
        ON granted_role.oid = membership.roleid
      WHERE member_role.rolname = SESSION_USER
        AND granted_role.rolname <> 'viberacing_admin'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles AS login_role
      WHERE login_role.rolname = SESSION_USER
        AND login_role.rolcanlogin
        AND NOT login_role.rolsuper
        AND NOT login_role.rolcreatedb
        AND NOT login_role.rolcreaterole
        AND NOT login_role.rolinherit
        AND NOT login_role.rolreplication
        AND NOT login_role.rolbypassrls
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles AS admin_role
      WHERE admin_role.rolname = 'viberacing_admin'
        AND NOT admin_role.rolcanlogin
        AND NOT admin_role.rolsuper
        AND NOT admin_role.rolcreatedb
        AND NOT admin_role.rolcreaterole
        AND NOT admin_role.rolinherit
        AND NOT admin_role.rolreplication
        AND NOT admin_role.rolbypassrls
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_auth_members AS outbound_membership
          WHERE outbound_membership.member = admin_role.oid
        )
    )
    AND NOT pg_catalog.has_schema_privilege(SESSION_USER, 'viberacing_api', 'USAGE')
    AND NOT pg_catalog.has_schema_privilege(SESSION_USER, 'viberacing_api', 'CREATE')
    AND NOT pg_catalog.has_schema_privilege(SESSION_USER, 'viberacing_private', 'USAGE')
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'viberacing_api'
        AND pg_catalog.has_function_privilege(SESSION_USER, procedure.oid, 'EXECUTE')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'viberacing_private'
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND pg_catalog.has_table_privilege(
          SESSION_USER,
          relation.oid,
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
        )
    )
    AND pg_catalog.has_database_privilege(
      SESSION_USER,
      pg_catalog.current_database(),
      'CONNECT'
    )
    AND NOT pg_catalog.has_database_privilege(
      SESSION_USER,
      pg_catalog.current_database(),
      'CREATE'
    )
    AND NOT pg_catalog.has_database_privilege(
      SESSION_USER,
      pg_catalog.current_database(),
      'TEMPORARY'
    )
  ) AS login_scope_ok,
  pg_catalog.current_setting('search_path') = 'pg_catalog,pg_temp' AS search_path_ok,
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_stat_ssl AS ssl_state
    WHERE ssl_state.pid = pg_catalog.pg_backend_pid()
      AND ssl_state.ssl = $2::boolean
  ) AS transport_ok,
  pg_catalog.current_setting('transaction_read_only') = 'off' AS read_write_ok`;

const assumeAdminRoleQuery = "SET ROLE viberacing_admin";
const resetAdminRoleQuery = "RESET ROLE";

const capabilityBoundaryQuery = `SELECT
  (
    CURRENT_USER = 'viberacing_admin'
    AND SESSION_USER = $1::name
  ) AS role_ok,
  (
    pg_catalog.has_schema_privilege(CURRENT_USER, 'viberacing_api', 'USAGE')
    AND NOT pg_catalog.has_schema_privilege(CURRENT_USER, 'viberacing_api', 'CREATE')
    AND NOT pg_catalog.has_schema_privilege(CURRENT_USER, 'viberacing_private', 'USAGE')
    AND (
      SELECT pg_catalog.count(*) = 1
        AND pg_catalog.bool_and(
          procedure.proname = 'issue_invite'
          AND owner_role.rolname = 'viberacing_owner'
          AND procedure.prosecdef
          AND procedure.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']::text[]
          AND pg_catalog.pg_get_function_identity_arguments(procedure.oid)
            = 'p_invite_id uuid, p_verifier_digest bytea, p_expires_at timestamp with time zone, p_audit_event_id uuid, p_request_id text, p_reason_code text'
        )
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      JOIN pg_catalog.pg_roles AS owner_role
        ON owner_role.oid = procedure.proowner
      WHERE namespace.nspname = 'viberacing_api'
        AND pg_catalog.has_function_privilege(CURRENT_USER, procedure.oid, 'EXECUTE')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'viberacing_private'
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND pg_catalog.has_table_privilege(
          CURRENT_USER,
          relation.oid,
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
        )
    )
  ) AS capability_scope_ok,
  pg_catalog.current_setting('search_path') = 'pg_catalog,pg_temp' AS search_path_ok,
  pg_catalog.current_setting('transaction_read_only') = 'off' AS read_write_ok`;

const issueInviteQuery = `WITH applied AS MATERIALIZED (
  SELECT viberacing_api.issue_invite(
    $1::uuid,
    $2::bytea,
    $3::timestamptz,
    $4::uuid,
    $5::text,
    $6::text
  ) AS ignored
)
SELECT pg_catalog.count(*) = 1 AS issued
FROM applied`;

export interface AdminInviteDatabaseInput {
  readonly auditEventId: string;
  readonly expiresAt: Date;
  readonly inviteId: string;
  readonly reasonCode: "BETA_ADMISSION";
  readonly requestId: string;
  readonly verifierDigest: Uint8Array;
}

export type AdminDatabasePoolSignal = "idle_client_error";
export type AdminDatabasePoolSignalSink = (signal: AdminDatabasePoolSignal) => Promise<void> | void;

export interface AdminDatabaseClient {
  assumeAdminRole(): Promise<void>;
  issueInvite(input: AdminInviteDatabaseInput): Promise<unknown>;
  release(destroy?: boolean): void;
  resetAdminRole(): Promise<void>;
  verifyCapabilityBoundary(): Promise<unknown>;
  verifyLoginBoundary(): Promise<unknown>;
}

export interface AdminDatabasePool {
  close(): Promise<void>;
  connect(): Promise<AdminDatabaseClient>;
}

interface NodePostgresPool {
  connect(): Promise<NodePostgresClient>;
  end(): Promise<void>;
  on(event: "error", listener: (error: Error) => void): this;
}

interface NodePostgresClient {
  query(query: { text: string; values: unknown[] }): Promise<{ rows: unknown }>;
  release(destroy?: boolean): void;
}

type NodePostgresPoolFactory = (config: AdminDatabaseConfig) => NodePostgresPool;

function defaultPoolFactory(config: AdminDatabaseConfig): NodePostgresPool {
  return new Pool(config);
}

function signalSafely(
  sink: AdminDatabasePoolSignalSink | undefined,
  signal: AdminDatabasePoolSignal,
): void {
  try {
    const result = sink?.(signal);
    if (result !== undefined) {
      void result.catch(() => undefined);
    }
  } catch {
    // A closed monitoring signal cannot widen authority or crash an idle pool.
  }
}

function wrapClient(client: NodePostgresClient, config: AdminDatabaseConfig): AdminDatabaseClient {
  async function fixedQuery(text: string, values: readonly unknown[] = []): Promise<unknown> {
    const result = await client.query({ text, values: [...values] });
    return result.rows;
  }

  return Object.freeze({
    async assumeAdminRole(): Promise<void> {
      await fixedQuery(assumeAdminRoleQuery);
    },
    async issueInvite(input: AdminInviteDatabaseInput): Promise<unknown> {
      const verifierDigest = Buffer.from(input.verifierDigest);
      try {
        return await fixedQuery(issueInviteQuery, [
          input.inviteId,
          verifierDigest,
          input.expiresAt,
          input.auditEventId,
          input.requestId,
          input.reasonCode,
        ]);
      } finally {
        verifierDigest.fill(0);
      }
    },
    release(destroy = false): void {
      client.release(destroy);
    },
    async resetAdminRole(): Promise<void> {
      await fixedQuery(resetAdminRoleQuery);
    },
    verifyCapabilityBoundary(): Promise<unknown> {
      return fixedQuery(capabilityBoundaryQuery, [config.user]);
    },
    verifyLoginBoundary(): Promise<unknown> {
      return fixedQuery(loginBoundaryQuery, [config.user, config.ssl !== false]);
    },
  });
}

export function createAdminDatabasePool(
  config: AdminDatabaseConfig,
  signalSink?: AdminDatabasePoolSignalSink,
  poolFactory: NodePostgresPoolFactory = defaultPoolFactory,
): AdminDatabasePool {
  const pool = poolFactory(config);
  pool.on("error", () => {
    signalSafely(signalSink, "idle_client_error");
  });
  return Object.freeze({
    async close(): Promise<void> {
      await pool.end();
    },
    async connect(): Promise<AdminDatabaseClient> {
      return wrapClient(await pool.connect(), config);
    },
  });
}
