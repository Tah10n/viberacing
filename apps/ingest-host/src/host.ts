import {
  communitySyncHttpPolicy,
  createCommunitySyncHttpServer,
  createConfiguredCommunitySyncApplication,
} from "@viberacing/ingest";

import { resolveIngestHostConfig, type IngestHostConfig } from "./listener-config.js";

const configKeys = new Set(["enabled", "host", "port", "tlsTermination"]);
const dependencyKeys = new Set(["createApplication", "createServer"]);
const applicationKeys = new Set(["close", "execute"]);

export const ingestHostShutdownDeadlineMs = communitySyncHttpPolicy.connectionTimeoutMs + 2_000;

export type IngestHostErrorCode =
  | "application_invalid"
  | "application_start_failed"
  | "cleanup_failed"
  | "configuration_invalid"
  | "dependencies_invalid"
  | "listen_failed"
  | "server_creation_failed"
  | "server_invalid"
  | "shutdown_failed";

export class IngestHostError extends Error {
  readonly code: IngestHostErrorCode;

  constructor(code: IngestHostErrorCode) {
    super("Ingest host failed closed.");
    this.name = "IngestHostError";
    this.code = code;
  }
}

export interface IngestHostController {
  close(): Promise<void>;
}

export interface IngestHostApplication {
  close(): Promise<void>;
  execute(request: unknown): Promise<unknown>;
}

export interface IngestHostServer {
  close(): Promise<void>;
  listen(options: Readonly<{ host: string; port: number }>): Promise<string>;
}

export interface IngestHostDependencies {
  readonly createApplication: () => Promise<unknown>;
  readonly createServer: (application: unknown) => unknown;
}

interface ValidatedServer {
  close(): Promise<void>;
  listen(options: Readonly<{ host: string; port: number }>): Promise<string>;
}

function fail(code: IngestHostErrorCode): never {
  throw new IngestHostError(code);
}

function isPlainRecord(value: unknown): value is object {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: object, expected: ReadonlySet<string>): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expected.size &&
    keys.every((key) => typeof key === "string" && expected.has(key))
  );
}

function ownDataValue(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor && descriptor.enumerable
    ? (descriptor.value as unknown)
    : undefined;
}

function readConfig(value: unknown): IngestHostConfig {
  try {
    if (!isPlainRecord(value) || !Object.isFrozen(value) || !hasExactKeys(value, configKeys)) {
      fail("configuration_invalid");
    }
    const enabled = ownDataValue(value, "enabled");
    const host = ownDataValue(value, "host");
    const port = ownDataValue(value, "port");
    const tlsTermination = ownDataValue(value, "tlsTermination");
    if (
      enabled !== true ||
      (host !== "0.0.0.0" && host !== "127.0.0.1" && host !== "::1") ||
      typeof port !== "number" ||
      !Number.isSafeInteger(port) ||
      port < 0 ||
      port > 65_535 ||
      (tlsTermination !== "loopback-cleartext" && tlsTermination !== "railway-edge") ||
      (tlsTermination === "railway-edge" && (host !== "0.0.0.0" || port === 0)) ||
      (tlsTermination === "loopback-cleartext" && host === "0.0.0.0")
    ) {
      fail("configuration_invalid");
    }
    return Object.freeze({ enabled, host, port, tlsTermination });
  } catch (error) {
    if (error instanceof IngestHostError) {
      throw error;
    }
    fail("configuration_invalid");
  }
}

function readDependencies(value: unknown): IngestHostDependencies {
  try {
    if (!isPlainRecord(value) || !Object.isFrozen(value) || !hasExactKeys(value, dependencyKeys)) {
      fail("dependencies_invalid");
    }
    const createApplication = ownDataValue(value, "createApplication");
    const createServer = ownDataValue(value, "createServer");
    if (typeof createApplication !== "function" || typeof createServer !== "function") {
      fail("dependencies_invalid");
    }
    return Object.freeze({
      createApplication: createApplication as IngestHostDependencies["createApplication"],
      createServer: createServer as IngestHostDependencies["createServer"],
    });
  } catch (error) {
    if (error instanceof IngestHostError) {
      throw error;
    }
    fail("dependencies_invalid");
  }
}

function readApplication(value: unknown): IngestHostApplication {
  try {
    if (!isPlainRecord(value) || !Object.isFrozen(value) || !hasExactKeys(value, applicationKeys)) {
      fail("application_invalid");
    }
    const close = ownDataValue(value, "close");
    const execute = ownDataValue(value, "execute");
    if (typeof close !== "function" || typeof execute !== "function") {
      fail("application_invalid");
    }
    return Object.freeze({
      close: close as IngestHostApplication["close"],
      execute: execute as IngestHostApplication["execute"],
    });
  } catch (error) {
    if (error instanceof IngestHostError) {
      throw error;
    }
    fail("application_invalid");
  }
}

function readServer(value: unknown): ValidatedServer {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      fail("server_invalid");
    }
    const close = ownDataValue(value, "close");
    const listen = ownDataValue(value, "listen");
    if (typeof close !== "function" || typeof listen !== "function") {
      fail("server_invalid");
    }
    return Object.freeze({
      close: close.bind(value) as ValidatedServer["close"],
      listen: listen.bind(value) as ValidatedServer["listen"],
    });
  } catch (error) {
    if (error instanceof IngestHostError) {
      throw error;
    }
    fail("server_invalid");
  }
}

async function closeApplication(application: IngestHostApplication): Promise<void> {
  try {
    await application.close();
  } catch {
    fail("cleanup_failed");
  }
}

async function closeAfterFailure(close: () => Promise<void>): Promise<void> {
  try {
    await close();
  } catch {
    return;
  }
}

export async function startIngestHost(
  rawConfig: unknown,
  rawDependencies: unknown,
): Promise<IngestHostController> {
  const config = readConfig(rawConfig);
  const dependencies = readDependencies(rawDependencies);

  let rawApplication: unknown;
  try {
    rawApplication = await dependencies.createApplication();
  } catch {
    fail("application_start_failed");
  }
  const application = readApplication(rawApplication);

  let rawServer: unknown;
  try {
    rawServer = dependencies.createServer(application);
  } catch {
    await closeAfterFailure(async () => application.close());
    fail("server_creation_failed");
  }

  let server: ValidatedServer;
  try {
    server = readServer(rawServer);
  } catch {
    await closeApplication(application);
    throw new IngestHostError("server_invalid");
  }

  try {
    await server.listen({ host: config.host, port: config.port });
  } catch {
    await closeAfterFailure(async () => server.close());
    fail("listen_failed");
  }

  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    close(): Promise<void> {
      closePromise ??= (async () => {
        try {
          await server.close();
        } catch {
          fail("shutdown_failed");
        }
      })();
      return closePromise;
    },
  });
}

export async function startConfiguredIngestHost(
  environment?: Readonly<Record<string, string | undefined>>,
): Promise<IngestHostController> {
  const config = resolveIngestHostConfig(environment);
  const dependencies = Object.freeze({
    createApplication: () => createConfiguredCommunitySyncApplication(environment),
    createServer: (application: unknown) => createCommunitySyncHttpServer(application),
  });
  return startIngestHost(config, dependencies);
}
