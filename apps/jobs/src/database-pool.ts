import { Pool } from "pg";

import type { JobsDatabaseConfig } from "./database-config.js";

const runtimeBoundaryQuery = `SELECT
  CURRENT_USER = 'viberacing_jobs' AS role_ok,
  (
    SESSION_USER <> CURRENT_USER
    AND pg_catalog.pg_has_role(SESSION_USER, 'viberacing_jobs', 'SET')
    AND pg_catalog.has_database_privilege(SESSION_USER, pg_catalog.current_database(), 'CONNECT')
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
        AND NOT login_role.rolreplication
        AND NOT login_role.rolbypassrls
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles AS granted_role
      WHERE granted_role.rolname <> SESSION_USER
        AND granted_role.rolname <> 'viberacing_jobs'
        AND pg_catalog.pg_has_role(SESSION_USER, granted_role.oid, 'MEMBER')
    )
  ) AS login_scope_ok,
  pg_catalog.current_setting('search_path') = 'pg_catalog,pg_temp' AS search_path_ok`;

const cleanupQuery = `SELECT
  cleanup.deleted_nonces AS deleted_nonces,
  cleanup.deleted_snapshots AS deleted_snapshots
FROM viberacing_api.cleanup_expired_ingest_state($1::integer) AS cleanup`;

const refreshQuery = `SELECT
  refresh.profile_count AS profile_count
FROM viberacing_api.refresh_community_season($1::date) AS refresh`;

const finalizationQuery = `SELECT
  finalization.profile_count AS profile_count
FROM viberacing_api.finalize_community_season($1::date) AS finalization`;

export type JobsDatabasePoolSignal = "idle_client_error";
export type JobsDatabasePoolSignalSink = (signal: JobsDatabasePoolSignal) => Promise<void> | void;

export interface JobsDatabaseClient {
  cleanupExpiredIngestState(batchSize: number): Promise<unknown>;
  finalizeCommunitySeason(seasonStart: string): Promise<unknown>;
  release(destroy?: boolean): void;
  refreshCommunitySeason(seasonStart: string): Promise<unknown>;
  verifyRuntimeBoundary(): Promise<unknown>;
}

export interface JobsDatabasePool {
  close(): Promise<void>;
  connect(): Promise<JobsDatabaseClient>;
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

type NodePostgresPoolFactory = (config: JobsDatabaseConfig) => NodePostgresPool;

function defaultPoolFactory(config: JobsDatabaseConfig): NodePostgresPool {
  return new Pool(config);
}

function signalSafely(
  sink: JobsDatabasePoolSignalSink | undefined,
  signal: JobsDatabasePoolSignal,
): void {
  try {
    const result = sink?.(signal);
    if (result !== undefined) {
      void result.catch(() => undefined);
    }
  } catch {
    // A monitoring hook cannot turn an already-contained idle-client failure into a process crash.
  }
}

function wrapClient(client: NodePostgresClient): JobsDatabaseClient {
  async function fixedQuery(text: string, values: readonly unknown[] = []): Promise<unknown> {
    const result = await client.query({ text, values: [...values] });
    return result.rows;
  }

  return Object.freeze({
    cleanupExpiredIngestState(batchSize: number): Promise<unknown> {
      return fixedQuery(cleanupQuery, [batchSize]);
    },
    finalizeCommunitySeason(seasonStart: string): Promise<unknown> {
      return fixedQuery(finalizationQuery, [seasonStart]);
    },
    release(destroy = false): void {
      client.release(destroy);
    },
    refreshCommunitySeason(seasonStart: string): Promise<unknown> {
      return fixedQuery(refreshQuery, [seasonStart]);
    },
    verifyRuntimeBoundary(): Promise<unknown> {
      return fixedQuery(runtimeBoundaryQuery);
    },
  });
}

export function createJobsDatabasePool(
  config: JobsDatabaseConfig,
  signalSink?: JobsDatabasePoolSignalSink,
  poolFactory: NodePostgresPoolFactory = defaultPoolFactory,
): JobsDatabasePool {
  const pool = poolFactory(config);
  pool.on("error", () => {
    signalSafely(signalSink, "idle_client_error");
  });

  return Object.freeze({
    async close(): Promise<void> {
      await pool.end();
    },
    async connect(): Promise<JobsDatabaseClient> {
      return wrapClient(await pool.connect());
    },
  });
}
