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
  pg_catalog.current_setting('search_path') = 'pg_catalog,pg_temp' AS search_path_ok,
  pg_catalog.current_setting('default_transaction_read_only') = 'off' AS read_write_ok`;

const ensureCurrentSeasonQuery = `SELECT
  viberacing_api.ensure_current_community_season()::text AS season_start`;

const refreshDirtyLeaderboardQuery = `SELECT
  refresh.outcome,
  refresh.season_start::text AS season_start,
  refresh.snapshot_id
FROM viberacing_api.refresh_next_dirty_community_season() AS refresh`;

const finalizeDueSeasonQuery = `SELECT
  finalization.outcome,
  finalization.season_start::text AS season_start,
  finalization.snapshot_id
FROM viberacing_api.finalize_next_due_community_season() AS finalization`;

const pairingCleanupQuery = `SELECT
  cleanup.deleted_pairings,
  cleanup.deleted_accounts,
  cleanup.deleted_installations
FROM viberacing_api.cleanup_expired_pairing_state($1::integer) AS cleanup`;

const usageNonceCleanupQuery = `SELECT
  cleanup.deleted_origin_nonces,
  cleanup.deleted_device_nonces
FROM viberacing_api.cleanup_expired_usage_nonces($1::integer) AS cleanup`;

const usageHistoryCleanupQuery = `SELECT
  cleanup.redacted_day_totals,
  cleanup.deleted_idempotency_records,
  cleanup.deleted_observations
FROM viberacing_api.cleanup_expired_usage_history($1::integer) AS cleanup`;

const authCleanupQuery = `SELECT
  cleanup.deleted_challenges,
  cleanup.deleted_sessions,
  cleanup.deleted_invites,
  cleanup.deleted_recovery_codes
FROM viberacing_api.cleanup_expired_auth_state($1::integer) AS cleanup`;

const authorityCleanupQuery = `SELECT
  cleanup.redacted_pairings,
  cleanup.deleted_passkeys,
  cleanup.deleted_device_keys,
  cleanup.deleted_installations
FROM viberacing_api.cleanup_aged_revoked_authority($1::integer) AS cleanup`;

const snapshotCleanupQuery = `SELECT
  cleanup.deleted_snapshots
FROM viberacing_api.cleanup_snapshot_history($1::integer) AS cleanup`;

const auditEventCleanupQuery = `SELECT
  cleanup.deleted_ranking_events,
  cleanup.deleted_admin_audit_events
FROM viberacing_api.cleanup_expired_audit_events($1::integer) AS cleanup`;

const profileDeletionPurgeQuery = `SELECT
  purge.purged_profiles
FROM viberacing_api.purge_profile_deletions($1::integer) AS purge`;

const terminalDeletionJobCleanupQuery = `SELECT
  cleanup.deleted_deletion_jobs
FROM viberacing_api.cleanup_terminal_deletion_jobs($1::integer) AS cleanup`;

const pairingRequestWindowResetQuery = `SELECT
  reset.reset_windows
FROM viberacing_api.reset_expired_pairing_request_windows() AS reset`;

export type JobsDatabasePoolSignal = "idle_client_error";
export type JobsDatabasePoolSignalSink = (signal: JobsDatabasePoolSignal) => Promise<void> | void;

export interface JobsDatabaseClient {
  cleanupAgedRevokedAuthority(batchSize: number): Promise<unknown>;
  cleanupExpiredAuthState(batchSize: number): Promise<unknown>;
  cleanupExpiredPairingState(batchSize: number): Promise<unknown>;
  cleanupExpiredAuditEvents(batchSize: number): Promise<unknown>;
  cleanupExpiredUsageHistory(batchSize: number): Promise<unknown>;
  cleanupExpiredUsageNonces(batchSize: number): Promise<unknown>;
  cleanupSnapshotHistory(batchSize: number): Promise<unknown>;
  cleanupTerminalDeletionJobs(batchSize: number): Promise<unknown>;
  ensureCurrentSeason(): Promise<unknown>;
  finalizeDueSeason(): Promise<unknown>;
  purgeProfileDeletions(batchSize: number): Promise<unknown>;
  refreshDirtyLeaderboard(): Promise<unknown>;
  release(destroy?: boolean): void;
  resetExpiredPairingRequestWindows(): Promise<unknown>;
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

/* v8 ignore next -- exercised with the real driver by the PostgreSQL integration gate. */
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
    cleanupAgedRevokedAuthority(batchSize: number): Promise<unknown> {
      return fixedQuery(authorityCleanupQuery, [batchSize]);
    },
    cleanupExpiredAuthState(batchSize: number): Promise<unknown> {
      return fixedQuery(authCleanupQuery, [batchSize]);
    },
    cleanupExpiredPairingState(batchSize: number): Promise<unknown> {
      return fixedQuery(pairingCleanupQuery, [batchSize]);
    },
    cleanupExpiredAuditEvents(batchSize: number): Promise<unknown> {
      return fixedQuery(auditEventCleanupQuery, [batchSize]);
    },
    cleanupExpiredUsageHistory(batchSize: number): Promise<unknown> {
      return fixedQuery(usageHistoryCleanupQuery, [batchSize]);
    },
    cleanupExpiredUsageNonces(batchSize: number): Promise<unknown> {
      return fixedQuery(usageNonceCleanupQuery, [batchSize]);
    },
    cleanupSnapshotHistory(batchSize: number): Promise<unknown> {
      return fixedQuery(snapshotCleanupQuery, [batchSize]);
    },
    cleanupTerminalDeletionJobs(batchSize: number): Promise<unknown> {
      return fixedQuery(terminalDeletionJobCleanupQuery, [batchSize]);
    },
    ensureCurrentSeason(): Promise<unknown> {
      return fixedQuery(ensureCurrentSeasonQuery);
    },
    finalizeDueSeason(): Promise<unknown> {
      return fixedQuery(finalizeDueSeasonQuery);
    },
    purgeProfileDeletions(batchSize: number): Promise<unknown> {
      return fixedQuery(profileDeletionPurgeQuery, [batchSize]);
    },
    refreshDirtyLeaderboard(): Promise<unknown> {
      return fixedQuery(refreshDirtyLeaderboardQuery);
    },
    release(destroy = false): void {
      client.release(destroy);
    },
    resetExpiredPairingRequestWindows(): Promise<unknown> {
      return fixedQuery(pairingRequestWindowResetQuery);
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
