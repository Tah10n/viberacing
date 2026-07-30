import { describe, expect, it } from "vitest";

import {
  JobsDatabaseConfigurationError,
  resolveJobsDatabaseConfig,
  type JobsDatabaseConfigurationErrorCode,
} from "./database-config.js";

const privatePassword = "private-jobs-password-must-not-leak";
const baseEnvironment = {
  NODE_ENV: "development",
  VIBERACING_JOBS_DATABASE_HOST: "127.0.0.1",
  VIBERACING_JOBS_DATABASE_NAME: "viberacing_local",
  VIBERACING_JOBS_DATABASE_PASSWORD: privatePassword,
  VIBERACING_JOBS_DATABASE_PORT: "54329",
  VIBERACING_JOBS_DATABASE_TLS_MODE: "disable",
  VIBERACING_JOBS_DATABASE_USER: "viberacing_jobs_login",
} as const;

function expectConfigurationError(
  environment: Readonly<Record<string, string | undefined>>,
  code: JobsDatabaseConfigurationErrorCode,
): void {
  try {
    resolveJobsDatabaseConfig(environment);
  } catch (error) {
    expect(error).toBeInstanceOf(JobsDatabaseConfigurationError);
    expect(error).toMatchObject({
      code,
      message: "Jobs database configuration is invalid.",
      name: "JobsDatabaseConfigurationError",
    });
    expect(String(error)).not.toContain(privatePassword);
    return;
  }
  throw new Error("expected Jobs database configuration to fail");
}

describe("Jobs database configuration", () => {
  it("builds a frozen, redacted, single-client loopback configuration", () => {
    const config = resolveJobsDatabaseConfig(baseEnvironment);

    expect(config).toMatchObject({
      allowExitOnIdle: true,
      application_name: "viberacing-jobs-maintenance",
      client_encoding: "UTF8",
      connectionTimeoutMillis: 2_000,
      database: "viberacing_local",
      host: "127.0.0.1",
      idle_in_transaction_session_timeout: 5_000,
      idleTimeoutMillis: 1_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 5_000,
      lock_timeout: 6_000,
      max: 1,
      maxLifetimeSeconds: 300,
      maxUses: 100,
      min: 0,
      options: "-c role=viberacing_jobs -c search_path=pg_catalog,pg_temp",
      port: 54_329,
      query_timeout: 32_000,
      ssl: false,
      statement_timeout: 31_000,
      user: "viberacing_jobs_login",
    });
    expect(config.password).toBe(privatePassword);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.keys(config)).not.toContain("password");
    expect(Object.prototype.propertyIsEnumerable.call(config, "password")).toBe(false);
    expect(JSON.stringify(config)).toBe('{"redacted":true}');
  });

  it("requires verified TLS and a DNS hostname outside local development", () => {
    const config = resolveJobsDatabaseConfig({
      ...baseEnvironment,
      NODE_ENV: "production",
      VIBERACING_JOBS_DATABASE_HOST: "jobs.db.example",
      VIBERACING_JOBS_DATABASE_PORT: "5432",
      VIBERACING_JOBS_DATABASE_TLS_MODE: "verify-full",
    });

    expect(config.ssl).toEqual({ minVersion: "TLSv1.2", rejectUnauthorized: true });
    expect(Object.isFrozen(config.ssl)).toBe(true);
  });

  it.each(["localhost", "127.0.0.1", "::1"])(
    "allows explicit cleartext only on a local development or test loopback: %s",
    (host) => {
      expect(
        resolveJobsDatabaseConfig({
          ...baseEnvironment,
          VIBERACING_JOBS_DATABASE_HOST: host,
        }).ssl,
      ).toBe(false);
    },
  );

  it("allows the explicit test environment and rejects a missing environment label", () => {
    expect(resolveJobsDatabaseConfig({ ...baseEnvironment, NODE_ENV: "test" }).ssl).toBe(false);
    const withoutNodeEnvironment = Object.fromEntries(
      Object.entries(baseEnvironment).filter(([key]) => key !== "NODE_ENV"),
    );
    expectConfigurationError(withoutNodeEnvironment, "transport_insecure");
  });

  it.each([
    {
      code: "transport_insecure" as const,
      override: { NODE_ENV: "production" },
    },
    {
      code: "transport_insecure" as const,
      override: { NODE_ENV: "staging" },
    },
    {
      code: "transport_insecure" as const,
      override: { VIBERACING_JOBS_DATABASE_HOST: "jobs.db.example" },
    },
    {
      code: "host_invalid" as const,
      override: {
        VIBERACING_JOBS_DATABASE_HOST: "192.0.2.10",
        VIBERACING_JOBS_DATABASE_TLS_MODE: "verify-full",
      },
    },
    {
      code: "host_invalid" as const,
      override: {
        VIBERACING_JOBS_DATABASE_HOST: "database",
        VIBERACING_JOBS_DATABASE_TLS_MODE: "verify-full",
      },
    },
    {
      code: "tls_mode_invalid" as const,
      override: { VIBERACING_JOBS_DATABASE_TLS_MODE: "prefer" },
    },
  ])("rejects insecure or ambiguous transport configuration: $code", ({ code, override }) => {
    expectConfigurationError({ ...baseEnvironment, ...override }, code);
  });

  it.each([
    ["VIBERACING_JOBS_DATABASE_HOST", "host_invalid"],
    ["VIBERACING_JOBS_DATABASE_PORT", "port_invalid"],
    ["VIBERACING_JOBS_DATABASE_NAME", "database_invalid"],
    ["VIBERACING_JOBS_DATABASE_USER", "user_invalid"],
    ["VIBERACING_JOBS_DATABASE_PASSWORD", "password_invalid"],
    ["VIBERACING_JOBS_DATABASE_TLS_MODE", "tls_mode_invalid"],
  ] as const)("fails closed when %s is absent", (key, code) => {
    const environment = Object.fromEntries(
      Object.entries(baseEnvironment).filter(([candidate]) => candidate !== key),
    );
    expectConfigurationError(environment, code);
  });

  it.each([
    ["VIBERACING_JOBS_DATABASE_HOST", " jobs.db.example", "host_invalid"],
    ["VIBERACING_JOBS_DATABASE_HOST", `${"a".repeat(64)}.db.example`, "host_invalid"],
    ["VIBERACING_JOBS_DATABASE_PORT", "05432", "port_invalid"],
    ["VIBERACING_JOBS_DATABASE_PORT", "65536", "port_invalid"],
    ["VIBERACING_JOBS_DATABASE_NAME", "VibeRacing", "database_invalid"],
    ["VIBERACING_JOBS_DATABASE_USER", "jobs-user", "user_invalid"],
    ["VIBERACING_JOBS_DATABASE_PASSWORD", "too-short", "password_invalid"],
    ["VIBERACING_JOBS_DATABASE_PASSWORD", ` ${privatePassword}`, "password_invalid"],
    ["VIBERACING_JOBS_DATABASE_PASSWORD", "a".repeat(1_025), "password_invalid"],
  ] as const)("rejects malformed bounded %s values", (key, value, code) => {
    expectConfigurationError({ ...baseEnvironment, [key]: value }, code);
  });

  it("converts unexpected environment failures without reflecting them", () => {
    const environment = new Proxy<Readonly<Record<string, string | undefined>>>(baseEnvironment, {
      get() {
        throw new Error(privatePassword);
      },
    });

    expectConfigurationError(environment, "environment_unreadable");
  });
});
