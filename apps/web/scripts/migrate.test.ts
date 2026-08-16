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

  it.each([
    [undefined, "CONFIG_VIBERACING_DATABASE_SSL_MISSING"],
    ["", "CONFIG_VIBERACING_DATABASE_SSL_MISSING"],
    ["tru", "CONFIG_DATABASE_SSL_INVALID"],
    ["TRUE", "CONFIG_DATABASE_SSL_INVALID"],
  ])("rejects TLS value %j before discovery or connection", (value, expectedCode) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: "postgresql://private:private@127.0.0.1:1/private",
    };
    if (value === undefined) delete env.VIBERACING_DATABASE_SSL;
    else env.VIBERACING_DATABASE_SSL = value;

    const result = spawnSync(process.execPath, [resolve(process.cwd(), "scripts/migrate.mjs")], {
      cwd: process.cwd(),
      encoding: "utf8",
      env,
    });

    expect(result.status).toBe(1);
    const lines = result.stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      event: "migration_configuration_failed",
      errorCode: expectedCode,
      appliedMigrations: 0,
    });
    expect(result.stdout).not.toContain("private");
  });

  it.each(["false", "true", " true "])(
    "accepts TLS value %j before attempting a connection",
    (value) => {
      const result = spawnSync(process.execPath, [resolve(process.cwd(), "scripts/migrate.mjs")], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          DATABASE_URL: "postgresql://private:private@127.0.0.1:1/private",
          VIBERACING_DATABASE_SSL: value,
        },
      });

      expect(result.status).toBe(1);
      const lines = result.stdout.trim().split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? "")).toMatchObject({
        event: "database_connection_failed",
        errorCode: "ECONNREFUSED",
        appliedMigrations: 0,
      });
      expect(result.stdout).not.toContain("private");
      expect(result.stdout).not.toContain("127.0.0.1");
    },
  );

  it.each([
    ["true", "sslmode=disable"],
    ["true", "sslmode=no-verify"],
    ["false", "ssl=true"],
    ["true", "sslcert=%2Fprivate%2Fclient.crt"],
    ["true", "sslkey=%2Fprivate%2Fclient.key"],
    ["true", "sslrootcert=%2Fprivate%2Froot.crt"],
    ["true", "sslnegotiation=direct"],
    ["true", "uselibpqcompat=true"],
  ])("rejects DATABASE_URL TLS override before connecting", (tls, query) => {
    const result = spawnSync(process.execPath, [resolve(process.cwd(), "scripts/migrate.mjs")], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: `postgresql://private:private@127.0.0.1:1/private?${query}`,
        VIBERACING_DATABASE_SSL: tls,
      },
    });

    expect(result.status).toBe(1);
    const lines = result.stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      event: "migration_configuration_failed",
      errorCode: "CONFIG_DATABASE_URL_SSL_CONFLICT",
      appliedMigrations: 0,
    });
    expect(result.stdout).not.toContain("private");
    expect(result.stdout).not.toContain("sslmode");
    expect(result.stdout).not.toContain("root.crt");
  });

  it("allows unrelated DATABASE_URL parameters before attempting a connection", () => {
    const result = spawnSync(process.execPath, [resolve(process.cwd(), "scripts/migrate.mjs")], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL:
          "postgresql://private:private@127.0.0.1:1/private?application_name=viberacing",
        VIBERACING_DATABASE_SSL: "false",
        PGSSLMODE: "require",
      },
    });

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout.trim())).toMatchObject({
      event: "database_connection_failed",
      errorCode: "ECONNREFUSED",
    });
  });
});
