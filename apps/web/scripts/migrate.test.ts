import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("migration diagnostics", () => {
  it("reports missing configuration as one sanitized JSON record", () => {
    const result = spawnSync(process.execPath, [resolve(process.cwd(), "scripts/migrate.mjs")], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: "" },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    const lines = result.stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(record).toMatchObject({
      level: "error",
      service: "viberacing-migrate",
      event: "migration_configuration_failed",
      errorType: "Error",
      errorCode: "CONFIG_DATABASE_URL_MISSING",
      appliedMigrations: 0,
    });
    expect(result.stdout).not.toContain("migrate.mjs:");
    expect(result.stdout).not.toContain("Node.js v");
  });
});
