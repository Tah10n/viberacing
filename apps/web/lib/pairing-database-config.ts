import "server-only";

import {
  PublicSnapshotDatabaseConfigurationError,
  resolvePublicSnapshotDatabaseConfig,
  type PublicSnapshotDatabaseConfig,
  type PublicSnapshotDatabaseConfigurationErrorCode,
} from "./public-snapshot-database-config";

export type PairingDatabaseConfigurationErrorCode = PublicSnapshotDatabaseConfigurationErrorCode;

export class PairingDatabaseConfigurationError extends Error {
  readonly code: PairingDatabaseConfigurationErrorCode;

  constructor(code: PairingDatabaseConfigurationErrorCode) {
    super("Pairing database configuration is invalid.");
    this.name = "PairingDatabaseConfigurationError";
    this.code = code;
  }
}

export type PairingDatabaseConfig = Readonly<
  Omit<PublicSnapshotDatabaseConfig, "application_name" | "options"> & {
    readonly application_name: "viberacing-web-pairing";
    readonly options: "-c role=viberacing_web -c search_path=pg_catalog,pg_temp -c default_transaction_read_only=off";
  }
>;

type Environment = Readonly<Record<string, string | undefined>>;

function fail(code: PairingDatabaseConfigurationErrorCode): never {
  throw new PairingDatabaseConfigurationError(code);
}

function buildConfig(base: PublicSnapshotDatabaseConfig): PairingDatabaseConfig {
  const config: PairingDatabaseConfig = {
    allowExitOnIdle: base.allowExitOnIdle,
    application_name: "viberacing-web-pairing",
    client_encoding: base.client_encoding,
    connectionTimeoutMillis: base.connectionTimeoutMillis,
    database: base.database,
    host: base.host,
    idle_in_transaction_session_timeout: base.idle_in_transaction_session_timeout,
    idleTimeoutMillis: base.idleTimeoutMillis,
    keepAlive: base.keepAlive,
    keepAliveInitialDelayMillis: base.keepAliveInitialDelayMillis,
    lock_timeout: base.lock_timeout,
    max: base.max,
    maxLifetimeSeconds: base.maxLifetimeSeconds,
    maxUses: base.maxUses,
    min: base.min,
    options:
      "-c role=viberacing_web -c search_path=pg_catalog,pg_temp -c default_transaction_read_only=off",
    password: base.password,
    port: base.port,
    query_timeout: base.query_timeout,
    ssl: base.ssl,
    statement_timeout: base.statement_timeout,
    user: base.user,
  };
  Object.defineProperty(config, "password", {
    configurable: false,
    enumerable: false,
    value: base.password,
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

export function resolvePairingDatabaseConfig(
  environment: Environment = process.env,
): PairingDatabaseConfig {
  try {
    return buildConfig(resolvePublicSnapshotDatabaseConfig(environment));
  } catch (error) {
    if (error instanceof PairingDatabaseConfigurationError) {
      throw error;
    }
    if (error instanceof PublicSnapshotDatabaseConfigurationError) {
      fail(error.code);
    }
    fail("environment_unreadable");
  }
}
