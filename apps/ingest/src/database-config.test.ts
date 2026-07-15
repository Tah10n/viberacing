import { describe, expect, it } from "vitest";

import {
  IngestDatabaseConfigurationError,
  resolveIngestDatabaseConfig,
  type IngestDatabaseConfigurationErrorCode,
} from "./database-config.js";

const placeholderPassword = "synthetic-ingest-password-value";
const baseEnvironment = {
  NODE_ENV: "development",
  VIBERACING_INGEST_DATABASE_HOST: "127.0.0.1",
  VIBERACING_INGEST_DATABASE_NAME: "viberacing_local",
  VIBERACING_INGEST_DATABASE_PASSWORD: placeholderPassword,
  VIBERACING_INGEST_DATABASE_PORT: "54329",
  VIBERACING_INGEST_DATABASE_TLS_MODE: "disable",
  VIBERACING_INGEST_DATABASE_USER: "viberacing_ingest_login",
} as const;

function expectConfigurationError(
  environment: Readonly<Record<string, string | undefined>>,
  code: IngestDatabaseConfigurationErrorCode,
): void {
  try {
    resolveIngestDatabaseConfig(environment);
  } catch (error) {
    expect(error).toBeInstanceOf(IngestDatabaseConfigurationError);
    expect(error).toMatchObject({
      code,
      message: "Ingest database configuration is invalid.",
      name: "IngestDatabaseConfigurationError",
    });
    expect(String(error)).not.toContain(placeholderPassword);
    return;
  }
  throw new Error("expected Ingest database configuration to fail");
}

describe("Ingest database configuration", () => {
  it("builds a frozen, redacted, four-client loopback configuration", () => {
    const config = resolveIngestDatabaseConfig(baseEnvironment);

    expect(config).toMatchObject({
      allowExitOnIdle: true,
      application_name: "viberacing-ingest-community-sync",
      client_encoding: "UTF8",
      connectionTimeoutMillis: 2_000,
      database: "viberacing_local",
      host: "127.0.0.1",
      idle_in_transaction_session_timeout: 5_000,
      idleTimeoutMillis: 10_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 5_000,
      lock_timeout: 6_000,
      max: 4,
      maxLifetimeSeconds: 300,
      maxUses: 1_000,
      min: 0,
      options: "-c role=viberacing_ingest -c search_path=pg_catalog,pg_temp",
      port: 54_329,
      query_timeout: 32_000,
      ssl: false,
      statement_timeout: 31_000,
      user: "viberacing_ingest_login",
    });
    expect(config.password).toBe(placeholderPassword);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.keys(config)).not.toContain("password");
    expect(Object.prototype.propertyIsEnumerable.call(config, "password")).toBe(false);
    expect(JSON.stringify(config)).toBe('{"redacted":true}');
  });

  it("requires verified TLS and a DNS hostname outside local development", () => {
    const config = resolveIngestDatabaseConfig({
      ...baseEnvironment,
      NODE_ENV: "production",
      VIBERACING_INGEST_DATABASE_HOST: "ingest.db.example",
      VIBERACING_INGEST_DATABASE_PORT: "5432",
      VIBERACING_INGEST_DATABASE_TLS_MODE: "verify-full",
    });

    expect(config.ssl).toEqual({ minVersion: "TLSv1.2", rejectUnauthorized: true });
    expect(Object.isFrozen(config.ssl)).toBe(true);
  });

  it.each(["localhost", "127.0.0.1", "::1"])(
    "allows explicit cleartext only on a development loopback: %s",
    (host) => {
      expect(
        resolveIngestDatabaseConfig({
          ...baseEnvironment,
          VIBERACING_INGEST_DATABASE_HOST: host,
        }).ssl,
      ).toBe(false);
    },
  );

  it("allows test loopback and rejects an absent environment label", () => {
    expect(resolveIngestDatabaseConfig({ ...baseEnvironment, NODE_ENV: "test" }).ssl).toBe(false);
    const withoutNodeEnvironment = Object.fromEntries(
      Object.entries(baseEnvironment).filter(([key]) => key !== "NODE_ENV"),
    );
    expectConfigurationError(withoutNodeEnvironment, "transport_insecure");
  });

  it.each([
    { code: "transport_insecure" as const, override: { NODE_ENV: "production" } },
    { code: "transport_insecure" as const, override: { NODE_ENV: "staging" } },
    {
      code: "transport_insecure" as const,
      override: { VIBERACING_INGEST_DATABASE_HOST: "ingest.db.example" },
    },
    {
      code: "host_invalid" as const,
      override: {
        VIBERACING_INGEST_DATABASE_HOST: "192.0.2.10",
        VIBERACING_INGEST_DATABASE_TLS_MODE: "verify-full",
      },
    },
    {
      code: "host_invalid" as const,
      override: {
        VIBERACING_INGEST_DATABASE_HOST: "database",
        VIBERACING_INGEST_DATABASE_TLS_MODE: "verify-full",
      },
    },
    {
      code: "tls_mode_invalid" as const,
      override: { VIBERACING_INGEST_DATABASE_TLS_MODE: "prefer" },
    },
  ])("rejects insecure or ambiguous transport configuration: $code", ({ code, override }) => {
    expectConfigurationError({ ...baseEnvironment, ...override }, code);
  });

  it.each([
    ["VIBERACING_INGEST_DATABASE_HOST", "host_invalid"],
    ["VIBERACING_INGEST_DATABASE_PORT", "port_invalid"],
    ["VIBERACING_INGEST_DATABASE_NAME", "database_invalid"],
    ["VIBERACING_INGEST_DATABASE_USER", "user_invalid"],
    ["VIBERACING_INGEST_DATABASE_PASSWORD", "password_invalid"],
    ["VIBERACING_INGEST_DATABASE_TLS_MODE", "tls_mode_invalid"],
  ] as const)("fails closed when %s is absent", (key, code) => {
    const environment = Object.fromEntries(
      Object.entries(baseEnvironment).filter(([candidate]) => candidate !== key),
    );
    expectConfigurationError(environment, code);
  });

  it.each([
    ["VIBERACING_INGEST_DATABASE_HOST", "", "host_invalid"],
    ["VIBERACING_INGEST_DATABASE_HOST", " ingest.db.example", "host_invalid"],
    ["VIBERACING_INGEST_DATABASE_HOST", "a".repeat(254), "host_invalid"],
    ["VIBERACING_INGEST_DATABASE_HOST", `${"a".repeat(64)}.db.example`, "host_invalid"],
    ["VIBERACING_INGEST_DATABASE_PORT", "05432", "port_invalid"],
    ["VIBERACING_INGEST_DATABASE_PORT", "65536", "port_invalid"],
    ["VIBERACING_INGEST_DATABASE_NAME", "VibeRacing", "database_invalid"],
    ["VIBERACING_INGEST_DATABASE_USER", "ingest-user", "user_invalid"],
    ["VIBERACING_INGEST_DATABASE_PASSWORD", "too-short", "password_invalid"],
    ["VIBERACING_INGEST_DATABASE_PASSWORD", ` ${placeholderPassword}`, "password_invalid"],
    ["VIBERACING_INGEST_DATABASE_PASSWORD", `${placeholderPassword}\0`, "password_invalid"],
    ["VIBERACING_INGEST_DATABASE_PASSWORD", "a".repeat(1_025), "password_invalid"],
  ] as const)("rejects malformed bounded %s values", (key, value, code) => {
    expectConfigurationError({ ...baseEnvironment, [key]: value }, code);
  });

  it("converts unexpected environment failures without reflecting them", () => {
    const environment = new Proxy<Readonly<Record<string, string | undefined>>>(baseEnvironment, {
      get() {
        throw new Error(placeholderPassword);
      },
    });

    expectConfigurationError(environment, "environment_unreadable");
  });
});
