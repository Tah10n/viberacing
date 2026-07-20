import { describe, expect, it } from "vitest";

import {
  MigrationDatabaseConfigurationError,
  resolveMigrationDatabaseConfig,
  type MigrationDatabaseConfigurationErrorCode,
} from "./database-config.js";

const privatePassword = "private-migration-password-must-not-leak";
const baseEnvironment = {
  NODE_ENV: "test",
  VIBERACING_MIGRATIONS_DATABASE_HOST: "127.0.0.1",
  VIBERACING_MIGRATIONS_DATABASE_NAME: "viberacing_migration_test",
  VIBERACING_MIGRATIONS_DATABASE_PASSWORD: privatePassword,
  VIBERACING_MIGRATIONS_DATABASE_PORT: "54329",
  VIBERACING_MIGRATIONS_DATABASE_TLS_MODE: "disable",
  VIBERACING_MIGRATIONS_DATABASE_USER: "viberacing_migration_login",
} as const;

function expectConfigurationError(
  environment: Readonly<Record<string, string | undefined>>,
  code: MigrationDatabaseConfigurationErrorCode,
): void {
  try {
    resolveMigrationDatabaseConfig(environment);
  } catch (error) {
    expect(error).toBeInstanceOf(MigrationDatabaseConfigurationError);
    expect(error).toMatchObject({
      code,
      message: "Migration database configuration is invalid.",
      name: "MigrationDatabaseConfigurationError",
    });
    expect(String(error)).not.toContain(privatePassword);
    return;
  }
  throw new Error("expected migration database configuration to fail");
}

describe("migration database configuration", () => {
  it("builds one frozen and redacted loopback client configuration", () => {
    const config = resolveMigrationDatabaseConfig(baseEnvironment);

    expect(config).toMatchObject({
      allowExitOnIdle: true,
      application_name: "viberacing-migration-runner",
      client_encoding: "UTF8",
      connectionTimeoutMillis: 2_000,
      database: "viberacing_migration_test",
      host: "127.0.0.1",
      idle_in_transaction_session_timeout: 35_000,
      idleTimeoutMillis: 1_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 5_000,
      lock_timeout: 60_000,
      max: 1,
      maxLifetimeSeconds: 600,
      maxUses: 1,
      min: 0,
      options: "-c search_path=pg_catalog,pg_temp",
      port: 54_329,
      query_timeout: 125_000,
      ssl: false,
      statement_timeout: 120_000,
      user: "viberacing_migration_login",
    });
    expect(config.password).toBe(privatePassword);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.keys(config)).not.toContain("password");
    expect(JSON.stringify(config)).toBe('{"redacted":true}');
  });

  it.each(["localhost", "migration.db.example"])(
    "requires certificate verification for a production DNS host: %s",
    (host) => {
      const config = resolveMigrationDatabaseConfig({
        ...baseEnvironment,
        NODE_ENV: "production",
        VIBERACING_MIGRATIONS_DATABASE_HOST: host,
        VIBERACING_MIGRATIONS_DATABASE_PORT: "5432",
        VIBERACING_MIGRATIONS_DATABASE_TLS_MODE: "verify-full",
      });
      expect(config.ssl).toEqual({ minVersion: "TLSv1.2", rejectUnauthorized: true });
      expect(Object.isFrozen(config.ssl)).toBe(true);
    },
  );

  it.each(["localhost", "127.0.0.1", "::1"])(
    "allows cleartext only on explicit development/test loopback: %s",
    (host) => {
      expect(
        resolveMigrationDatabaseConfig({
          ...baseEnvironment,
          VIBERACING_MIGRATIONS_DATABASE_HOST: host,
        }).ssl,
      ).toBe(false);
    },
  );

  it.each([
    [{ NODE_ENV: "production" }, "transport_insecure"],
    [{ VIBERACING_MIGRATIONS_DATABASE_HOST: "migration.db.example" }, "transport_insecure"],
    [
      {
        VIBERACING_MIGRATIONS_DATABASE_HOST: "192.0.2.10",
        VIBERACING_MIGRATIONS_DATABASE_TLS_MODE: "verify-full",
      },
      "host_invalid",
    ],
    [{ VIBERACING_MIGRATIONS_DATABASE_TLS_MODE: "prefer" }, "tls_mode_invalid"],
  ] as const)("rejects insecure or ambiguous transport: %s", (override, code) => {
    expectConfigurationError({ ...baseEnvironment, ...override }, code);
  });

  it.each([
    ["VIBERACING_MIGRATIONS_DATABASE_HOST", "host_invalid"],
    ["VIBERACING_MIGRATIONS_DATABASE_PORT", "port_invalid"],
    ["VIBERACING_MIGRATIONS_DATABASE_NAME", "database_invalid"],
    ["VIBERACING_MIGRATIONS_DATABASE_USER", "user_invalid"],
    ["VIBERACING_MIGRATIONS_DATABASE_PASSWORD", "password_invalid"],
    ["VIBERACING_MIGRATIONS_DATABASE_TLS_MODE", "tls_mode_invalid"],
  ] as const)("fails closed when %s is absent", (key, code) => {
    expectConfigurationError(
      Object.fromEntries(
        Object.entries(baseEnvironment).filter(([candidate]) => candidate !== key),
      ),
      code,
    );
  });

  it.each([
    ["VIBERACING_MIGRATIONS_DATABASE_HOST", " migration.db.example", "host_invalid"],
    ["VIBERACING_MIGRATIONS_DATABASE_HOST", `${"a".repeat(64)}.db.example`, "host_invalid"],
    ["VIBERACING_MIGRATIONS_DATABASE_PORT", "05432", "port_invalid"],
    ["VIBERACING_MIGRATIONS_DATABASE_PORT", "65536", "port_invalid"],
    ["VIBERACING_MIGRATIONS_DATABASE_NAME", "VibeRacing", "database_invalid"],
    ["VIBERACING_MIGRATIONS_DATABASE_USER", "viberacing_owner", "user_invalid"],
    ["VIBERACING_MIGRATIONS_DATABASE_USER", "migration-user", "user_invalid"],
    ["VIBERACING_MIGRATIONS_DATABASE_PASSWORD", "too-short", "password_invalid"],
    ["VIBERACING_MIGRATIONS_DATABASE_PASSWORD", ` ${privatePassword}`, "password_invalid"],
    ["VIBERACING_MIGRATIONS_DATABASE_PASSWORD", "a".repeat(1_025), "password_invalid"],
  ] as const)("rejects malformed bounded %s", (key, value, code) => {
    expectConfigurationError({ ...baseEnvironment, [key]: value }, code);
  });

  it("converts unexpected environment access failures without reflection", () => {
    const environment = new Proxy<Readonly<Record<string, string | undefined>>>(baseEnvironment, {
      get() {
        throw new Error(privatePassword);
      },
    });
    expectConfigurationError(environment, "environment_unreadable");
  });
});
