import { isIP } from "node:net";

const environmentKeys = {
  database: "VIBERACING_MIGRATIONS_DATABASE_NAME",
  host: "VIBERACING_MIGRATIONS_DATABASE_HOST",
  passwordKey: "VIBERACING_MIGRATIONS_DATABASE_PASSWORD",
  port: "VIBERACING_MIGRATIONS_DATABASE_PORT",
  tlsMode: "VIBERACING_MIGRATIONS_DATABASE_TLS_MODE",
  user: "VIBERACING_MIGRATIONS_DATABASE_USER",
} as const;
const identifierPattern = /^[a-z][a-z0-9_]{0,62}$/;
const dnsNamePattern =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const portPattern = /^[1-9][0-9]{0,4}$/;
const minimumPasswordLength = 16;
const maximumPasswordLength = 1_024;

export const migrationDatabaseConnectionTimeoutMs = 2_000;
export const migrationDatabaseLockTimeoutMs = 60_000;
export const migrationDatabaseQueryTimeoutMs = 125_000;
export const migrationDatabaseStatementTimeoutMs = 120_000;

export type MigrationDatabaseConfigurationErrorCode =
  | "database_invalid"
  | "environment_unreadable"
  | "host_invalid"
  | "password_invalid"
  | "port_invalid"
  | "tls_mode_invalid"
  | "transport_insecure"
  | "user_invalid";

export class MigrationDatabaseConfigurationError extends Error {
  readonly code: MigrationDatabaseConfigurationErrorCode;

  constructor(code: MigrationDatabaseConfigurationErrorCode) {
    super("Migration database configuration is invalid.");
    this.name = "MigrationDatabaseConfigurationError";
    this.code = code;
  }
}

export interface MigrationDatabaseConfig {
  readonly allowExitOnIdle: true;
  readonly application_name: "viberacing-migration-runner";
  readonly client_encoding: "UTF8";
  readonly connectionTimeoutMillis: typeof migrationDatabaseConnectionTimeoutMs;
  readonly database: string;
  readonly host: string;
  readonly idle_in_transaction_session_timeout: 35_000;
  readonly idleTimeoutMillis: 1_000;
  readonly keepAlive: true;
  readonly keepAliveInitialDelayMillis: 5_000;
  readonly lock_timeout: typeof migrationDatabaseLockTimeoutMs;
  readonly max: 1;
  readonly maxLifetimeSeconds: 600;
  readonly maxUses: 1;
  readonly min: 0;
  readonly options: "-c search_path=pg_catalog,pg_temp";
  readonly password: string;
  readonly port: number;
  readonly query_timeout: typeof migrationDatabaseQueryTimeoutMs;
  readonly ssl:
    | false
    | Readonly<{
        minVersion: "TLSv1.2";
        rejectUnauthorized: true;
      }>;
  readonly statement_timeout: typeof migrationDatabaseStatementTimeoutMs;
  readonly user: string;
}

type Environment = Readonly<Record<string, string | undefined>>;

function fail(code: MigrationDatabaseConfigurationErrorCode): never {
  throw new MigrationDatabaseConfigurationError(code);
}

function readValue(environment: Environment, key: string): string | undefined {
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

function buildConfig(environment: Environment): MigrationDatabaseConfig {
  const host = readValue(environment, environmentKeys.host);
  const portValue = readValue(environment, environmentKeys.port);
  const database = readValue(environment, environmentKeys.database);
  const user = readValue(environment, environmentKeys.user);
  const password = readValue(environment, environmentKeys.passwordKey);
  const tlsMode = readValue(environment, environmentKeys.tlsMode);
  const nodeEnvironment = readValue(environment, "NODE_ENV");

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
  if (!validIdentifier(user) || user === "viberacing_owner") {
    fail("user_invalid");
  }
  if (!validPassword(password)) {
    fail("password_invalid");
  }

  let ssl: MigrationDatabaseConfig["ssl"];
  if (tlsMode === "disable") {
    const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
    if (!loopback || (nodeEnvironment !== "development" && nodeEnvironment !== "test")) {
      fail("transport_insecure");
    }
    ssl = false;
  } else if (tlsMode === "verify-full") {
    if (isIP(host) !== 0 || (host !== "localhost" && !dnsNamePattern.test(host))) {
      fail("host_invalid");
    }
    ssl = Object.freeze({ minVersion: "TLSv1.2", rejectUnauthorized: true });
  } else {
    fail("tls_mode_invalid");
  }

  const config: MigrationDatabaseConfig = {
    allowExitOnIdle: true,
    application_name: "viberacing-migration-runner",
    client_encoding: "UTF8",
    connectionTimeoutMillis: migrationDatabaseConnectionTimeoutMs,
    database,
    host,
    idle_in_transaction_session_timeout: 35_000,
    idleTimeoutMillis: 1_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 5_000,
    lock_timeout: migrationDatabaseLockTimeoutMs,
    max: 1,
    maxLifetimeSeconds: 600,
    maxUses: 1,
    min: 0,
    options: "-c search_path=pg_catalog,pg_temp",
    password,
    port,
    query_timeout: migrationDatabaseQueryTimeoutMs,
    ssl,
    statement_timeout: migrationDatabaseStatementTimeoutMs,
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

export function resolveMigrationDatabaseConfig(
  environment: Environment = process.env,
): MigrationDatabaseConfig {
  try {
    return buildConfig(environment);
  } catch (error) {
    if (error instanceof MigrationDatabaseConfigurationError) {
      throw error;
    }
    fail("environment_unreadable");
  }
}
