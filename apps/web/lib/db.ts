import type { AsyncLocalStorage } from "node:async_hooks";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { databaseClientConfig } from "./config";
import { logError, safeErrorFields } from "./log";
import { ConcurrencyLimit, ResourceOverloaded, isResourceOverloaded } from "./overload";

import { metric } from "./metrics";

const shared = globalThis as typeof globalThis & {
  viberacingDatabaseWork?: ConcurrencyLimit;
  viberacingPublicResponse?: AsyncLocalStorage<{ overloaded: boolean }>;
};
const databaseWork = (shared.viberacingDatabaseWork ??= new ConcurrencyLimit(10, 32, 1000));

function markOverload(): void {
  const response = shared.viberacingPublicResponse?.getStore();
  if (response) response.overloaded = true;
  metric("overloaded");
}

function databaseFailure(error: unknown): never {
  if (isResourceOverloaded(error)) {
    markOverload();
    throw error;
  }
  const code = (error as { code?: unknown } | null)?.code;
  if (
    error instanceof Error &&
    [
      "Connection terminated due to connection timeout",
      "timeout exceeded when trying to connect",
    ].includes(error.message)
  ) {
    markOverload();
    throw new ResourceOverloaded(error);
  }
  if (
    [
      "54000",
      "55P03",
      "57014",
      "57P01",
      "57P02",
      "57P03",
      "53300",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "ECONNRESET",
    ].includes(String(code))
  ) {
    markOverload();
    throw new ResourceOverloaded(error);
  }
  throw error;
}

const globalPool = globalThis as typeof globalThis & { viberacingPool?: Pool };

function createPool(): Pool {
  const connection = databaseClientConfig(process.env);
  const pool = new Pool({
    ...connection,
    max: 10,
    connectionTimeoutMillis: 1_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 8_000,
    lock_timeout: 1_000,
    idle_in_transaction_session_timeout: 10_000,
  });
  pool.on("error", (error) => {
    logError("database_pool_error", safeErrorFields(error));
  });
  return pool;
}

export function database(): Pool {
  globalPool.viberacingPool ??= createPool();
  return globalPool.viberacingPool;
}

export async function query<T extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  return databaseWork
    .run(async () => {
      const started = performance.now();
      metric("dbOperations");
      metric("dbWaiting", database().waitingCount, true);
      try {
        const result = await database().query<T>(text, [...values]);
        return result.rows;
      } finally {
        metric("dbDurationMs", performance.now() - started);
      }
    })
    .catch(databaseFailure);
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  return databaseWork.run(() => runTransaction(work)).catch(databaseFailure);
}

async function runTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const started = performance.now();
  metric("dbOperations");
  metric("dbWaiting", database().waitingCount, true);
  const client = await database().connect();
  let discard = false;
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // A lost connection cannot roll back. Preserve the original error for
      // overload classification and discard the unusable pool client.
      discard = true;
    }
    throw error;
  } finally {
    metric("dbDurationMs", performance.now() - started);
    client.release(discard);
  }
}
