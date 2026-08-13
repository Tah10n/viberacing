import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const directory = dirname(fileURLToPath(import.meta.url));
const sql = await readFile(resolve(directory, "../database/001_initial.sql"), "utf8");
const client = new pg.Client({
  connectionString,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 30_000,
  ssl: process.env.VIBERACING_DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
});
await client.connect();
try {
  await client.query(sql);
} finally {
  await client.end();
}
