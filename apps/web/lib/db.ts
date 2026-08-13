import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { requiredEnv } from "./config";

const globalPool = globalThis as typeof globalThis & { viberacingPool?: Pool };

function createPool(): Pool {
  const useTls = process.env.VIBERACING_DATABASE_SSL === "true";
  return new Pool({
    connectionString: requiredEnv("DATABASE_URL"),
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 8_000,
    ssl: useTls ? { rejectUnauthorized: true } : undefined,
  });
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
