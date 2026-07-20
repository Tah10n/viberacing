import { describe, expect, it, vi } from "vitest";

import type { MigrationDatabasePool, MigrationDatabaseSession } from "./database-pool.js";
import type { ReviewedMigrationCatalog } from "./migration-catalog.js";
import {
  MigrationRunnerError,
  runReviewedMigrations,
  type MigrationRunnerErrorCode,
} from "./migration-runner.js";

const catalog: ReviewedMigrationCatalog = Object.freeze([
  Object.freeze({ name: "first_migration", revision: 1, sql: "BEGIN; SELECT 1; COMMIT;" }),
  Object.freeze({ name: "second_migration", revision: 2, sql: "BEGIN; SELECT 2; COMMIT;" }),
]);
const boundaryRows = [
  {
    login_ok: true,
    login_scope_ok: true,
    owner_scope_ok: true,
    read_write_ok: true,
    search_path_ok: true,
    transport_ok: true,
  },
];
const completeLedger = [
  { name: "first_migration", revision: 1 },
  { name: "second_migration", revision: 2 },
];
const invalidCatalogs: readonly unknown[] = [
  [],
  null,
  {},
  [null],
  [{ name: "wrong", revision: 2, sql: "SELECT 1" }],
  [{ name: "x", revision: 1, sql: "SELECT 1" }],
  [{ extra: true, name: "wrong", revision: 1, sql: "SELECT 1" }],
  [{ name: "wrong", revision: 1, sql: "" }],
  [{ name: "wrong", revision: 1, sql: "x".repeat(512 * 1024 + 1) }],
  [{ name: "wrong", revision: 1, sql: "\\set ON_ERROR_STOP on\nSELECT 1" }],
  [
    { name: "duplicate_name", revision: 1, sql: "SELECT 1" },
    { name: "duplicate_name", revision: 2, sql: "SELECT 2" },
  ],
];

function createSession(
  overrides: Partial<MigrationDatabaseSession> = {},
): MigrationDatabaseSession {
  return {
    acquireCatalogLock: vi.fn(async () => [{ locked: true }]),
    applyMigration: vi.fn(async () => undefined),
    assumeOwnerRole: vi.fn(async () => undefined),
    readLedgerPresence: vi
      .fn()
      .mockResolvedValueOnce([{ ledger_exists: false }])
      .mockResolvedValueOnce([{ ledger_exists: true }]),
    readLedgerRows: vi.fn(async () => completeLedger),
    release: vi.fn(),
    releaseCatalogLock: vi.fn(async () => [{ unlocked: true }]),
    resetRole: vi.fn(async () => undefined),
    verifyRuntimeBoundary: vi.fn(async () => boundaryRows),
    ...overrides,
  };
}

function createPool(
  session: MigrationDatabaseSession,
  overrides: Partial<MigrationDatabasePool> = {},
): MigrationDatabasePool {
  return {
    close: vi.fn(async () => undefined),
    connect: vi.fn(async () => session),
    ...overrides,
  };
}

async function expectRunnerError(
  promise: Promise<void>,
  code: MigrationRunnerErrorCode,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    code,
    message: "Migration runner failed.",
    name: "MigrationRunnerError",
  });
}

describe("reviewed migration runner", () => {
  it("applies every missing migration under one session lock and verifies the final ledger", async () => {
    const session = createSession();
    const pool = createPool(session);
    await runReviewedMigrations(catalog, pool);

    expect(session.applyMigration).toHaveBeenNthCalledWith(1, catalog[0]?.sql);
    expect(session.applyMigration).toHaveBeenNthCalledWith(2, catalog[1]?.sql);
    expect(session.resetRole).toHaveBeenCalledOnce();
    expect(session.releaseCatalogLock).toHaveBeenCalledOnce();
    expect(session.release).toHaveBeenCalledWith(false);
    expect(pool.close).toHaveBeenCalledOnce();
  });

  it("rechecks a valid prefix and applies only the remaining reviewed migration", async () => {
    const session = createSession({
      readLedgerPresence: vi.fn(async () => [{ ledger_exists: true }]),
      readLedgerRows: vi
        .fn()
        .mockResolvedValueOnce([{ name: "first_migration", revision: 1 }])
        .mockResolvedValueOnce(completeLedger),
    });
    await runReviewedMigrations(catalog, createPool(session));
    expect(session.applyMigration).toHaveBeenCalledOnce();
    expect(session.applyMigration).toHaveBeenCalledWith(catalog[1]?.sql);
  });

  it("treats an already complete exact ledger as a successful no-op", async () => {
    const session = createSession({
      readLedgerPresence: vi.fn(async () => [{ ledger_exists: true }]),
      readLedgerRows: vi.fn(async () => completeLedger),
    });
    await runReviewedMigrations(catalog, createPool(session));
    expect(session.applyMigration).not.toHaveBeenCalled();
  });

  it.each(invalidCatalogs.map((value) => [value] as const))(
    "rejects an invalid injected catalog before connecting: %#",
    async (value) => {
      const session = createSession();
      const pool = createPool(session);
      await expectRunnerError(
        runReviewedMigrations(value as ReviewedMigrationCatalog, pool),
        "catalog_invalid",
      );
      expect(pool.connect).not.toHaveBeenCalled();
      expect(pool.close).toHaveBeenCalledOnce();
    },
  );

  it("rejects widened or malformed runtime boundary rows and destroys the client", async () => {
    const accessorRow = Object.fromEntries(
      Object.keys(boundaryRows[0] ?? {}).map((key) => [key, true]),
    );
    Object.defineProperty(accessorRow, "login_ok", {
      enumerable: true,
      get: () => true,
    });
    for (const rows of [
      [{ ...boundaryRows[0], login_scope_ok: false }],
      [{ ...boundaryRows[0], extra: true }],
      [],
      null,
      [null],
      [accessorRow],
    ]) {
      const session = createSession({ verifyRuntimeBoundary: vi.fn(async () => rows) });
      await expectRunnerError(
        runReviewedMigrations(catalog, createPool(session)),
        "runtime_boundary_mismatch",
      );
      expect(session.release).toHaveBeenCalledWith(true);
    }
  });

  it.each([
    [[{ ledger_exists: true }], [{ name: "wrong", revision: 1 }]],
    [[{ ledger_exists: true }], [{ name: "first_migration", revision: 2 }]],
    [[{ ledger_exists: true }], [...completeLedger, { name: "third", revision: 3 }]],
    [[{ ledger_exists: "true" }], []],
    [[], []],
    [[{ extra: true, ledger_exists: true }], []],
  ])("rejects a non-prefix or malformed migration ledger: %#", async (presence, rows) => {
    const session = createSession({
      readLedgerPresence: vi.fn(async () => presence),
      readLedgerRows: vi.fn(async () => rows),
    });
    await expectRunnerError(runReviewedMigrations(catalog, createPool(session)), "ledger_invalid");
    expect(session.release).toHaveBeenCalledWith(true);
  });

  it("fails closed when a reviewed migration query fails", async () => {
    const session = createSession({
      applyMigration: vi.fn(async () => {
        throw new Error("private database error");
      }),
    });
    await expectRunnerError(
      runReviewedMigrations(catalog, createPool(session)),
      "migration_failed",
    );
    expect(session.release).toHaveBeenCalledWith(true);
    expect(session.resetRole).not.toHaveBeenCalled();
  });

  it("requires the complete final ledger after applying migrations", async () => {
    const session = createSession({
      readLedgerRows: vi.fn(async () => [{ name: "first_migration", revision: 1 }]),
    });
    await expectRunnerError(runReviewedMigrations(catalog, createPool(session)), "ledger_invalid");
  });

  it("requires the ledger table to exist after migration application", async () => {
    const session = createSession({
      readLedgerPresence: vi.fn(async () => [{ ledger_exists: false }]),
    });
    await expectRunnerError(runReviewedMigrations(catalog, createPool(session)), "ledger_invalid");
  });

  it.each([
    ["acquireCatalogLock", async () => [{ locked: false }]],
    ["assumeOwnerRole", async () => Promise.reject(new Error("private"))],
    ["readLedgerPresence", async () => Promise.reject(new Error("private"))],
    ["resetRole", async () => Promise.reject(new Error("private"))],
    ["releaseCatalogLock", async () => [{ unlocked: false }]],
  ] as const)("maps %s failures to a closed database error", async (method, implementation) => {
    const session = createSession({ [method]: vi.fn(implementation) });
    await expectRunnerError(
      runReviewedMigrations(catalog, createPool(session)),
      "database_operation_failed",
    );
    expect(session.release).toHaveBeenCalledWith(true);
  });

  it("maps connection, release, and pool-close failures without reflection", async () => {
    const unavailablePool = createPool(createSession(), {
      connect: vi.fn(async () => Promise.reject(new Error("private connection"))),
    });
    await expectRunnerError(
      runReviewedMigrations(catalog, unavailablePool),
      "connection_unavailable",
    );

    const releaseSession = createSession({
      release: vi.fn(() => {
        throw new Error("private release");
      }),
    });
    await expectRunnerError(
      runReviewedMigrations(catalog, createPool(releaseSession)),
      "connection_release_failed",
    );

    const closeSession = createSession();
    await expectRunnerError(
      runReviewedMigrations(
        catalog,
        createPool(closeSession, {
          close: vi.fn(async () => Promise.reject(new Error("private close"))),
        }),
      ),
      "pool_close_failed",
    );
  });

  it("preserves the primary failure when cleanup also fails", async () => {
    const session = createSession({
      applyMigration: vi.fn(async () => Promise.reject(new Error("private migration"))),
      release: vi.fn(() => {
        throw new Error("private release");
      }),
    });
    const pool = createPool(session, {
      close: vi.fn(async () => Promise.reject(new Error("private close"))),
    });
    await expectRunnerError(runReviewedMigrations(catalog, pool), "migration_failed");
  });

  it("uses one stable public error class", () => {
    expect(new MigrationRunnerError("ledger_invalid")).toMatchObject({
      message: "Migration runner failed.",
      name: "MigrationRunnerError",
    });
  });
});
