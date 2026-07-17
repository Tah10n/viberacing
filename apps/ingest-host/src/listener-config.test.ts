import { afterEach, describe, expect, it, vi } from "vitest";

import {
  IngestHostConfigurationError,
  ingestHostMinimumRailwayDrainSeconds,
  resolveIngestHostConfig,
  type IngestHostConfigurationErrorCode,
} from "./listener-config.js";

const localEnvironment = Object.freeze({
  NODE_ENV: "development",
  VIBERACING_INGEST_LISTENER_HOST: "127.0.0.1",
  VIBERACING_INGEST_LISTENER_PORT: "8788",
  VIBERACING_INGEST_TLS_TERMINATION: "loopback-cleartext",
});

const productionEnvironment = Object.freeze({
  NODE_ENV: "production",
  PORT: "8080",
  RAILWAY_DEPLOYMENT_DRAINING_SECONDS: "40",
  VIBERACING_INGEST_LISTENER_HOST: "0.0.0.0",
  VIBERACING_INGEST_TLS_TERMINATION: "railway-edge",
});

function replace(
  base: Readonly<Record<string, string | undefined>>,
  override: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({ ...base, ...override });
}

function expectConfigurationError(
  environment: unknown,
  code: IngestHostConfigurationErrorCode,
): void {
  try {
    resolveIngestHostConfig(environment);
    throw new Error("Expected configuration to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(IngestHostConfigurationError);
    expect(error).toMatchObject({ code, message: "Ingest host configuration is invalid." });
    expect(error).not.toHaveProperty("cause");
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveIngestHostConfig", () => {
  it("returns a frozen loopback-only development configuration", () => {
    const config = resolveIngestHostConfig(localEnvironment);

    expect(config).toEqual({
      host: "127.0.0.1",
      port: 8788,
      tlsTermination: "loopback-cleartext",
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("accepts IPv6 loopback and an ephemeral port only in explicit test mode", () => {
    expect(
      resolveIngestHostConfig(
        replace(localEnvironment, {
          NODE_ENV: "test",
          VIBERACING_INGEST_LISTENER_HOST: "::1",
          VIBERACING_INGEST_LISTENER_PORT: "0",
        }),
      ),
    ).toEqual({ host: "::1", port: 0, tlsTermination: "loopback-cleartext" });
  });

  it("uses only Railway PORT and an explicit external TLS contract in production", () => {
    const config = resolveIngestHostConfig(productionEnvironment);

    expect(config).toEqual({ host: "0.0.0.0", port: 8080, tlsTermination: "railway-edge" });
    expect(ingestHostMinimumRailwayDrainSeconds).toBe(40);
  });

  it("reads the real process environment only through this boundary", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VIBERACING_INGEST_LISTENER_HOST", "127.0.0.1");
    vi.stubEnv("VIBERACING_INGEST_LISTENER_PORT", "0");
    vi.stubEnv("VIBERACING_INGEST_TLS_TERMINATION", "loopback-cleartext");

    expect(resolveIngestHostConfig()).toEqual({
      host: "127.0.0.1",
      port: 0,
      tlsTermination: "loopback-cleartext",
    });
  });

  it.each([undefined, "", "staging"])("rejects the NODE_ENV value %s", (value) => {
    expectConfigurationError(
      replace(localEnvironment, { NODE_ENV: value }),
      "node_environment_invalid",
    );
  });

  it.each([undefined, "", "0.0.0.0", "localhost"])(
    "rejects the local listener host %s",
    (value) => {
      expectConfigurationError(
        replace(localEnvironment, { VIBERACING_INGEST_LISTENER_HOST: value }),
        "host_invalid",
      );
    },
  );

  it.each([undefined, "", "disabled", "railway-edge"])(
    "rejects the local TLS termination value %s",
    (value) => {
      expectConfigurationError(
        replace(localEnvironment, { VIBERACING_INGEST_TLS_TERMINATION: value }),
        "tls_termination_invalid",
      );
    },
  );

  it.each([undefined, "", "00", "-1", "0", "65536", "100000"])(
    "rejects the development port %s",
    (value) => {
      expectConfigurationError(
        replace(localEnvironment, { VIBERACING_INGEST_LISTENER_PORT: value }),
        "port_invalid",
      );
    },
  );

  it.each(["127.0.0.1", "::", "ingest.example"])(
    "rejects the production listener host %s",
    (value) => {
      expectConfigurationError(
        replace(productionEnvironment, { VIBERACING_INGEST_LISTENER_HOST: value }),
        "host_invalid",
      );
    },
  );

  it.each([undefined, "", "loopback-cleartext", "platform"])(
    "rejects the production TLS termination value %s",
    (value) => {
      expectConfigurationError(
        replace(productionEnvironment, { VIBERACING_INGEST_TLS_TERMINATION: value }),
        "tls_termination_invalid",
      );
    },
  );

  it("rejects an ambiguous local port field in production", () => {
    expectConfigurationError(
      replace(productionEnvironment, { VIBERACING_INGEST_LISTENER_PORT: "8080" }),
      "port_invalid",
    );
  });

  it.each([undefined, "", "00", "0", "65536", "100000"])("rejects the Railway port %s", (value) => {
    expectConfigurationError(replace(productionEnvironment, { PORT: value }), "port_invalid");
  });

  it.each([undefined, "", "039", "0", "39", "301", "1000"])(
    "rejects the Railway drain window %s",
    (value) => {
      expectConfigurationError(
        replace(productionEnvironment, { RAILWAY_DEPLOYMENT_DRAINING_SECONDS: value }),
        "railway_drain_invalid",
      );
    },
  );

  it("accepts the upper reviewed Railway drain bound", () => {
    expect(
      resolveIngestHostConfig(
        replace(productionEnvironment, { RAILWAY_DEPLOYMENT_DRAINING_SECONDS: "300" }),
      ),
    ).toMatchObject({ port: 8080 });
  });

  it.each([null, "environment", 1])("rejects a non-object environment value", (value) => {
    expectConfigurationError(value, "environment_unreadable");
  });

  it("treats an own undefined value as absent", () => {
    expectConfigurationError(
      replace(localEnvironment, { VIBERACING_INGEST_LISTENER_PORT: undefined }),
      "port_invalid",
    );
  });

  it("rejects accessor-backed, non-enumerable, and non-string values", () => {
    const accessor = { ...localEnvironment };
    Object.defineProperty(accessor, "NODE_ENV", { enumerable: true, get: () => "development" });
    expectConfigurationError(accessor, "environment_unreadable");

    const hidden = { ...localEnvironment };
    Object.defineProperty(hidden, "NODE_ENV", { enumerable: false, value: "development" });
    expectConfigurationError(hidden, "environment_unreadable");

    expectConfigurationError(replace(localEnvironment, { NODE_ENV: 7 }), "environment_unreadable");
  });

  it("contains hostile descriptor traps without reflecting submitted values", () => {
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error("private-environment-value");
        },
      },
    );

    try {
      resolveIngestHostConfig(hostile);
      throw new Error("Expected configuration to fail.");
    } catch (error) {
      expect(error).toMatchObject({ code: "environment_unreadable" });
      expect(String(error)).not.toContain("private-environment-value");
    }
  });
});
