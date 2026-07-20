import { describe, expect, it, vi } from "vitest";

import type { MigrationDatabaseConfig } from "./database-config.js";
import type { MigrationDatabasePool } from "./database-pool.js";
import type { ReviewedMigrationCatalog } from "./migration-catalog.js";
import {
  createDefaultMigrationCommandDependencies,
  runMigrationCommand,
  type MigrationCommandDependencies,
} from "./command.js";

const privateValue = "private-migration-value-must-not-leak";
const catalog = Object.freeze([
  Object.freeze({ name: "first_migration", revision: 1, sql: "BEGIN; COMMIT;" }),
]) as ReviewedMigrationCatalog;
const config = Object.freeze({ redacted: true }) as unknown as MigrationDatabaseConfig;
const pool = Object.freeze({}) as MigrationDatabasePool;

function createDependencies(
  overrides: Partial<MigrationCommandDependencies> = {},
): MigrationCommandDependencies & {
  readonly errors: string[];
  readonly output: string[];
} {
  const errors: string[] = [];
  const output: string[] = [];
  return {
    createPool: vi.fn(() => pool),
    environment: { VIBERACING_MIGRATIONS_ENABLED: "true" },
    errors,
    loadCatalog: vi.fn(() => catalog),
    output,
    resolveConfig: vi.fn(() => config),
    runMigrations: vi.fn(async () => undefined),
    writeError: vi.fn((text: string) => errors.push(text)),
    writeOutput: vi.fn((text: string) => output.push(text)),
    ...overrides,
  };
}

describe("migration command", () => {
  it("creates the real frozen dependency composition with process writers", () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const dependencies = createDefaultMigrationCommandDependencies();
    dependencies.writeOutput("bounded output");
    dependencies.writeError("bounded error");
    expect(stdout).toHaveBeenCalledWith("bounded output");
    expect(stderr).toHaveBeenCalledWith("bounded error");
    expect(Object.isFrozen(dependencies)).toBe(true);
  });

  it.each([undefined, "", "TRUE", "1", " true"])(
    "fails before catalog, protected configuration, or resources when enablement is %s",
    async (value) => {
      const dependencies = createDependencies({
        environment: value === undefined ? {} : { VIBERACING_MIGRATIONS_ENABLED: value },
      });
      await expect(runMigrationCommand([], dependencies)).resolves.toBe(1);
      expect(dependencies.errors).toEqual(["Vibe Racing migrations are disabled.\n"]);
      expect(dependencies.loadCatalog).not.toHaveBeenCalled();
      expect(dependencies.resolveConfig).not.toHaveBeenCalled();
      expect(dependencies.createPool).not.toHaveBeenCalled();
    },
  );

  it("fails closed when enablement cannot be read", async () => {
    const environment = new Proxy<Readonly<Record<string, string | undefined>>>(
      {},
      {
        get() {
          throw new Error(privateValue);
        },
      },
    );
    const dependencies = createDependencies({ environment });
    await expect(runMigrationCommand([], dependencies)).resolves.toBe(1);
    expect(dependencies.errors.join("")).not.toContain(privateValue);
    expect(dependencies.loadCatalog).not.toHaveBeenCalled();
  });

  it("rejects every argument before catalog or protected configuration", async () => {
    const dependencies = createDependencies();
    await expect(runMigrationCommand(["--force"], dependencies)).resolves.toBe(1);
    expect(dependencies.errors).toEqual(["Vibe Racing migrations failed.\n"]);
    expect(dependencies.loadCatalog).not.toHaveBeenCalled();
    expect(dependencies.resolveConfig).not.toHaveBeenCalled();
  });

  it("runs one exact catalog/pool composition and emits one generic success", async () => {
    const order: string[] = [];
    const dependencies = createDependencies({
      createPool: vi.fn(() => {
        order.push("pool");
        return pool;
      }),
      loadCatalog: vi.fn(() => {
        order.push("catalog");
        return catalog;
      }),
      resolveConfig: vi.fn(() => {
        order.push("config");
        return config;
      }),
      runMigrations: vi.fn(async (receivedCatalog, receivedPool) => {
        order.push("run");
        expect(receivedCatalog).toBe(catalog);
        expect(receivedPool).toBe(pool);
      }),
    });
    await expect(runMigrationCommand([], dependencies)).resolves.toBe(0);
    expect(order).toEqual(["catalog", "config", "pool", "run"]);
    expect(dependencies.output).toEqual(["Vibe Racing migrations completed.\n"]);
    expect(dependencies.errors).toEqual([]);
  });

  it.each(["loadCatalog", "resolveConfig", "createPool", "runMigrations"] as const)(
    "maps a %s failure to one non-reflective result",
    async (dependency) => {
      const dependencies = createDependencies({
        [dependency]: vi.fn(() => {
          throw new Error(privateValue);
        }),
      });
      await expect(runMigrationCommand([], dependencies)).resolves.toBe(1);
      expect(dependencies.output).toEqual([]);
      expect(dependencies.errors).toEqual(["Vibe Racing migrations failed.\n"]);
      expect(dependencies.errors.join("")).not.toContain(privateValue);
    },
  );

  it("turns an unavailable success stream into a generic failure", async () => {
    const dependencies = createDependencies({
      writeOutput: vi.fn(() => {
        throw new Error(privateValue);
      }),
    });
    await expect(runMigrationCommand([], dependencies)).resolves.toBe(1);
    expect(dependencies.errors).toEqual(["Vibe Racing migrations failed.\n"]);
  });

  it("retains the nonzero result if the error stream is unavailable", async () => {
    const dependencies = createDependencies({
      writeError: vi.fn(() => {
        throw new Error(privateValue);
      }),
    });
    await expect(runMigrationCommand(["unexpected"], dependencies)).resolves.toBe(1);
  });
});
