import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { databaseClientConfig } from "./database-config.js";

function safeToken(value, maximumLength = 96) {
  return typeof value === "string" &&
    value.length <= maximumLength &&
    /^[A-Za-z0-9_.:-]+$/.test(value)
    ? value
    : undefined;
}

function safeProperty(value, property) {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") {
    return undefined;
  }
  try {
    return Reflect.get(value, property);
  } catch {
    return undefined;
  }
}

function safeErrorType(value) {
  const name = safeToken(safeProperty(value, "name"));
  if (name !== undefined) return name;
  try {
    return value instanceof Error ? "Error" : "UnknownError";
  } catch {
    return "UnknownError";
  }
}

function log(level, event, fields = {}) {
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: "viberacing-migrate",
      event,
      ...fields,
    })}\n`,
  );
}

function safeErrorFields(error) {
  const fields = {
    errorType: safeErrorType(error),
  };
  const code = safeToken(safeProperty(error, "code"), 96);
  const severity = safeToken(safeProperty(error, "severity"), 32);
  if (code !== undefined) fields.errorCode = code;
  if (severity !== undefined) fields.errorSeverity = severity;
  return fields;
}

let appliedCount = 0;
let connected = false;
let client;
let stage = "configuration";
try {
  const connection = databaseClientConfig(process.env);
  stage = "migration_discovery";
  const directory = resolve(dirname(fileURLToPath(import.meta.url)), "../database");
  const migrations = (await readdir(directory))
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .sort((left, right) => left.localeCompare(right));
  if (migrations.length === 0) {
    throw Object.assign(new Error("No database migrations found"), {
      code: "MIGRATIONS_NOT_FOUND",
    });
  }
  client = new pg.Client({
    ...connection,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
  });
  stage = "database_connection";
  await client.connect();
  connected = true;
  stage = "migration_execution";
  log("info", "migration_started", { availableMigrations: migrations.length });
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
      appliedCount += 1;
      log("info", "migration_applied", { migrationVersion: version });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
  log("info", "migration_completed", { appliedMigrations: appliedCount });
} catch (error) {
  const event =
    stage === "configuration"
      ? "migration_configuration_failed"
      : stage === "migration_discovery"
        ? "migration_initialization_failed"
        : stage === "database_connection"
          ? "database_connection_failed"
          : "migration_failed";
  log("error", event, {
    ...safeErrorFields(error),
    appliedMigrations: appliedCount,
  });
  process.exitCode = 1;
} finally {
  if (connected && client !== undefined) {
    await client.query("SELECT pg_advisory_unlock(1447641668)").catch(() => {});
    await client.end().catch(() => {});
  }
}
