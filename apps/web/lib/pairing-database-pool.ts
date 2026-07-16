import "server-only";

import { Buffer } from "node:buffer";

import { Pool } from "pg";

import type { PairingDatabaseConfig } from "./pairing-database-config";

const runtimeBoundaryQuery = `SELECT
  CURRENT_USER = 'viberacing_web' AS role_ok,
  (
    SESSION_USER <> CURRENT_USER
    AND pg_catalog.pg_has_role(SESSION_USER, 'viberacing_web', 'SET')
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
        AND granted_role.rolname <> 'viberacing_web'
        AND pg_catalog.pg_has_role(SESSION_USER, granted_role.oid, 'MEMBER')
    )
  ) AS login_scope_ok,
  pg_catalog.current_setting('search_path') = 'pg_catalog,pg_temp' AS search_path_ok,
  pg_catalog.current_setting('default_transaction_read_only') = 'off' AS read_write_ok`;

const verificationMaterialQuery = `SELECT
  candidate.candidate_index,
  material.pairing_id::text AS pairing_id,
  material.pairing_challenge AS pairing_challenge,
  material.public_key AS public_key
FROM (
  VALUES
    (1, $1::bytea),
    (2, $2::bytea)
) AS candidate(candidate_index, poll_verifier_digest)
CROSS JOIN LATERAL viberacing_api.read_pairing_verification_material(
  candidate.poll_verifier_digest
) AS material
ORDER BY candidate.candidate_index`;

const activatePairingQuery = `WITH activation AS MATERIALIZED (
  SELECT viberacing_api.activate_pairing(
    $1::bytea,
    $2::uuid,
    $3::text,
    $4::uuid,
    $5::text
  ) AS ignored
)
SELECT pg_catalog.count(*) = 1 AS activated
FROM activation`;

export interface PairingDatabaseActivation {
  readonly auditEventId: string;
  readonly deviceId: string;
  readonly pairingId: string;
  readonly pollVerifierDigest: Uint8Array;
  readonly requestId: string;
}

export type PairingDatabasePoolSignal = "idle_client_error";
export type PairingDatabasePoolSignalSink = (
  signal: PairingDatabasePoolSignal,
) => Promise<void> | void;

export interface PairingDatabaseClient {
  activatePairing(input: PairingDatabaseActivation): Promise<unknown>;
  readVerificationMaterial(
    pollVerifierDigests: readonly [Uint8Array, Uint8Array],
  ): Promise<unknown>;
  release(destroy?: boolean): void;
  verifyRuntimeBoundary(): Promise<unknown>;
}

export interface PairingDatabasePool {
  close(): Promise<void>;
  connect(): Promise<PairingDatabaseClient>;
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

type NodePostgresPoolFactory = (config: PairingDatabaseConfig) => NodePostgresPool;

function defaultPoolFactory(config: PairingDatabaseConfig): NodePostgresPool {
  return new Pool(config);
}

function signalSafely(
  sink: PairingDatabasePoolSignalSink | undefined,
  signal: PairingDatabasePoolSignal,
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

function wrapClient(client: NodePostgresClient): PairingDatabaseClient {
  async function fixedQuery(text: string, values: readonly unknown[] = []): Promise<unknown> {
    const result = await client.query({ text, values: [...values] });
    return result.rows;
  }

  return Object.freeze({
    async activatePairing(input: PairingDatabaseActivation): Promise<unknown> {
      const digest = Buffer.from(input.pollVerifierDigest);
      try {
        return await fixedQuery(activatePairingQuery, [
          digest,
          input.pairingId,
          input.deviceId,
          input.auditEventId,
          input.requestId,
        ]);
      } finally {
        digest.fill(0);
      }
    },
    async readVerificationMaterial(
      pollVerifierDigests: readonly [Uint8Array, Uint8Array],
    ): Promise<unknown> {
      const first = Buffer.from(pollVerifierDigests[0]);
      const second = Buffer.from(pollVerifierDigests[1]);
      try {
        return await fixedQuery(verificationMaterialQuery, [first, second]);
      } finally {
        first.fill(0);
        second.fill(0);
      }
    },
    release(destroy = false): void {
      client.release(destroy);
    },
    verifyRuntimeBoundary(): Promise<unknown> {
      return fixedQuery(runtimeBoundaryQuery);
    },
  });
}

export function createPairingDatabasePool(
  config: PairingDatabaseConfig,
  signalSink?: PairingDatabasePoolSignalSink,
  poolFactory: NodePostgresPoolFactory = defaultPoolFactory,
): PairingDatabasePool {
  const pool = poolFactory(config);
  pool.on("error", () => {
    signalSafely(signalSink, "idle_client_error");
  });

  return Object.freeze({
    async close(): Promise<void> {
      await pool.end();
    },
    async connect(): Promise<PairingDatabaseClient> {
      return wrapClient(await pool.connect());
    },
  });
}
