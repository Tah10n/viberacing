import { describe, expect, it } from "vitest";

import {
  PublicSnapshotDatabaseConfigurationError,
  resolvePublicSnapshotDatabaseConfig,
  type PublicSnapshotDatabaseConfigurationErrorCode,
} from "./public-snapshot-database-config";

const privatePassword = "private-password-that-must-not-be-reflected";
const baseEnvironment = {
  NODE_ENV: "development",
  VIBERACING_WEB_DATABASE_HOST: "127.0.0.1",
  VIBERACING_WEB_DATABASE_NAME: "viberacing_local",
  VIBERACING_WEB_DATABASE_PASSWORD: privatePassword,
  VIBERACING_WEB_DATABASE_PORT: "54329",
  VIBERACING_WEB_DATABASE_TLS_MODE: "disable",
  VIBERACING_WEB_DATABASE_USER: "viberacing_web_login",
} as const;

function expectConfigurationError(
  environment: Readonly<Record<string, string | undefined>>,
  code: PublicSnapshotDatabaseConfigurationErrorCode,
): void {
  try {
    resolvePublicSnapshotDatabaseConfig(environment);
  } catch (error) {
    expect(error).toBeInstanceOf(PublicSnapshotDatabaseConfigurationError);
    expect(error).toMatchObject({
      code,
      message: "Public snapshot database configuration is invalid.",
      name: "PublicSnapshotDatabaseConfigurationError",
    });
    expect(String(error)).not.toContain(privatePassword);
    return;
  }
  throw new Error("expected public snapshot database configuration to fail");
}

describe("public snapshot database configuration", () => {
  it("builds one frozen, bounded loopback-only development pool configuration", () => {
    const config = resolvePublicSnapshotDatabaseConfig(baseEnvironment);

    expect(config).toMatchObject({
      allowExitOnIdle: true,
      application_name: "viberacing-web-public-snapshot",
      client_encoding: "UTF8",
      connectionTimeoutMillis: 2_000,
      database: "viberacing_local",
      host: "127.0.0.1",
      idle_in_transaction_session_timeout: 5_000,
      idleTimeoutMillis: 10_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 5_000,
      lock_timeout: 1_000,
      max: 4,
      maxLifetimeSeconds: 300,
      maxUses: 1_000,
      min: 0,
      options:
        "-c role=viberacing_web -c search_path=pg_catalog,pg_temp -c default_transaction_read_only=on",
      port: 54_329,
      query_timeout: 6_000,
      ssl: false,
      statement_timeout: 5_000,
      user: "viberacing_web_login",
    });
    expect(config.password).toBe(privatePassword);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.keys(config)).not.toContain("password");
    expect(Object.prototype.propertyIsEnumerable.call(config, "password")).toBe(false);
    expect(JSON.stringify(config)).toBe('{"redacted":true}');
  });

  it("requires certificate and hostname verification for a production DNS endpoint", () => {
    const config = resolvePublicSnapshotDatabaseConfig({
      ...baseEnvironment,
      NODE_ENV: "production",
      VIBERACING_WEB_DATABASE_HOST: "scores.db.example",
      VIBERACING_WEB_DATABASE_PORT: "5432",
      VIBERACING_WEB_DATABASE_TLS_MODE: "verify-full",
    });

    expect(config.ssl).toEqual({ minVersion: "TLSv1.2", rejectUnauthorized: true });
    expect(Object.isFrozen(config.ssl)).toBe(true);
  });

  it.each(["localhost", "127.0.0.1", "::1"])(
    "permits explicit cleartext only on a non-production loopback host: %s",
    (host) => {
      expect(
        resolvePublicSnapshotDatabaseConfig({
          ...baseEnvironment,
          VIBERACING_WEB_DATABASE_HOST: host,
        }).ssl,
      ).toBe(false);
    },
  );

  it.each([
    {
      code: "transport_insecure" as const,
      override: {
        NODE_ENV: "production",
      },
    },
    {
      code: "transport_insecure" as const,
      override: {
        NODE_ENV: "staging",
      },
    },
    {
      code: "transport_insecure" as const,
      override: {
        VIBERACING_WEB_DATABASE_HOST: "scores.db.example",
      },
    },
    {
      code: "host_invalid" as const,
      override: {
        VIBERACING_WEB_DATABASE_HOST: "192.0.2.10",
        VIBERACING_WEB_DATABASE_TLS_MODE: "verify-full",
      },
    },
    {
      code: "host_invalid" as const,
      override: {
        VIBERACING_WEB_DATABASE_HOST: "db",
        VIBERACING_WEB_DATABASE_TLS_MODE: "verify-full",
      },
    },
    {
      code: "tls_mode_invalid" as const,
      override: {
        VIBERACING_WEB_DATABASE_TLS_MODE: "prefer",
      },
    },
  ])("rejects ambiguous or insecure transport configuration: $code", ({ code, override }) => {
    expectConfigurationError({ ...baseEnvironment, ...override }, code);
  });

  it("requires an explicit development or test environment for cleartext", () => {
    const environment = Object.fromEntries(
      Object.entries(baseEnvironment).filter(([key]) => key !== "NODE_ENV"),
    );

    expectConfigurationError(environment, "transport_insecure");
    expect(resolvePublicSnapshotDatabaseConfig({ ...baseEnvironment, NODE_ENV: "test" }).ssl).toBe(
      false,
    );
  });

  it.each([
    {
      code: "host_invalid" as const,
      key: "VIBERACING_WEB_DATABASE_HOST",
      value: " db.example",
    },
    {
      code: "host_invalid" as const,
      key: "VIBERACING_WEB_DATABASE_HOST",
      value: `${"a".repeat(64)}.db.example`,
    },
    {
      code: "port_invalid" as const,
      key: "VIBERACING_WEB_DATABASE_PORT",
      value: "05432",
    },
    {
      code: "port_invalid" as const,
      key: "VIBERACING_WEB_DATABASE_PORT",
      value: "65536",
    },
    {
      code: "database_invalid" as const,
      key: "VIBERACING_WEB_DATABASE_NAME",
      value: "VibeRacing",
    },
    {
      code: "user_invalid" as const,
      key: "VIBERACING_WEB_DATABASE_USER",
      value: "web-user",
    },
    {
      code: "password_invalid" as const,
      key: "VIBERACING_WEB_DATABASE_PASSWORD",
      value: "too-short",
    },
    {
      code: "password_invalid" as const,
      key: "VIBERACING_WEB_DATABASE_PASSWORD",
      value: ` ${privatePassword}`,
    },
    {
      code: "password_invalid" as const,
      key: "VIBERACING_WEB_DATABASE_PASSWORD",
      value: "a".repeat(1_025),
    },
  ])("rejects malformed bounded values for $key", ({ code, key, value }) => {
    expectConfigurationError({ ...baseEnvironment, [key]: value }, code);
  });

  it.each([
    ["VIBERACING_WEB_DATABASE_HOST", "host_invalid"],
    ["VIBERACING_WEB_DATABASE_PORT", "port_invalid"],
    ["VIBERACING_WEB_DATABASE_NAME", "database_invalid"],
    ["VIBERACING_WEB_DATABASE_USER", "user_invalid"],
    ["VIBERACING_WEB_DATABASE_PASSWORD", "password_invalid"],
    ["VIBERACING_WEB_DATABASE_TLS_MODE", "tls_mode_invalid"],
  ] as const)("fails closed when %s is absent", (key, code) => {
    const environment = Object.fromEntries(
      Object.entries(baseEnvironment).filter(([candidate]) => candidate !== key),
    );
    expectConfigurationError(environment, code);
  });

  it("converts an unexpected environment read failure without reflecting its message", () => {
    const environment = new Proxy<Readonly<Record<string, string | undefined>>>(baseEnvironment, {
      get() {
        throw new Error(privatePassword);
      },
    });

    expectConfigurationError(environment, "environment_unreadable");
  });
});
