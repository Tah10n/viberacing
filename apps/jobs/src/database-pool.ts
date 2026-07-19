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

const agedRevokedPasskeyCleanupQuery = `SELECT
  cleanup.deleted_passkeys AS deleted_passkeys
FROM viberacing_api.cleanup_aged_revoked_passkeys($1::integer) AS cleanup`;

const cleanupQuery = `SELECT
  cleanup.deleted_origin_nonces AS deleted_origin_nonces,
  cleanup.deleted_nonces AS deleted_nonces,
  cleanup.deleted_snapshots AS deleted_snapshots
FROM viberacing_api.cleanup_expired_ingest_state($1::integer) AS cleanup`;

const authCleanupQuery = `SELECT
  cleanup.deleted_challenges AS deleted_challenges,
  cleanup.deleted_recovery_authorities AS deleted_recovery_authorities,
  cleanup.deleted_used_recovery_codes AS deleted_used_recovery_codes
FROM viberacing_api.cleanup_expired_auth_state($1::integer) AS cleanup`;

const auditCleanupQuery = `SELECT
  cleanup.deleted_audit_events AS deleted_audit_events
FROM viberacing_api.cleanup_expired_audit_events($1::integer) AS cleanup`;

const carRecipeProposalCleanupQuery = `SELECT
  cleanup.deleted_proposals AS deleted_proposals
FROM viberacing_api.cleanup_expired_car_recipe_proposals($1::integer) AS cleanup`;

const inviteCleanupQuery = `SELECT
  cleanup.deleted_invites AS deleted_invites
FROM viberacing_api.cleanup_expired_invites($1::integer) AS cleanup`;

const pairingCleanupQuery = `SELECT
  cleanup.deleted_pairings AS deleted_pairings,
  cleanup.deleted_pending_keys AS deleted_pending_keys
FROM viberacing_api.cleanup_expired_pairing_state($1::integer) AS cleanup`;

const pairingApprovalProvenanceRedactionQuery = `SELECT
  cleanup.redacted_pairings AS redacted_pairings
FROM viberacing_api.redact_aged_pairing_approval_provenance($1::integer) AS cleanup`;

const sessionCleanupQuery = `SELECT
  cleanup.deleted_sessions AS deleted_sessions
FROM viberacing_api.cleanup_expired_sessions($1::integer) AS cleanup`;

const terminalDeletionJobCleanupQuery = `SELECT
  cleanup.deleted_deletion_jobs AS deleted_deletion_jobs
FROM viberacing_api.cleanup_terminal_deletion_jobs($1::integer) AS cleanup`;

const profileDeletionPurgeQuery = `SELECT
  purge.purged_profiles AS purged_profiles
FROM viberacing_api.purge_profile_deletions($1::integer) AS purge`;

const refreshQuery = `SELECT
  refresh.profile_count AS profile_count
FROM viberacing_api.refresh_community_season($1::date) AS refresh`;

const finalizationQuery = `SELECT
  finalization.profile_count AS profile_count
FROM viberacing_api.finalize_community_season($1::date) AS finalization`;

export type JobsDatabasePoolSignal = "idle_client_error";
export type JobsDatabasePoolSignalSink = (signal: JobsDatabasePoolSignal) => Promise<void> | void;

export interface JobsDatabaseClient {
  cleanupAgedRevokedPasskeys(batchSize: number): Promise<unknown>;
  cleanupExpiredAuthState(batchSize: number): Promise<unknown>;
  cleanupExpiredAuditEvents(batchSize: number): Promise<unknown>;
  cleanupExpiredCarRecipeProposals(batchSize: number): Promise<unknown>;
  cleanupExpiredInvites(batchSize: number): Promise<unknown>;
  cleanupExpiredIngestState(batchSize: number): Promise<unknown>;
  cleanupExpiredPairingState(batchSize: number): Promise<unknown>;
  cleanupExpiredSessions(batchSize: number): Promise<unknown>;
  cleanupTerminalDeletionJobs(batchSize: number): Promise<unknown>;
  finalizeCommunitySeason(seasonStart: string): Promise<unknown>;
  purgeProfileDeletions(batchSize: number): Promise<unknown>;
  redactAgedPairingApprovalProvenance(batchSize: number): Promise<unknown>;
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
    cleanupAgedRevokedPasskeys(batchSize: number): Promise<unknown> {
      return fixedQuery(agedRevokedPasskeyCleanupQuery, [batchSize]);
    },
    cleanupExpiredAuthState(batchSize: number): Promise<unknown> {
      return fixedQuery(authCleanupQuery, [batchSize]);
    },
    cleanupExpiredAuditEvents(batchSize: number): Promise<unknown> {
      return fixedQuery(auditCleanupQuery, [batchSize]);
    },
    cleanupExpiredCarRecipeProposals(batchSize: number): Promise<unknown> {
      return fixedQuery(carRecipeProposalCleanupQuery, [batchSize]);
    },
    cleanupExpiredInvites(batchSize: number): Promise<unknown> {
      return fixedQuery(inviteCleanupQuery, [batchSize]);
    },
    cleanupExpiredIngestState(batchSize: number): Promise<unknown> {
      return fixedQuery(cleanupQuery, [batchSize]);
    },
    cleanupExpiredPairingState(batchSize: number): Promise<unknown> {
      return fixedQuery(pairingCleanupQuery, [batchSize]);
    },
    cleanupExpiredSessions(batchSize: number): Promise<unknown> {
      return fixedQuery(sessionCleanupQuery, [batchSize]);
    },
    cleanupTerminalDeletionJobs(batchSize: number): Promise<unknown> {
      return fixedQuery(terminalDeletionJobCleanupQuery, [batchSize]);
    },
    finalizeCommunitySeason(seasonStart: string): Promise<unknown> {
      return fixedQuery(finalizationQuery, [seasonStart]);
    },
    purgeProfileDeletions(batchSize: number): Promise<unknown> {
      return fixedQuery(profileDeletionPurgeQuery, [batchSize]);
    },
    redactAgedPairingApprovalProvenance(batchSize: number): Promise<unknown> {
      return fixedQuery(pairingApprovalProvenanceRedactionQuery, [batchSize]);
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
