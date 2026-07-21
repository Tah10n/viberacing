import { isIP } from "node:net";

const environmentKeys = {
  database: "VIBERACING_ADMIN_DATABASE_NAME",
  host: "VIBERACING_ADMIN_DATABASE_HOST",
  passwordKey: "VIBERACING_ADMIN_DATABASE_PASSWORD",
  port: "VIBERACING_ADMIN_DATABASE_PORT",
  tlsMode: "VIBERACING_ADMIN_DATABASE_TLS_MODE",
  user: "VIBERACING_ADMIN_DATABASE_USER",
} as const;
const identifierPattern = /^[a-z][a-z0-9_]{0,62}$/;
const dnsNamePattern =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const portPattern = /^[1-9][0-9]{0,4}$/;
const minimumPasswordLength = 16;
const maximumPasswordLength = 1_024;

export const adminDatabaseConcurrencyLimit = 1;
export const adminDatabaseConnectionTimeoutMs = 2_000;
export const adminDatabaseStatementTimeoutMs = 5_000;
export const adminDatabaseQueryTimeoutMs = 6_000;

export type AdminDatabaseConfigurationErrorCode =
  | "database_invalid"
  | "environment_unreadable"
  | "host_invalid"
  | "password_invalid"
  | "port_invalid"
  | "tls_mode_invalid"
  | "transport_insecure"
  | "user_invalid";

export class AdminDatabaseConfigurationError extends Error {
  readonly code: AdminDatabaseConfigurationErrorCode;

  constructor(code: AdminDatabaseConfigurationErrorCode) {
    super("Admin database configuration is invalid.");
    this.name = "AdminDatabaseConfigurationError";
    this.code = code;
  }
}

export interface AdminDatabaseConfig {
  readonly allowExitOnIdle: true;
  readonly application_name: "viberacing-admin-invite-issuance";
  readonly client_encoding: "UTF8";
  readonly connectionTimeoutMillis: typeof adminDatabaseConnectionTimeoutMs;
  readonly database: string;
  readonly host: string;
  readonly idle_in_transaction_session_timeout: 2_000;
  readonly idleTimeoutMillis: 1_000;
  readonly keepAlive: true;
  readonly keepAliveInitialDelayMillis: 5_000;
  readonly lock_timeout: 1_000;
  readonly max: typeof adminDatabaseConcurrencyLimit;
  readonly maxLifetimeSeconds: 300;
  readonly maxUses: 25;
  readonly min: 0;
  readonly options: "-c search_path=pg_catalog,pg_temp";
  readonly password: string;
  readonly port: number;
  readonly query_timeout: typeof adminDatabaseQueryTimeoutMs;
  readonly ssl:
    | false
    | Readonly<{
        minVersion: "TLSv1.2";
        rejectUnauthorized: true;
      }>;
  readonly statement_timeout: typeof adminDatabaseStatementTimeoutMs;
  readonly user: string;
}

type Environment = Readonly<Record<string, string | undefined>>;

function fail(code: AdminDatabaseConfigurationErrorCode): never {
  throw new AdminDatabaseConfigurationError(code);
}

function readEnvironmentValue(environment: Environment, key: string): string | undefined {
  return environment[key];
}

function validIdentifier(value: string | undefined): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

function validPassword(value: string | undefined): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimumPasswordLength &&
    value.length <= maximumPasswordLength &&
    value === value.trim() &&
    !value.includes("\0")
  );
}

function validHost(value: string | undefined): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 253 &&
    value === value.trim() &&
    (isIP(value) !== 0 || value === "localhost" || dnsNamePattern.test(value))
  );
}

function buildConfig(environment: Environment): AdminDatabaseConfig {
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
  if (typeof portValue !== "string" || !portPattern.test(portValue)) {
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

  let ssl: AdminDatabaseConfig["ssl"];
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

  const config: AdminDatabaseConfig = {
    allowExitOnIdle: true,
    application_name: "viberacing-admin-invite-issuance",
    client_encoding: "UTF8",
    connectionTimeoutMillis: adminDatabaseConnectionTimeoutMs,
    database,
    host,
    idle_in_transaction_session_timeout: 2_000,
    idleTimeoutMillis: 1_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 5_000,
    lock_timeout: 1_000,
    max: adminDatabaseConcurrencyLimit,
    maxLifetimeSeconds: 300,
    maxUses: 25,
    min: 0,
    options: "-c search_path=pg_catalog,pg_temp",
    password,
    port,
    query_timeout: adminDatabaseQueryTimeoutMs,
    ssl,
    statement_timeout: adminDatabaseStatementTimeoutMs,
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

export function resolveAdminDatabaseConfig(
  environment: Environment = process.env,
): AdminDatabaseConfig {
  try {
    return buildConfig(environment);
  } catch (error) {
    if (error instanceof AdminDatabaseConfigurationError) {
      throw error;
    }
    fail("environment_unreadable");
  }
}
