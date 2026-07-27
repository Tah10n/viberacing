import { Buffer } from "node:buffer";

import { createCommunitySyncHttpServer } from "@viberacing/ingest";
import { describe, expect, it, vi } from "vitest";

import {
  IngestHostError,
  ingestHostShutdownDeadlineMs,
  startConfiguredIngestHost,
  startIngestHost,
  type IngestHostErrorCode,
} from "./host.js";

const loopbackConfig = Object.freeze({
  enabled: true,
  host: "127.0.0.1",
  port: 0,
  tlsTermination: "loopback-cleartext",
  usageSyncEnabled: false,
});

function createApplication(close = vi.fn(async () => undefined)) {
  return Object.freeze({
    close,
    execute: vi.fn(async () => {
      throw new Error("Unexpected application execution.");
    }),
  });
}

function createServer(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    close: vi.fn(async () => undefined),
    listen: vi.fn(async () => "http://127.0.0.1:8788"),
    ...overrides,
  };
}

function createDependencies(
  application: unknown = createApplication(),
  server: unknown = createServer(),
) {
  return Object.freeze({
    createApplication: vi.fn(async () => application),
    createServer: vi.fn(() => server),
  });
}

async function expectHostError(
  promise: Promise<unknown>,
  code: IngestHostErrorCode,
): Promise<void> {
  try {
    await promise;
    throw new Error("Expected host startup to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(IngestHostError);
    expect(error).toMatchObject({ code, message: "Ingest host failed closed." });
    expect(error).not.toHaveProperty("cause");
  }
}

describe("startIngestHost", () => {
  it("binds the exact reviewed host and port and closes exactly once", async () => {
    const application = createApplication();
    const server = createServer();
    const dependencies = createDependencies(application, server);

    const controller = await startIngestHost(loopbackConfig, dependencies);
    const firstClose = controller.close();
    const secondClose = controller.close();
    await Promise.all([firstClose, secondClose]);

    expect(dependencies.createApplication).toHaveBeenCalledTimes(1);
    expect(dependencies.createServer).toHaveBeenCalledWith(application);
    expect(server.listen).toHaveBeenCalledWith({ host: "127.0.0.1", port: 0 });
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(firstClose).toBe(secondClose);
    expect(Object.isFrozen(controller)).toBe(true);
    expect(ingestHostShutdownDeadlineMs).toBe(36_000);
  });

  it.each([
    Object.freeze({
      enabled: true,
      host: "::1",
      port: 0,
      tlsTermination: "loopback-cleartext",
      usageSyncEnabled: false,
    }),
    Object.freeze({
      enabled: true,
      host: "0.0.0.0",
      port: 8080,
      tlsTermination: "railway-edge",
      usageSyncEnabled: true,
    }),
    Object.freeze(
      Object.assign(Object.create(null) as Record<string, unknown>, {
        enabled: true,
        host: "127.0.0.1",
        port: 0,
        tlsTermination: "loopback-cleartext",
        usageSyncEnabled: false,
      }),
    ),
  ])("accepts the closed valid configuration variant %#", async (configuration) => {
    const server = createServer();
    const controller = await startIngestHost(
      configuration,
      createDependencies(createApplication(), server),
    );

    expect(server.listen).toHaveBeenCalledWith({
      host: configuration.host,
      port: configuration.port,
    });
    await controller.close();
  });

  it("opens a real loopback listener through only the reviewed Ingest server factory", async () => {
    const application = createApplication();
    let address = "";
    const dependencies = Object.freeze({
      createApplication: vi.fn(async () => application),
      createServer: vi.fn((validatedApplication: unknown) => {
        const server = createCommunitySyncHttpServer(validatedApplication);
        return {
          close: async () => server.close(),
          listen: async (options: Readonly<{ host: string; port: number }>) => {
            address = await server.listen(options);
            return address;
          },
        };
      }),
    });

    const controller = await startIngestHost(loopbackConfig, dependencies);
    const response = await fetch(`${address}/not-a-route`, { redirect: "error" });

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    await controller.close();
    expect(application.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    [],
    { ...loopbackConfig },
    Object.freeze({ ...loopbackConfig, extra: true }),
    Object.freeze({ ...loopbackConfig, enabled: false }),
    Object.freeze({ ...loopbackConfig, host: "localhost" }),
    Object.freeze({ ...loopbackConfig, port: "0" }),
    Object.freeze({ ...loopbackConfig, port: 0.5 }),
    Object.freeze({ ...loopbackConfig, port: -1 }),
    Object.freeze({ ...loopbackConfig, port: 65_536 }),
    Object.freeze({ ...loopbackConfig, tlsTermination: "disabled" }),
    Object.freeze({ ...loopbackConfig, usageSyncEnabled: "true" }),
    Object.freeze({ host: "127.0.0.1", port: 0, tlsTermination: "loopback-cleartext" }),
    Object.freeze({ host: "127.0.0.1", port: 8080, tlsTermination: "railway-edge" }),
    Object.freeze({ host: "0.0.0.0", port: 8080, tlsTermination: "loopback-cleartext" }),
  ])("rejects the invalid configuration %#", async (configuration) => {
    await expectHostError(
      startIngestHost(configuration, createDependencies()),
      "configuration_invalid",
    );
  });

  it("contains hostile configuration traps", async () => {
    const hostile = new Proxy(Object.freeze({}), {
      getPrototypeOf() {
        throw new Error("private-config-value");
      },
    });

    await expectHostError(startIngestHost(hostile, createDependencies()), "configuration_invalid");
  });

  it.each([
    null,
    [],
    { createApplication: async () => createApplication(), createServer: () => createServer() },
    Object.freeze({ createApplication: async () => createApplication() }),
    Object.freeze({ createApplication: true, createServer: () => createServer() }),
  ])("rejects invalid dependencies %#", async (dependencies) => {
    await expectHostError(startIngestHost(loopbackConfig, dependencies), "dependencies_invalid");
  });

  it("contains hostile dependency traps", async () => {
    const hostile = new Proxy(Object.freeze({}), {
      ownKeys() {
        throw new Error("private-dependency-value");
      },
    });

    await expectHostError(startIngestHost(loopbackConfig, hostile), "dependencies_invalid");
  });

  it("maps application construction failure to one bounded error", async () => {
    const dependencies = createDependencies();
    dependencies.createApplication.mockRejectedValueOnce(new Error("private-database-value"));

    await expectHostError(
      startIngestHost(loopbackConfig, dependencies),
      "application_start_failed",
    );
    expect(dependencies.createServer).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    {
      close: async (): Promise<void> => undefined,
      execute: async (): Promise<void> => undefined,
    },
    Object.freeze({ close: async (): Promise<void> => undefined }),
    Object.freeze({ close: true, execute: async (): Promise<void> => undefined }),
  ])("rejects an invalid configured application %#", async (application) => {
    await expectHostError(
      startIngestHost(loopbackConfig, createDependencies(application)),
      "application_invalid",
    );
  });

  it("contains hostile application traps", async () => {
    const hostile = new Proxy(Object.freeze({}), {
      ownKeys() {
        throw new Error("private-application-value");
      },
    });

    await expectHostError(
      startIngestHost(loopbackConfig, createDependencies(hostile)),
      "application_invalid",
    );
  });

  it("closes the application if server construction fails", async () => {
    const application = createApplication();
    const dependencies = createDependencies(application);
    dependencies.createServer.mockImplementationOnce(() => {
      throw new Error("private-server-value");
    });

    await expectHostError(startIngestHost(loopbackConfig, dependencies), "server_creation_failed");
    expect(application.close).toHaveBeenCalledTimes(1);
  });

  it("does not replace the server-construction result with a cleanup exception", async () => {
    const application = createApplication(vi.fn(async () => Promise.reject(new Error("close"))));
    const dependencies = createDependencies(application);
    dependencies.createServer.mockImplementationOnce(() => {
      throw new Error("create");
    });

    await expectHostError(startIngestHost(loopbackConfig, dependencies), "server_creation_failed");
  });

  it.each([
    null,
    [],
    {},
    { close: async () => undefined },
    { close: true, listen: async () => "" },
  ])("closes the application after an invalid server result %#", async (server) => {
    const application = createApplication();
    await expectHostError(
      startIngestHost(loopbackConfig, createDependencies(application, server)),
      "server_invalid",
    );
    expect(application.close).toHaveBeenCalledTimes(1);
  });

  it("contains hostile server traps before listening", async () => {
    const application = createApplication();
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error("private-server-value");
        },
      },
    );

    await expectHostError(
      startIngestHost(loopbackConfig, createDependencies(application, hostile)),
      "server_invalid",
    );
    expect(application.close).toHaveBeenCalledTimes(1);
  });

  it("reports cleanup failure while rejecting an invalid server", async () => {
    const application = createApplication(vi.fn(async () => Promise.reject(new Error("close"))));

    await expectHostError(
      startIngestHost(loopbackConfig, createDependencies(application, {})),
      "cleanup_failed",
    );
  });

  it("closes a server whose listener fails and contains cleanup detail", async () => {
    const server = createServer({
      close: vi.fn(async () => Promise.reject(new Error("private-close-value"))),
      listen: vi.fn(async () => Promise.reject(new Error("private-listen-value"))),
    });

    await expectHostError(
      startIngestHost(loopbackConfig, createDependencies(createApplication(), server)),
      "listen_failed",
    );
    expect(server.close).toHaveBeenCalledTimes(1);
  });

  it("maps shutdown failure without attaching the server exception", async () => {
    const server = createServer({
      close: vi.fn(async () => Promise.reject(new Error("private-close-value"))),
    });
    const controller = await startIngestHost(
      loopbackConfig,
      createDependencies(createApplication(), server),
    );

    await expectHostError(controller.close(), "shutdown_failed");
    await expectHostError(controller.close(), "shutdown_failed");
    expect(server.close).toHaveBeenCalledTimes(1);
  });
});

describe("startConfiguredIngestHost", () => {
  it("refuses before protected application configuration while Ingest is disabled", async () => {
    const environment = new Proxy(
      {},
      {
        getOwnPropertyDescriptor(_target, key) {
          if (key === "VIBERACING_INGEST_ENABLED") {
            return { configurable: true, enumerable: true, value: "false" };
          }
          throw new Error("private-environment-value");
        },
      },
    );

    await expect(startConfiguredIngestHost(environment)).rejects.toMatchObject({
      code: "ingest_disabled",
      message: "Ingest host configuration is invalid.",
    });
  });

  it("composes the real protected configuration, database pool, HTTP factory, and listener", async () => {
    const environment = Object.freeze({
      NODE_ENV: "test",
      VIBERACING_INGEST_ENABLED: "true",
      VIBERACING_INGEST_DATABASE_HOST: "127.0.0.1",
      VIBERACING_INGEST_DATABASE_NAME: "viberacing_local",
      VIBERACING_INGEST_DATABASE_PASSWORD: "synthetic-test-only",
      VIBERACING_INGEST_DATABASE_PORT: "54329",
      VIBERACING_INGEST_DATABASE_TLS_MODE: "disable",
      VIBERACING_INGEST_DATABASE_USER: "synthetic_ingest_login",
      VIBERACING_INGEST_LISTENER_HOST: "127.0.0.1",
      VIBERACING_INGEST_LISTENER_PORT: "0",
      VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_BASE64URL: Buffer.alloc(32, 7).toString("base64url"),
      VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_ID: "edge_synthetic",
      VIBERACING_INGEST_TLS_TERMINATION: "loopback-cleartext",
    });

    const controller = await startConfiguredIngestHost(environment);

    await controller.close();
  });
});
