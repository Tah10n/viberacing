import { describe, expect, it, vi } from "vitest";

import { AdminDatabaseConfigurationError, resolveAdminDatabaseConfig } from "./database-config.js";

const privatePassword = "private-admin-test-password";
const baseEnvironment = Object.freeze({
  NODE_ENV: "test",
  VIBERACING_ADMIN_DATABASE_HOST: "127.0.0.1",
  VIBERACING_ADMIN_DATABASE_NAME: "viberacing_local",
  VIBERACING_ADMIN_DATABASE_PASSWORD: privatePassword,
  VIBERACING_ADMIN_DATABASE_PORT: "54329",
  VIBERACING_ADMIN_DATABASE_TLS_MODE: "disable",
  VIBERACING_ADMIN_DATABASE_USER: "viberacing_admin_login",
});

function expectConfigurationError(
  environment: Readonly<Record<string, string | undefined>>,
  code: AdminDatabaseConfigurationError["code"],
): void {
  try {
    resolveAdminDatabaseConfig(environment);
    throw new Error("Expected configuration rejection.");
  } catch (error) {
    expect(error).toBeInstanceOf(AdminDatabaseConfigurationError);
    expect(error).toMatchObject({ code, message: "Admin database configuration is invalid." });
    expect(String(error)).not.toContain(privatePassword);
  }
}

describe("Admin database configuration", () => {
  it("builds a frozen, redacted, single-client loopback configuration", () => {
    const config = resolveAdminDatabaseConfig(baseEnvironment);

    expect(config).toMatchObject({
      allowExitOnIdle: true,
      application_name: "viberacing-admin-invite-issuance",
      client_encoding: "UTF8",
      connectionTimeoutMillis: 2_000,
      database: "viberacing_local",
      host: "127.0.0.1",
      idle_in_transaction_session_timeout: 2_000,
      idleTimeoutMillis: 1_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 5_000,
      lock_timeout: 1_000,
      max: 1,
      maxLifetimeSeconds: 300,
      maxUses: 25,
      min: 0,
      options: "-c search_path=pg_catalog,pg_temp",
      port: 54_329,
      query_timeout: 6_000,
      ssl: false,
      statement_timeout: 5_000,
      user: "viberacing_admin_login",
    });
    expect(config.password).toBe(privatePassword);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.keys(config)).not.toContain("password");
    expect(Object.prototype.propertyIsEnumerable.call(config, "password")).toBe(false);
    expect(JSON.stringify(config)).toBe('{"redacted":true}');
  });

  it("requires verified TLS and a DNS hostname outside local development", () => {
    const config = resolveAdminDatabaseConfig({
      ...baseEnvironment,
      NODE_ENV: "production",
      VIBERACING_ADMIN_DATABASE_HOST: "admin.db.example",
      VIBERACING_ADMIN_DATABASE_PORT: "5432",
      VIBERACING_ADMIN_DATABASE_TLS_MODE: "verify-full",
    });

    expect(config.ssl).toEqual({ minVersion: "TLSv1.2", rejectUnauthorized: true });
    expect(Object.isFrozen(config.ssl)).toBe(true);
  });

  it.each(["localhost", "127.0.0.1", "::1"])(
    "allows explicit cleartext only on a local development or test loopback: %s",
    (host) => {
      expect(
        resolveAdminDatabaseConfig({
          ...baseEnvironment,
          NODE_ENV: "development",
          VIBERACING_ADMIN_DATABASE_HOST: host,
        }).ssl,
      ).toBe(false);
    },
  );

  it("accepts test loopback and rejects missing environment classification", () => {
    expect(resolveAdminDatabaseConfig(baseEnvironment).ssl).toBe(false);
    const environment = Object.fromEntries(
      Object.entries(baseEnvironment).filter(([key]) => key !== "NODE_ENV"),
    );
    expectConfigurationError(environment, "transport_insecure");
  });

  it.each([
    [{ NODE_ENV: "production" }, "transport_insecure"],
    [{ NODE_ENV: "staging" }, "transport_insecure"],
    [{ VIBERACING_ADMIN_DATABASE_HOST: "admin.db.example" }, "transport_insecure"],
    [
      {
        VIBERACING_ADMIN_DATABASE_HOST: "192.0.2.10",
        VIBERACING_ADMIN_DATABASE_TLS_MODE: "verify-full",
      },
      "host_invalid",
    ],
    [
      {
        VIBERACING_ADMIN_DATABASE_HOST: "database",
        VIBERACING_ADMIN_DATABASE_TLS_MODE: "verify-full",
      },
      "host_invalid",
    ],
    [{ VIBERACING_ADMIN_DATABASE_TLS_MODE: "prefer" }, "tls_mode_invalid"],
  ] as const)("rejects insecure or ambiguous transport configuration", (override, code) => {
    expectConfigurationError({ ...baseEnvironment, ...override }, code);
  });

  it.each([
    ["VIBERACING_ADMIN_DATABASE_HOST", "host_invalid"],
    ["VIBERACING_ADMIN_DATABASE_PORT", "port_invalid"],
    ["VIBERACING_ADMIN_DATABASE_NAME", "database_invalid"],
    ["VIBERACING_ADMIN_DATABASE_USER", "user_invalid"],
    ["VIBERACING_ADMIN_DATABASE_PASSWORD", "password_invalid"],
    ["VIBERACING_ADMIN_DATABASE_TLS_MODE", "tls_mode_invalid"],
  ] as const)("fails closed when %s is absent", (key, code) => {
    const environment = Object.fromEntries(
      Object.entries(baseEnvironment).filter(([candidate]) => candidate !== key),
    );
    expectConfigurationError(environment, code);
  });

  it.each([
    ["VIBERACING_ADMIN_DATABASE_HOST", " admin.db.example", "host_invalid"],
    ["VIBERACING_ADMIN_DATABASE_HOST", `${"a".repeat(64)}.db.example`, "host_invalid"],
    ["VIBERACING_ADMIN_DATABASE_PORT", "05432", "port_invalid"],
    ["VIBERACING_ADMIN_DATABASE_PORT", "65536", "port_invalid"],
    ["VIBERACING_ADMIN_DATABASE_NAME", "VibeRacing", "database_invalid"],
    ["VIBERACING_ADMIN_DATABASE_USER", "admin-user", "user_invalid"],
    ["VIBERACING_ADMIN_DATABASE_PASSWORD", "too-short", "password_invalid"],
    ["VIBERACING_ADMIN_DATABASE_PASSWORD", ` ${privatePassword}`, "password_invalid"],
    ["VIBERACING_ADMIN_DATABASE_PASSWORD", "a".repeat(1_025), "password_invalid"],
  ] as const)("rejects malformed bounded %s values", (key, value, code) => {
    expectConfigurationError({ ...baseEnvironment, [key]: value }, code);
  });

  it("rejects coercible values and converts environment access failures without reflection", () => {
    const stringify = vi.fn(() => "viberacing_local");
    expectConfigurationError(
      {
        ...baseEnvironment,
        VIBERACING_ADMIN_DATABASE_NAME: { toString: stringify } as unknown as string,
      },
      "database_invalid",
    );
    expect(stringify).not.toHaveBeenCalled();

    const environment = new Proxy<Readonly<Record<string, string | undefined>>>(baseEnvironment, {
      get() {
        throw new Error(privatePassword);
      },
    });

    expectConfigurationError(environment, "environment_unreadable");
  });
});
