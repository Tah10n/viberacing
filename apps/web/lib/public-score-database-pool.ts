import "server-only";

import { Pool } from "pg";

import type { PublicScoreDatabaseConfig } from "./public-score-database-config";

export type PublicScoreDatabasePoolSignal = "idle_client_error";
export type PublicScoreDatabasePoolSignalSink = (
  signal: PublicScoreDatabasePoolSignal,
) => Promise<void> | void;

export interface PublicScoreDatabaseClient {
  query(text: string, values?: readonly unknown[]): Promise<unknown>;
  release(destroy?: boolean): void;
}

export interface PublicScoreDatabasePool {
  close(): Promise<void>;
  connect(): Promise<PublicScoreDatabaseClient>;
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

type NodePostgresPoolFactory = (config: PublicScoreDatabaseConfig) => NodePostgresPool;

function defaultPoolFactory(config: PublicScoreDatabaseConfig): NodePostgresPool {
  return new Pool(config);
}

function signalSafely(
  sink: PublicScoreDatabasePoolSignalSink | undefined,
  signal: PublicScoreDatabasePoolSignal,
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

function wrapClient(client: NodePostgresClient): PublicScoreDatabaseClient {
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

export function createPublicScoreDatabasePool(
  config: PublicScoreDatabaseConfig,
  signalSink?: PublicScoreDatabasePoolSignalSink,
  poolFactory: NodePostgresPoolFactory = defaultPoolFactory,
): PublicScoreDatabasePool {
  const pool = poolFactory(config);
  pool.on("error", () => {
    signalSafely(signalSink, "idle_client_error");
  });

  return Object.freeze({
    async close(): Promise<void> {
      await pool.end();
    },
    async connect(): Promise<PublicScoreDatabaseClient> {
      return wrapClient(await pool.connect());
    },
  });
}
