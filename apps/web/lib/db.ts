import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { databaseClientConfig } from "./config";
import { logError, safeErrorFields } from "./log";

const globalPool = globalThis as typeof globalThis & { viberacingPool?: Pool };

function createPool(): Pool {
  const connection = databaseClientConfig(process.env);
  const pool = new Pool({
    ...connection,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 8_000,
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
  const result = await database().query<T>(text, [...values]);
  return result.rows;
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
