import "server-only";

import { isIP } from "node:net";

const environmentKeys = {
  database: "VIBERACING_WEB_DATABASE_NAME",
  host: "VIBERACING_WEB_DATABASE_HOST",
  passwordKey: "VIBERACING_WEB_DATABASE_PASSWORD",
  port: "VIBERACING_WEB_DATABASE_PORT",
  tlsMode: "VIBERACING_WEB_DATABASE_TLS_MODE",
  user: "VIBERACING_WEB_DATABASE_USER",
} as const;
const identifierPattern = /^[a-z][a-z0-9_]{0,62}$/;
const dnsNamePattern =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const portPattern = /^[1-9][0-9]{0,4}$/;
const minimumPasswordLength = 16;
const maximumPasswordLength = 1_024;

export const publicSnapshotDatabaseConcurrencyLimit = 4;
export const publicSnapshotDatabaseConnectionTimeoutMs = 2_000;
export const publicSnapshotDatabaseQueryTimeoutMs = 6_000;
export const publicSnapshotDatabaseStatementTimeoutMs = 5_000;

export type PublicSnapshotDatabaseConfigurationErrorCode =
  | "database_invalid"
  | "environment_unreadable"
  | "host_invalid"
  | "password_invalid"
  | "port_invalid"
  | "tls_mode_invalid"
  | "transport_insecure"
  | "user_invalid";

export class PublicSnapshotDatabaseConfigurationError extends Error {
  readonly code: PublicSnapshotDatabaseConfigurationErrorCode;

  constructor(code: PublicSnapshotDatabaseConfigurationErrorCode) {
    super("Public snapshot database configuration is invalid.");
    this.name = "PublicSnapshotDatabaseConfigurationError";
    this.code = code;
  }
}

export interface PublicSnapshotDatabaseConfig {
  readonly allowExitOnIdle: true;
  readonly application_name: "viberacing-web-public-snapshot";
  readonly client_encoding: "UTF8";
  readonly connectionTimeoutMillis: typeof publicSnapshotDatabaseConnectionTimeoutMs;
  readonly database: string;
  readonly host: string;
  readonly idle_in_transaction_session_timeout: 5_000;
  readonly idleTimeoutMillis: 10_000;
  readonly keepAlive: true;
  readonly keepAliveInitialDelayMillis: 5_000;
  readonly lock_timeout: 1_000;
  readonly max: typeof publicSnapshotDatabaseConcurrencyLimit;
  readonly maxLifetimeSeconds: 300;
  readonly maxUses: 1_000;
  readonly min: 0;
  readonly options: "-c role=viberacing_web -c search_path=pg_catalog,pg_temp -c default_transaction_read_only=on";
  readonly password: string;
  readonly port: number;
  readonly query_timeout: typeof publicSnapshotDatabaseQueryTimeoutMs;
  readonly ssl:
    | false
    | Readonly<{
        minVersion: "TLSv1.2";
        rejectUnauthorized: true;
      }>;
  readonly statement_timeout: typeof publicSnapshotDatabaseStatementTimeoutMs;
  readonly user: string;
}

type Environment = Readonly<Record<string, string | undefined>>;

function fail(code: PublicSnapshotDatabaseConfigurationErrorCode): never {
  throw new PublicSnapshotDatabaseConfigurationError(code);
}

function readEnvironmentValue(environment: Environment, key: string): string | undefined {
  return environment[key];
}

function validIdentifier(value: string | undefined): value is string {
  return value !== undefined && identifierPattern.test(value);
}

function validPassword(value: string | undefined): value is string {
  return (
    value !== undefined &&
    value.length >= minimumPasswordLength &&
    value.length <= maximumPasswordLength &&
    value === value.trim() &&
    !value.includes("\0")
  );
}

function validHost(value: string | undefined): value is string {
  return (
    value !== undefined &&
    value.length > 0 &&
    value.length <= 253 &&
    value === value.trim() &&
    (isIP(value) !== 0 || value === "localhost" || dnsNamePattern.test(value))
  );
}

function buildConfig(environment: Environment): PublicSnapshotDatabaseConfig {
  const host = readEnvironmentValue(environment, environmentKeys.host);
  const portValue = readEnvironmentValue(environment, environmentKeys.port);
  const database = readEnvironmentValue(environment, environmentKeys.database);
  const user = readEnvironmentValue(environment, environmentKeys.user);
  const password = readEnvironmentValue(environment, environmentKeys.passwordKey);
  const tlsMode = readEnvironmentValue(environment, environmentKeys.tlsMode);
  const nodeEnvironment = readEnvironmentValue(environment, "NODE_ENV");

  if (!validHost(host)) {
    fail("host_invalid");
  }
  if (portValue === undefined || !portPattern.test(portValue)) {
    fail("port_invalid");
  }
  const port = Number(portValue);
  if (!Number.isSafeInteger(port) || port > 65_535) {
    fail("port_invalid");
  }
  if (!validIdentifier(database)) {
    fail("database_invalid");
  }
  if (!validIdentifier(user)) {
    fail("user_invalid");
  }
  if (!validPassword(password)) {
    fail("password_invalid");
  }

  let ssl: PublicSnapshotDatabaseConfig["ssl"];
  if (tlsMode === "disable") {
    const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
    const explicitLocalEnvironment =
      nodeEnvironment === "development" || nodeEnvironment === "test";
    if (!loopback || !explicitLocalEnvironment) {
      fail("transport_insecure");
    }
    ssl = false;
  } else if (tlsMode === "verify-full") {
    if (isIP(host) !== 0 || !dnsNamePattern.test(host)) {
      fail("host_invalid");
    }
    ssl = Object.freeze({ minVersion: "TLSv1.2", rejectUnauthorized: true });
  } else {
    fail("tls_mode_invalid");
  }

  const config: PublicSnapshotDatabaseConfig = {
    allowExitOnIdle: true,
    application_name: "viberacing-web-public-snapshot",
    client_encoding: "UTF8",
    connectionTimeoutMillis: publicSnapshotDatabaseConnectionTimeoutMs,
    database,
    host,
    idle_in_transaction_session_timeout: 5_000,
    idleTimeoutMillis: 10_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 5_000,
    lock_timeout: 1_000,
    max: publicSnapshotDatabaseConcurrencyLimit,
    maxLifetimeSeconds: 300,
    maxUses: 1_000,
    min: 0,
    options:
      "-c role=viberacing_web -c search_path=pg_catalog,pg_temp -c default_transaction_read_only=on",
    password,
    port,
    query_timeout: publicSnapshotDatabaseQueryTimeoutMs,
    ssl,
    statement_timeout: publicSnapshotDatabaseStatementTimeoutMs,
    user,
  };
  Object.defineProperty(config, "password", {
    configurable: false,
    enumerable: false,
    value: password,
    writable: false,
  });
  Object.defineProperty(config, "toJSON", {
    configurable: false,
    enumerable: false,
    value: () => ({ redacted: true }),
    writable: false,
  });
  return Object.freeze(config);
}

export function resolvePublicSnapshotDatabaseConfig(
  environment: Environment = process.env,
): PublicSnapshotDatabaseConfig {
  try {
    return buildConfig(environment);
  } catch (error) {
    if (error instanceof PublicSnapshotDatabaseConfigurationError) {
      throw error;
    }
    fail("environment_unreadable");
  }
}
