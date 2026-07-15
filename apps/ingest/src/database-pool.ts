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
  material.source_id AS source_id,
  material.public_key AS public_key
FROM viberacing_api.read_device_verification_material($1::text) AS material`;

const submitCommunitySyncQuery = `SELECT
  submission.outcome AS outcome,
  submission.accepted_entries AS accepted_entries
FROM viberacing_api.submit_community_sync(
  $1::uuid,
  $2::text,
  $3::text,
  $4::uuid,
  $5::text,
  $6::timestamptz,
  $7::text,
  $8::text,
  $9::bytea,
  $10::bytea,
  $11::bytea,
  $12::text[],
  $13::bigint[]
) AS submission`;

export interface IngestDatabaseSubmission {
  readonly bodyDigest: Uint8Array;
  readonly codexReportedDates: readonly string[];
  readonly codexVersion: string;
  readonly connectorVersion: string;
  readonly deviceId: string;
  readonly deviceKeyId: string;
  readonly nonceDigest: Uint8Array;
  readonly observedAt: string;
  readonly signature: Uint8Array;
  readonly snapshotId: string;
  readonly sourceId: string;
  readonly syncId: string;
  readonly tokens: readonly number[];
}

export type IngestDatabasePoolSignal = "idle_client_error";
export type IngestDatabasePoolSignalSink = (
  signal: IngestDatabasePoolSignal,
) => Promise<void> | void;

export interface IngestDatabaseClient {
  readDeviceVerificationMaterial(deviceId: string): Promise<unknown>;
  release(destroy?: boolean): void;
  submitCommunitySync(input: IngestDatabaseSubmission): Promise<unknown>;
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
    submitCommunitySync(input: IngestDatabaseSubmission): Promise<unknown> {
      return fixedQuery(submitCommunitySyncQuery, [
        input.deviceKeyId,
        input.deviceId,
        input.sourceId,
        input.snapshotId,
        input.syncId,
        input.observedAt,
        input.connectorVersion,
        input.codexVersion,
        Buffer.from(input.bodyDigest),
        Buffer.from(input.signature),
        Buffer.from(input.nonceDigest),
        [...input.codexReportedDates],
        input.tokens.map(String),
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
