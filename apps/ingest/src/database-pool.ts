import { Pool } from "pg";

import type { IngestDatabaseConfig } from "./database-config.js";

const runtimeBoundaryQuery = `SELECT
  CURRENT_USER = 'viberacing_ingest' AS role_ok,
  (
    SESSION_USER <> CURRENT_USER
    AND pg_catalog.pg_has_role(SESSION_USER, 'viberacing_ingest', 'SET')
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
        AND granted_role.rolname <> 'viberacing_ingest'
        AND pg_catalog.pg_has_role(SESSION_USER, granted_role.oid, 'MEMBER')
    )
  ) AS login_scope_ok,
  pg_catalog.current_setting('search_path') = 'pg_catalog,pg_temp' AS search_path_ok`;

const deviceVerificationQuery = `SELECT
  material.device_key_id::text AS device_key_id,
  material.device_id::text AS device_id,
  material.installation_id::text AS installation_id,
  material.agent_account_id::text AS agent_account_id,
  material.public_key AS public_key,
  material.provider_code::text AS provider_code,
  material.accounting_revision AS accounting_revision,
  material.reader_version::text AS reader_version,
  material.scope_kind::text AS scope_kind,
  material.maximum_backfill_days AS maximum_backfill_days,
  material.identity_assurance::text AS identity_assurance
FROM viberacing_api.read_usage_device_verification_material($1::text) AS material`;

const submitUsageSyncQuery = `SELECT
  submission.outcome AS outcome,
  submission.accepted_entries AS accepted_entries,
  submission.recovery_action AS recovery_action
FROM viberacing_api.submit_usage_sync(
  $1::text,
  $2::text,
  $3::text,
  $4::bytea,
  $5::timestamptz,
  $6::text,
  $7::text,
  $8::text,
  $9::text,
  $10::timestamptz,
  $11::text,
  $12::text,
  $13::bytea,
  $14::bytea,
  $15::bytea,
  $16::date[],
  $17::text[]
) AS submission`;

export interface IngestDatabaseUsageSubmission {
  readonly agentAccountId: string;
  readonly bodyDigest: Uint8Array;
  readonly clientVersion: string;
  readonly dailyTokenTotals: readonly string[];
  readonly deviceId: string;
  readonly deviceKeyId: string;
  readonly deviceNonceDigest: Uint8Array;
  readonly eventId: string;
  readonly observationId: string;
  readonly observedAt: string;
  readonly originExpiresAt: string;
  readonly originKeyId: string;
  readonly originNonceDigest: Uint8Array;
  readonly readerVersion: string;
  readonly signature: Uint8Array;
  readonly syncId: string;
  readonly usageDates: readonly string[];
}

export type IngestDatabasePoolSignal = "idle_client_error";
export type IngestDatabasePoolSignalSink = (
  signal: IngestDatabasePoolSignal,
) => Promise<void> | void;

export interface IngestDatabaseClient {
  readDeviceVerificationMaterial(deviceId: string): Promise<unknown>;
  release(destroy?: boolean): void;
  submitUsageSync(input: IngestDatabaseUsageSubmission): Promise<unknown>;
  verifyRuntimeBoundary(): Promise<unknown>;
}

export interface IngestDatabasePool {
  close(): Promise<void>;
  connect(): Promise<IngestDatabaseClient>;
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

type NodePostgresPoolFactory = (config: IngestDatabaseConfig) => NodePostgresPool;

function defaultPoolFactory(config: IngestDatabaseConfig): NodePostgresPool {
  return new Pool(config);
}

function signalSafely(
  sink: IngestDatabasePoolSignalSink | undefined,
  signal: IngestDatabasePoolSignal,
): void {
  try {
    const result = sink?.(signal);
    if (result !== undefined) {
      void result.catch(() => undefined);
    }
  } catch {
    // Monitoring cannot turn an already-contained idle-client failure into a process crash.
  }
}

function wrapClient(client: NodePostgresClient): IngestDatabaseClient {
  async function fixedQuery(text: string, values: readonly unknown[] = []): Promise<unknown> {
    const result = await client.query({ text, values: [...values] });
    return result.rows;
  }

  return Object.freeze({
    readDeviceVerificationMaterial(deviceId: string): Promise<unknown> {
      return fixedQuery(deviceVerificationQuery, [deviceId]);
    },
    release(destroy = false): void {
      client.release(destroy);
    },
    submitUsageSync(input: IngestDatabaseUsageSubmission): Promise<unknown> {
      return fixedQuery(submitUsageSyncQuery, [
        input.observationId,
        input.eventId,
        input.originKeyId,
        Buffer.from(input.originNonceDigest),
        input.originExpiresAt,
        input.deviceKeyId,
        input.deviceId,
        input.agentAccountId,
        input.syncId,
        input.observedAt,
        input.clientVersion,
        input.readerVersion,
        Buffer.from(input.bodyDigest),
        Buffer.from(input.signature),
        Buffer.from(input.deviceNonceDigest),
        [...input.usageDates],
        [...input.dailyTokenTotals],
      ]);
    },
    verifyRuntimeBoundary(): Promise<unknown> {
      return fixedQuery(runtimeBoundaryQuery);
    },
  });
}

export function createIngestDatabasePool(
  config: IngestDatabaseConfig,
  signalSink?: IngestDatabasePoolSignalSink,
  poolFactory: NodePostgresPoolFactory = defaultPoolFactory,
): IngestDatabasePool {
  const pool = poolFactory(config);
  pool.on("error", () => {
    signalSafely(signalSink, "idle_client_error");
  });

  return Object.freeze({
    async close(): Promise<void> {
      await pool.end();
    },
    async connect(): Promise<IngestDatabaseClient> {
      return wrapClient(await pool.connect());
    },
  });
}
