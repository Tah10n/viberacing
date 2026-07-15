import { isIP } from "node:net";

const environmentKeys = {
  database: "VIBERACING_JOBS_DATABASE_NAME",
  host: "VIBERACING_JOBS_DATABASE_HOST",
  passwordKey: "VIBERACING_JOBS_DATABASE_PASSWORD",
  port: "VIBERACING_JOBS_DATABASE_PORT",
  tlsMode: "VIBERACING_JOBS_DATABASE_TLS_MODE",
  user: "VIBERACING_JOBS_DATABASE_USER",
} as const;
const identifierPattern = /^[a-z][a-z0-9_]{0,62}$/;
const dnsNamePattern =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const portPattern = /^[1-9][0-9]{0,4}$/;
const minimumPasswordLength = 16;
const maximumPasswordLength = 1_024;

export const jobsDatabaseConcurrencyLimit = 1;
export const jobsDatabaseConnectionTimeoutMs = 2_000;
export const jobsDatabaseStatementTimeoutMs = 31_000;
export const jobsDatabaseQueryTimeoutMs = 32_000;

export type JobsDatabaseConfigurationErrorCode =
  | "database_invalid"
  | "environment_unreadable"
  | "host_invalid"
  | "password_invalid"
  | "port_invalid"
  | "tls_mode_invalid"
  | "transport_insecure"
  | "user_invalid";

export class JobsDatabaseConfigurationError extends Error {
  readonly code: JobsDatabaseConfigurationErrorCode;

  constructor(code: JobsDatabaseConfigurationErrorCode) {
    super("Jobs database configuration is invalid.");
    this.name = "JobsDatabaseConfigurationError";
    this.code = code;
  }
}

export interface JobsDatabaseConfig {
  readonly allowExitOnIdle: true;
  readonly application_name: "viberacing-jobs-community-maintenance";
  readonly client_encoding: "UTF8";
  readonly connectionTimeoutMillis: typeof jobsDatabaseConnectionTimeoutMs;
  readonly database: string;
  readonly host: string;
  readonly idle_in_transaction_session_timeout: 5_000;
  readonly idleTimeoutMillis: 1_000;
  readonly keepAlive: true;
  readonly keepAliveInitialDelayMillis: 5_000;
  readonly lock_timeout: 6_000;
  readonly max: typeof jobsDatabaseConcurrencyLimit;
  readonly maxLifetimeSeconds: 300;
  readonly maxUses: 100;
  readonly min: 0;
  readonly options: "-c role=viberacing_jobs -c search_path=pg_catalog,pg_temp";
  readonly password: string;
  readonly port: number;
  readonly query_timeout: typeof jobsDatabaseQueryTimeoutMs;
  readonly ssl:
    | false
    | Readonly<{
        minVersion: "TLSv1.2";
        rejectUnauthorized: true;
      }>;
  readonly statement_timeout: typeof jobsDatabaseStatementTimeoutMs;
  readonly user: string;
}

type Environment = Readonly<Record<string, string | undefined>>;

function fail(code: JobsDatabaseConfigurationErrorCode): never {
  throw new JobsDatabaseConfigurationError(code);
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

function buildConfig(environment: Environment): JobsDatabaseConfig {
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

  let ssl: JobsDatabaseConfig["ssl"];
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

  const config: JobsDatabaseConfig = {
    allowExitOnIdle: true,
    application_name: "viberacing-jobs-community-maintenance",
    client_encoding: "UTF8",
    connectionTimeoutMillis: jobsDatabaseConnectionTimeoutMs,
    database,
    host,
    idle_in_transaction_session_timeout: 5_000,
    idleTimeoutMillis: 1_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 5_000,
    lock_timeout: 6_000,
    max: jobsDatabaseConcurrencyLimit,
    maxLifetimeSeconds: 300,
    maxUses: 100,
    min: 0,
    options: "-c role=viberacing_jobs -c search_path=pg_catalog,pg_temp",
    password,
    port,
    query_timeout: jobsDatabaseQueryTimeoutMs,
    ssl,
    statement_timeout: jobsDatabaseStatementTimeoutMs,
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

export function resolveJobsDatabaseConfig(
  environment: Environment = process.env,
): JobsDatabaseConfig {
  try {
    return buildConfig(environment);
  } catch (error) {
    if (error instanceof JobsDatabaseConfigurationError) {
      throw error;
    }
    fail("environment_unreadable");
  }
}
