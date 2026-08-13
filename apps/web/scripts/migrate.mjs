import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const directory = resolve(dirname(fileURLToPath(import.meta.url)), "../database");
const migrations = (await readdir(directory))
  .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
  .sort((left, right) => left.localeCompare(right));
if (migrations.length === 0) throw new Error("No database migrations found");

const client = new pg.Client({
  connectionString,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 30_000,
  ssl: process.env.VIBERACING_DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
});
await client.connect();
try {
  await client.query("SELECT pg_advisory_lock(1447641668)");
  const ledger = await client.query("SELECT to_regclass('public.schema_migrations') AS name");
  const applied = new Set();
  if (ledger.rows[0]?.name) {
    const rows = await client.query("SELECT version FROM schema_migrations");
    for (const row of rows.rows) applied.add(row.version);
  }
  for (const version of migrations) {
    if (applied.has(version)) continue;
    const sql = await readFile(resolve(directory, version), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
      await client.query("COMMIT");
      process.stdout.write(`Applied ${version}\n`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(1447641668)").catch(() => {});
  await client.end();
}
