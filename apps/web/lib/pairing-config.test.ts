import { afterEach, describe, expect, it, vi } from "vitest";

import { resolvePairingConfig } from "./pairing-config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("pairing configuration", () => {
  it("accepts only the exact enable value and returns a frozen decision", () => {
    const config = resolvePairingConfig({ VIBERACING_PAIRING_ENABLED: "true" });

    expect(config).toEqual({ enabled: true });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it.each([undefined, "", "false", "TRUE", "1", "enabled"])(
    "keeps pairing disabled for the value %s",
    (value) => {
      expect(resolvePairingConfig({ VIBERACING_PAIRING_ENABLED: value })).toEqual({
        enabled: false,
      });
    },
  );

  it.each([null, "environment", 1, [], {}])(
    "keeps pairing disabled for the unreadable environment %#",
    (environment) => {
      expect(resolvePairingConfig(environment)).toEqual({ enabled: false });
    },
  );

  it("rejects inherited, accessor-backed, hidden, and non-string enable values", () => {
    const inherited: unknown = Object.create({ VIBERACING_PAIRING_ENABLED: "true" });
    const accessor = {};
    Object.defineProperty(accessor, "VIBERACING_PAIRING_ENABLED", {
      enumerable: true,
      get: () => "true",
    });
    const hidden = {};
    Object.defineProperty(hidden, "VIBERACING_PAIRING_ENABLED", {
      enumerable: false,
      value: "true",
    });

    expect(resolvePairingConfig(inherited)).toEqual({ enabled: false });
    expect(resolvePairingConfig(accessor)).toEqual({ enabled: false });
    expect(resolvePairingConfig(hidden)).toEqual({ enabled: false });
    expect(resolvePairingConfig({ VIBERACING_PAIRING_ENABLED: true })).toEqual({
      enabled: false,
    });
  });

  it("contains descriptor traps without inspecting another environment field", () => {
    const trapped = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error("private-environment-value");
        },
      },
    );
    const exactOnly = new Proxy(
      {},
      {
        getOwnPropertyDescriptor(_target, key) {
          if (key === "VIBERACING_PAIRING_ENABLED") {
            return { configurable: true, enumerable: true, value: "true" };
          }
          throw new Error("private-environment-value");
        },
      },
    );

    expect(resolvePairingConfig(trapped)).toEqual({ enabled: false });
    expect(resolvePairingConfig(exactOnly)).toEqual({ enabled: true });
  });

  it("reads the real process environment only through the server configuration boundary", () => {
    vi.stubEnv("VIBERACING_PAIRING_ENABLED", "true");

    expect(resolvePairingConfig()).toEqual({ enabled: true });
  });
});
