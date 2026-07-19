import process from "node:process";

const localHosts = new Set(["127.0.0.1", "::1"]);
const canonicalIntegerPattern = /^(?:0|[1-9][0-9]*)$/;
const maximumPort = 65_535;
const maximumRailwayDrainSeconds = 300;

const names = Object.freeze({
  enabled: "VIBERACING_INGEST_ENABLED",
  localPort: "VIBERACING_INGEST_LISTENER_PORT",
  host: "VIBERACING_INGEST_LISTENER_HOST",
  nodeEnvironment: "NODE_ENV",
  railwayDrainSeconds: "RAILWAY_DEPLOYMENT_DRAINING_SECONDS",
  railwayPort: "PORT",
  tlsTermination: "VIBERACING_INGEST_TLS_TERMINATION",
});

export const ingestHostMinimumRailwayDrainSeconds = 40;

export type IngestHostTlsTermination = "loopback-cleartext" | "railway-edge";

export type IngestHostConfigurationErrorCode =
  | "environment_unreadable"
  | "host_invalid"
  | "ingest_disabled"
  | "node_environment_invalid"
  | "port_invalid"
  | "railway_drain_invalid"
  | "tls_termination_invalid";

export class IngestHostConfigurationError extends Error {
  readonly code: IngestHostConfigurationErrorCode;

  constructor(code: IngestHostConfigurationErrorCode) {
    super("Ingest host configuration is invalid.");
    this.name = "IngestHostConfigurationError";
    this.code = code;
  }
}

export interface IngestHostConfig {
  readonly enabled: true;
  readonly host: "0.0.0.0" | "127.0.0.1" | "::1";
  readonly port: number;
  readonly tlsTermination: IngestHostTlsTermination;
}

function fail(code: IngestHostConfigurationErrorCode): never {
  throw new IngestHostConfigurationError(code);
}

function environmentValue(environment: unknown, key: string): string | undefined {
  try {
    if (environment === null || typeof environment !== "object") {
      fail("environment_unreadable");
    }
    const descriptor = Object.getOwnPropertyDescriptor(environment, key);
    if (descriptor === undefined) {
      return undefined;
    }
    if (!("value" in descriptor) || !descriptor.enumerable) {
      fail("environment_unreadable");
    }
    if (descriptor.value === undefined) {
      return undefined;
    }
    if (typeof descriptor.value !== "string") {
      fail("environment_unreadable");
    }
    return descriptor.value;
  } catch (error) {
    if (error instanceof IngestHostConfigurationError) {
      throw error;
    }
    fail("environment_unreadable");
  }
}

function parsePort(value: string | undefined, allowEphemeral: boolean): number {
  if (value === undefined || !canonicalIntegerPattern.test(value) || value.length > 5) {
    fail("port_invalid");
  }
  const port = Number(value);
  if (port > maximumPort || (port === 0 && !allowEphemeral)) {
    fail("port_invalid");
  }
  return port;
}

function validateRailwayDrainSeconds(value: string | undefined): void {
  if (value === undefined || !canonicalIntegerPattern.test(value) || value.length > 3) {
    fail("railway_drain_invalid");
  }
  const seconds = Number(value);
  if (seconds < ingestHostMinimumRailwayDrainSeconds || seconds > maximumRailwayDrainSeconds) {
    fail("railway_drain_invalid");
  }
}

export function resolveIngestHostConfig(environment: unknown = process.env): IngestHostConfig {
  if (environmentValue(environment, names.enabled) !== "true") {
    fail("ingest_disabled");
  }

  const nodeEnvironment = environmentValue(environment, names.nodeEnvironment);
  const host = environmentValue(environment, names.host);
  const tlsTermination = environmentValue(environment, names.tlsTermination);

  if (
    nodeEnvironment !== "development" &&
    nodeEnvironment !== "production" &&
    nodeEnvironment !== "test"
  ) {
    fail("node_environment_invalid");
  }

  if (nodeEnvironment === "production") {
    if (host !== "0.0.0.0") {
      fail("host_invalid");
    }
    if (tlsTermination !== "railway-edge") {
      fail("tls_termination_invalid");
    }
    if (environmentValue(environment, names.localPort) !== undefined) {
      fail("port_invalid");
    }
    const port = parsePort(environmentValue(environment, names.railwayPort), false);
    validateRailwayDrainSeconds(environmentValue(environment, names.railwayDrainSeconds));
    return Object.freeze({ enabled: true, host, port, tlsTermination });
  }

  if (host === undefined || !localHosts.has(host)) {
    fail("host_invalid");
  }
  if (tlsTermination !== "loopback-cleartext") {
    fail("tls_termination_invalid");
  }
  const port = parsePort(
    environmentValue(environment, names.localPort),
    nodeEnvironment === "test",
  );
  return Object.freeze({
    enabled: true,
    host: host as "127.0.0.1" | "::1",
    port,
    tlsTermination,
  });
}
