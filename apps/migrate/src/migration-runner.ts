import type { MigrationDatabasePool, MigrationDatabaseSession } from "./database-pool.js";
import type { ReviewedMigrationCatalog } from "./migration-catalog.js";

const runtimeBoundaryColumns = [
  "login_ok",
  "login_scope_ok",
  "owner_scope_ok",
  "read_write_ok",
  "search_path_ok",
  "transport_ok",
] as const;
const migrationNamePattern = /^[a-z][a-z0-9_]{2,62}$/;
const maximumMigrationBytes = 512 * 1024;

export type MigrationRunnerErrorCode =
  | "catalog_invalid"
  | "connection_release_failed"
  | "connection_unavailable"
  | "database_operation_failed"
  | "ledger_invalid"
  | "migration_failed"
  | "pool_close_failed"
  | "runtime_boundary_mismatch";

export class MigrationRunnerError extends Error {
  readonly code: MigrationRunnerErrorCode;

  constructor(code: MigrationRunnerErrorCode) {
    super("Migration runner failed.");
    this.name = "MigrationRunnerError";
    this.code = code;
  }
}

function fail(code: MigrationRunnerErrorCode): never {
  throw new MigrationRunnerError(code);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownValue(
  value: Record<string, unknown>,
  key: string,
  failureCode: MigrationRunnerErrorCode,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
    fail(failureCode);
  }
  return descriptor.value;
}

function exactBooleanRow(
  rows: unknown,
  columns: readonly string[],
  failureCode: MigrationRunnerErrorCode,
): Record<string, unknown> {
  if (!Array.isArray(rows) || rows.length !== 1) {
    fail(failureCode);
  }
  const row: unknown = rows[0];
  if (!isPlainRecord(row)) {
    fail(failureCode);
  }
  const expected = new Set(columns);
  const keys = Reflect.ownKeys(row);
  if (
    keys.length !== expected.size ||
    !keys.every((key) => typeof key === "string" && expected.has(key)) ||
    columns.some((column) => ownValue(row, column, failureCode) !== true)
  ) {
    fail(failureCode);
  }
  return row;
}

function validateCatalog(catalog: ReviewedMigrationCatalog): void {
  if (!Array.isArray(catalog) || catalog.length < 1 || catalog.length > 9_999) {
    fail("catalog_invalid");
  }
  const names = new Set<string>();
  for (const [index, migration] of catalog.entries()) {
    if (!isPlainRecord(migration)) {
      fail("catalog_invalid");
    }
    const expectedKeys = new Set(["name", "revision", "sql"]);
    const keys = Reflect.ownKeys(migration);
    if (
      keys.length !== 3 ||
      !keys.every((key) => typeof key === "string" && expectedKeys.has(key))
    ) {
      fail("catalog_invalid");
    }
    const revision = ownValue(migration, "revision", "catalog_invalid");
    const name = ownValue(migration, "name", "catalog_invalid");
    const sql = ownValue(migration, "sql", "catalog_invalid");
    if (
      revision !== index + 1 ||
      typeof name !== "string" ||
      typeof sql !== "string" ||
      !migrationNamePattern.test(name) ||
      names.has(name) ||
      sql.length < 1 ||
      Buffer.byteLength(sql, "utf8") > maximumMigrationBytes ||
      sql.startsWith("\\set")
    ) {
      fail("catalog_invalid");
    }
    names.add(name);
  }
}

function readLedgerPresence(rows: unknown): boolean {
  if (!Array.isArray(rows) || rows.length !== 1) {
    fail("ledger_invalid");
  }
  const row: unknown = rows[0];
  if (!isPlainRecord(row) || Reflect.ownKeys(row).length !== 1) {
    fail("ledger_invalid");
  }
  const value = ownValue(row, "ledger_exists", "ledger_invalid");
  if (typeof value !== "boolean") {
    fail("ledger_invalid");
  }
  return value;
}

function readLedger(
  rows: unknown,
  catalog: ReviewedMigrationCatalog,
  requireComplete: boolean,
): number {
  if (!Array.isArray(rows) || rows.length > catalog.length) {
    fail("ledger_invalid");
  }
  for (const [index, row] of rows.entries()) {
    const migration = catalog[index];
    if (
      migration === undefined ||
      !isPlainRecord(row) ||
      Reflect.ownKeys(row).length !== 2 ||
      ownValue(row, "revision", "ledger_invalid") !== migration.revision ||
      ownValue(row, "name", "ledger_invalid") !== migration.name
    ) {
      fail("ledger_invalid");
    }
  }
  if (requireComplete && rows.length !== catalog.length) {
    fail("ledger_invalid");
  }
  return rows.length;
}

async function currentLedgerLength(
  session: MigrationDatabaseSession,
  catalog: ReviewedMigrationCatalog,
  requireComplete: boolean,
): Promise<number> {
  const presenceRows = await session.readLedgerPresence();
  const exists = readLedgerPresence(presenceRows);
  if (!exists) {
    if (requireComplete) {
      fail("ledger_invalid");
    }
    return 0;
  }
  return readLedger(await session.readLedgerRows(), catalog, requireComplete);
}

function normalize(error: unknown, fallback: MigrationRunnerErrorCode): MigrationRunnerError {
  return error instanceof MigrationRunnerError ? error : new MigrationRunnerError(fallback);
}

export async function runReviewedMigrations(
  catalog: ReviewedMigrationCatalog,
  pool: MigrationDatabasePool,
): Promise<void> {
  let session: MigrationDatabaseSession | undefined;
  let failure: MigrationRunnerError | undefined;
  let destroy = true;

  try {
    validateCatalog(catalog);
    try {
      session = await pool.connect();
    } catch (error) {
      throw normalize(error, "connection_unavailable");
    }
    exactBooleanRow(
      await session.verifyRuntimeBoundary(),
      runtimeBoundaryColumns,
      "runtime_boundary_mismatch",
    );
    exactBooleanRow(await session.acquireCatalogLock(), ["locked"], "database_operation_failed");
    await session.assumeOwnerRole();
    const appliedCount = await currentLedgerLength(session, catalog, false);
    for (const migration of catalog.slice(appliedCount)) {
      try {
        await session.applyMigration(migration.sql);
      } catch (error) {
        throw normalize(error, "migration_failed");
      }
    }
    await currentLedgerLength(session, catalog, true);
    await session.resetRole();
    exactBooleanRow(await session.releaseCatalogLock(), ["unlocked"], "database_operation_failed");
    destroy = false;
  } catch (error) {
    failure = normalize(error, "database_operation_failed");
  } finally {
    if (session !== undefined) {
      try {
        session.release(destroy);
      } catch (error) {
        failure ??= normalize(error, "connection_release_failed");
      }
    }
    try {
      await pool.close();
    } catch (error) {
      failure ??= normalize(error, "pool_close_failed");
    }
  }

  if (failure !== undefined) {
    throw failure;
  }
}
