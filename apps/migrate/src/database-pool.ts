import { Pool } from "pg";

import type { MigrationDatabaseConfig } from "./database-config.js";

const catalogLockKey = 824_762_001;
const runtimeBoundaryQuery = `SELECT
  CURRENT_USER = SESSION_USER
    AND SESSION_USER = $1::name AS login_ok,
  (
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      JOIN pg_catalog.pg_roles AS member_role
        ON member_role.oid = membership.member
      JOIN pg_catalog.pg_roles AS granted_role
        ON granted_role.oid = membership.roleid
      WHERE member_role.rolname = SESSION_USER
        AND granted_role.rolname = 'viberacing_owner'
        AND NOT membership.admin_option
        AND NOT membership.inherit_option
        AND membership.set_option
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
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      JOIN pg_catalog.pg_roles AS member_role
        ON member_role.oid = membership.member
      JOIN pg_catalog.pg_roles AS granted_role
        ON granted_role.oid = membership.roleid
      WHERE member_role.rolname = SESSION_USER
        AND granted_role.rolname <> 'viberacing_owner'
    )
  ) AS login_scope_ok,
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS owner_role
    WHERE owner_role.rolname = 'viberacing_owner'
      AND NOT owner_role.rolcanlogin
      AND NOT owner_role.rolsuper
      AND NOT owner_role.rolcreatedb
      AND NOT owner_role.rolcreaterole
      AND NOT owner_role.rolinherit
      AND NOT owner_role.rolreplication
      AND NOT owner_role.rolbypassrls
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_auth_members AS owner_membership
        WHERE owner_membership.member = owner_role.oid
      )
  ) AS owner_scope_ok,
  pg_catalog.current_setting('search_path') = 'pg_catalog,pg_temp' AS search_path_ok,
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_stat_ssl AS ssl_state
    WHERE ssl_state.pid = pg_catalog.pg_backend_pid()
      AND ssl_state.ssl = $2::boolean
  ) AS transport_ok,
  pg_catalog.current_setting('transaction_read_only') = 'off' AS read_write_ok`;
const acquireCatalogLockQuery = `SELECT true AS locked
FROM pg_catalog.pg_advisory_lock($1::bigint)`;
const releaseCatalogLockQuery = `SELECT
  pg_catalog.pg_advisory_unlock($1::bigint) AS unlocked`;
const ledgerPresenceQuery = `SELECT
  pg_catalog.to_regclass('viberacing_private.schema_migrations') IS NOT NULL AS ledger_exists`;
const ledgerRowsQuery = `SELECT revision, name
FROM viberacing_private.schema_migrations
ORDER BY revision`;
const assumeOwnerRoleQuery = "SET ROLE viberacing_owner";
const resetRoleQuery = "RESET ROLE";

export type MigrationDatabasePoolSignal = "idle_client_error";
export type MigrationDatabasePoolSignalSink = (
  signal: MigrationDatabasePoolSignal,
) => Promise<void> | void;

export interface MigrationDatabaseSession {
  acquireCatalogLock(): Promise<unknown>;
  applyMigration(sql: string): Promise<void>;
  assumeOwnerRole(): Promise<void>;
  readLedgerPresence(): Promise<unknown>;
  readLedgerRows(): Promise<unknown>;
  release(destroy?: boolean): void;
  releaseCatalogLock(): Promise<unknown>;
  resetRole(): Promise<void>;
  verifyRuntimeBoundary(): Promise<unknown>;
}

export interface MigrationDatabasePool {
  close(): Promise<void>;
  connect(): Promise<MigrationDatabaseSession>;
}

interface NodePostgresPool {
  connect(): Promise<NodePostgresClient>;
  end(): Promise<void>;
  on(event: "error", listener: (error: Error) => void): this;
}

interface NodePostgresClient {
  query(query: string | { text: string; values: unknown[] }): Promise<{ rows: unknown }>;
  release(destroy?: boolean): void;
}

type NodePostgresPoolFactory = (config: MigrationDatabaseConfig) => NodePostgresPool;

function defaultPoolFactory(config: MigrationDatabaseConfig): NodePostgresPool {
  return new Pool(config);
}

function signalSafely(
  sink: MigrationDatabasePoolSignalSink | undefined,
  signal: MigrationDatabasePoolSignal,
): void {
  try {
    const result = sink?.(signal);
    if (result !== undefined) {
      void result.catch(() => undefined);
    }
  } catch {
    // A closed monitoring signal cannot widen migration authority or crash an idle pool.
  }
}

function wrapClient(
  client: NodePostgresClient,
  config: MigrationDatabaseConfig,
): MigrationDatabaseSession {
  async function fixedQuery(text: string, values: readonly unknown[] = []): Promise<unknown> {
    const result = await client.query({ text, values: [...values] });
    return result.rows;
  }

  return Object.freeze({
    acquireCatalogLock(): Promise<unknown> {
      return fixedQuery(acquireCatalogLockQuery, [catalogLockKey]);
    },
    async applyMigration(sql: string): Promise<void> {
      await client.query(sql);
    },
    async assumeOwnerRole(): Promise<void> {
      await fixedQuery(assumeOwnerRoleQuery);
    },
    readLedgerPresence(): Promise<unknown> {
      return fixedQuery(ledgerPresenceQuery);
    },
    readLedgerRows(): Promise<unknown> {
      return fixedQuery(ledgerRowsQuery);
    },
    release(destroy = false): void {
      client.release(destroy);
    },
    releaseCatalogLock(): Promise<unknown> {
      return fixedQuery(releaseCatalogLockQuery, [catalogLockKey]);
    },
    async resetRole(): Promise<void> {
      await fixedQuery(resetRoleQuery);
    },
    verifyRuntimeBoundary(): Promise<unknown> {
      return fixedQuery(runtimeBoundaryQuery, [config.user, config.ssl !== false]);
    },
  });
}

export function createMigrationDatabasePool(
  config: MigrationDatabaseConfig,
  signalSink?: MigrationDatabasePoolSignalSink,
  poolFactory: NodePostgresPoolFactory = defaultPoolFactory,
): MigrationDatabasePool {
  const pool = poolFactory(config);
  pool.on("error", () => {
    signalSafely(signalSink, "idle_client_error");
  });
  return Object.freeze({
    async close(): Promise<void> {
      await pool.end();
    },
    async connect(): Promise<MigrationDatabaseSession> {
      return wrapClient(await pool.connect(), config);
    },
  });
}
