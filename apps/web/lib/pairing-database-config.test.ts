import { describe, expect, it } from "vitest";

import {
  PairingDatabaseConfigurationError,
  resolvePairingDatabaseConfig,
  type PairingDatabaseConfigurationErrorCode,
} from "./pairing-database-config";

const privatePassword = "private-pairing-database-password";
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
  code: PairingDatabaseConfigurationErrorCode,
): void {
  try {
    resolvePairingDatabaseConfig(environment);
  } catch (error) {
    expect(error).toBeInstanceOf(PairingDatabaseConfigurationError);
    expect(error).toMatchObject({
      code,
      message: "Pairing database configuration is invalid.",
      name: "PairingDatabaseConfigurationError",
    });
    expect(String(error)).not.toContain(privatePassword);
    return;
  }
  throw new Error("expected pairing database configuration to fail");
}

describe("pairing database configuration", () => {
  it("builds a separate bounded read-write pool over the reviewed Web/Auth login", () => {
    const config = resolvePairingDatabaseConfig(baseEnvironment);

    expect(config).toMatchObject({
      allowExitOnIdle: true,
      application_name: "viberacing-web-pairing",
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
        "-c role=viberacing_web -c search_path=pg_catalog,pg_temp -c default_transaction_read_only=off",
      port: 54_329,
      query_timeout: 6_000,
      ssl: false,
      statement_timeout: 5_000,
      user: "viberacing_web_login",
    });
    expect(config.password).toBe(privatePassword);
    expect(Object.keys(config)).not.toContain("password");
    expect(JSON.stringify(config)).toBe('{"redacted":true}');
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("preserves certificate and hostname verification outside local loopback", () => {
    const config = resolvePairingDatabaseConfig({
      ...baseEnvironment,
      NODE_ENV: "production",
      VIBERACING_WEB_DATABASE_HOST: "pairing.db.example",
      VIBERACING_WEB_DATABASE_PORT: "5432",
      VIBERACING_WEB_DATABASE_TLS_MODE: "verify-full",
    });

    expect(config.ssl).toEqual({ minVersion: "TLSv1.2", rejectUnauthorized: true });
    expect(Object.isFrozen(config.ssl)).toBe(true);
  });

  it.each([
    ["VIBERACING_WEB_DATABASE_HOST", "host_invalid"],
    ["VIBERACING_WEB_DATABASE_PORT", "port_invalid"],
    ["VIBERACING_WEB_DATABASE_NAME", "database_invalid"],
    ["VIBERACING_WEB_DATABASE_USER", "user_invalid"],
    ["VIBERACING_WEB_DATABASE_PASSWORD", "password_invalid"],
    ["VIBERACING_WEB_DATABASE_TLS_MODE", "tls_mode_invalid"],
  ] as const)("maps missing shared Web setting %s into the pairing boundary", (key, code) => {
    const environment = Object.fromEntries(
      Object.entries(baseEnvironment).filter(([candidate]) => candidate !== key),
    );

    expectConfigurationError(environment, code);
  });

  it("contains an unreadable shared environment without reflecting its error", () => {
    const environment = new Proxy<Readonly<Record<string, string | undefined>>>(baseEnvironment, {
      get() {
        throw new Error(privatePassword);
      },
    });

    expectConfigurationError(environment, "environment_unreadable");
  });
});
