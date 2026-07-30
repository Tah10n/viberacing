import "server-only";

import { Pool } from "pg";

import type { PublicSnapshotDatabaseConfig } from "./public-snapshot-database-config";

export type PublicSnapshotDatabasePoolSignal = "idle_client_error";
export type PublicSnapshotDatabasePoolSignalSink = (
  signal: PublicSnapshotDatabasePoolSignal,
) => Promise<void> | void;

export interface PublicSnapshotDatabaseClient {
  query(text: string, values?: readonly unknown[]): Promise<unknown>;
  release(destroy?: boolean): void;
}

export interface PublicSnapshotDatabasePool {
  close(): Promise<void>;
  connect(): Promise<PublicSnapshotDatabaseClient>;
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

type NodePostgresPoolFactory = (config: PublicSnapshotDatabaseConfig) => NodePostgresPool;

function defaultPoolFactory(config: PublicSnapshotDatabaseConfig): NodePostgresPool {
  return new Pool(config);
}

function signalSafely(
  sink: PublicSnapshotDatabasePoolSignalSink | undefined,
  signal: PublicSnapshotDatabasePoolSignal,
): void {
  try {
    const result = sink?.(signal);
    if (result !== undefined) {
      void result.catch(() => undefined);
    }
  } catch {
    // Monitoring hooks must not turn an already-contained idle-client error into a process crash.
  }
}

function wrapClient(client: NodePostgresClient): PublicSnapshotDatabaseClient {
  return Object.freeze({
    async query(text: string, values: readonly unknown[] = []): Promise<unknown> {
      const result = await client.query({ text, values: [...values] });
      return result.rows;
    },
    release(destroy = false): void {
      client.release(destroy);
    },
  });
}

export function createPublicSnapshotDatabasePool(
  config: PublicSnapshotDatabaseConfig,
  signalSink?: PublicSnapshotDatabasePoolSignalSink,
  poolFactory: NodePostgresPoolFactory = defaultPoolFactory,
): PublicSnapshotDatabasePool {
  const pool = poolFactory(config);
  pool.on("error", () => {
    signalSafely(signalSink, "idle_client_error");
  });

  return Object.freeze({
    async close(): Promise<void> {
      await pool.end();
    },
    async connect(): Promise<PublicSnapshotDatabaseClient> {
      return wrapClient(await pool.connect());
    },
  });
}
