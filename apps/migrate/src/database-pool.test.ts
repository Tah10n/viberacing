import { describe, expect, it, vi } from "vitest";

import { resolveMigrationDatabaseConfig } from "./database-config.js";
import { createMigrationDatabasePool } from "./database-pool.js";

const config = resolveMigrationDatabaseConfig({
  NODE_ENV: "test",
  VIBERACING_MIGRATIONS_DATABASE_HOST: "127.0.0.1",
  VIBERACING_MIGRATIONS_DATABASE_NAME: "viberacing_migration_test",
  VIBERACING_MIGRATIONS_DATABASE_PASSWORD: "private-migration-password",
  VIBERACING_MIGRATIONS_DATABASE_PORT: "54329",
  VIBERACING_MIGRATIONS_DATABASE_TLS_MODE: "disable",
  VIBERACING_MIGRATIONS_DATABASE_USER: "viberacing_migration_login",
});

function readQueryText(request: unknown): string {
  if (request === null || typeof request !== "object" || !("text" in request)) {
    throw new Error("expected a fixed query object");
  }
  const { text } = request;
  if (typeof text !== "string") {
    throw new Error("expected fixed query text");
  }
  return text;
}

describe("migration PostgreSQL pool", () => {
  it("constructs and closes the real lazy pool without opening a connection", async () => {
    const pool = createMigrationDatabasePool(config);
    await expect(pool.close()).resolves.toBeUndefined();
  });

  it("maps only the fixed boundary, lock, ledger, role, and reviewed SQL operations", async () => {
    const query = vi.fn(async (request: unknown) => ({ rows: [{ ok: true }], request }));
    const release = vi.fn();
    const client = { query, release };
    const end = vi.fn(async () => undefined);
    const on = vi.fn();
    const connect = vi.fn(async () => client);
    const poolFactory = vi.fn(() => ({ connect, end, on }));
    const pool = createMigrationDatabasePool(config, undefined, poolFactory);
    const session = await pool.connect();

    await session.verifyRuntimeBoundary();
    await session.acquireCatalogLock();
    await session.assumeOwnerRole();
    await session.readLedgerPresence();
    await session.readLedgerRows();
    await session.applyMigration("BEGIN; SELECT 1; COMMIT;");
    await session.resetRole();
    await session.releaseCatalogLock();
    session.release(true);
    await pool.close();

    expect(poolFactory).toHaveBeenCalledWith(config);
    expect(on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(query).toHaveBeenCalledTimes(8);
    expect(query.mock.calls[0]?.[0]).toMatchObject({
      values: ["viberacing_migration_login", false],
    });
    const boundaryQueryText = readQueryText(query.mock.calls[0]?.[0]);
    expect(boundaryQueryText).toContain("NOT membership.admin_option");
    expect(boundaryQueryText).toContain("NOT membership.inherit_option");
    expect(boundaryQueryText).toContain("membership.set_option");
    expect(boundaryQueryText).toContain("NOT login_role.rolinherit");
    expect(boundaryQueryText).toContain("NOT owner_role.rolinherit");
    expect(boundaryQueryText).toContain("owner_membership.member = owner_role.oid");
    expect(query.mock.calls[1]?.[0]).toMatchObject({ values: [824_762_001] });
    expect(query.mock.calls[2]?.[0]).toMatchObject({
      text: "SET ROLE viberacing_owner",
      values: [],
    });
    expect(query.mock.calls[3]?.[0]).toMatchObject({ values: [] });
    expect(query.mock.calls[4]?.[0]).toMatchObject({ values: [] });
    expect(query.mock.calls[5]?.[0]).toBe("BEGIN; SELECT 1; COMMIT;");
    expect(query.mock.calls[6]?.[0]).toMatchObject({ text: "RESET ROLE", values: [] });
    expect(query.mock.calls[7]?.[0]).toMatchObject({ values: [824_762_001] });
    expect(release).toHaveBeenCalledWith(true);
    expect(end).toHaveBeenCalledOnce();
  });

  it("contains synchronous and rejected asynchronous idle-client signal sinks", async () => {
    const on = vi.fn();
    const poolFactory = vi.fn(() => ({
      connect: vi.fn(),
      end: vi.fn(async () => undefined),
      on,
    }));
    const throwingSink = vi.fn(() => {
      throw new Error("private signal failure");
    });
    createMigrationDatabasePool(config, throwingSink, poolFactory);
    const firstListener = on.mock.calls[0]?.[1] as ((error: Error) => void) | undefined;
    expect(() => firstListener?.(new Error("private pool error"))).not.toThrow();

    const rejectedSink = vi.fn(async () => {
      throw new Error("private async signal failure");
    });
    createMigrationDatabasePool(config, rejectedSink, poolFactory);
    const secondListener = on.mock.calls[1]?.[1] as ((error: Error) => void) | undefined;
    expect(() => secondListener?.(new Error("private pool error"))).not.toThrow();
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
    expect(throwingSink).toHaveBeenCalledWith("idle_client_error");
    expect(rejectedSink).toHaveBeenCalledWith("idle_client_error");
  });
});
