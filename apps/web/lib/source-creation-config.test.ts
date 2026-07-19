import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSourceCreationConfig } from "./source-creation-config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("source-creation configuration", () => {
  it("accepts only the exact enable value and returns a frozen decision", () => {
    const config = resolveSourceCreationConfig({ VIBERACING_SOURCE_CREATION_ENABLED: "true" });

    expect(config).toEqual({ enabled: true });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it.each([undefined, "", "false", "TRUE", "1", "enabled"])(
    "keeps source creation disabled for the value %s",
    (value) => {
      expect(resolveSourceCreationConfig({ VIBERACING_SOURCE_CREATION_ENABLED: value })).toEqual({
        enabled: false,
      });
    },
  );

  it.each([null, "environment", 1, [], {}])(
    "keeps source creation disabled for the unreadable environment %#",
    (environment) => {
      expect(resolveSourceCreationConfig(environment)).toEqual({ enabled: false });
    },
  );

  it("rejects inherited, accessor-backed, hidden, and non-string enable values", () => {
    const inherited: unknown = Object.create({ VIBERACING_SOURCE_CREATION_ENABLED: "true" });
    const accessor = {};
    Object.defineProperty(accessor, "VIBERACING_SOURCE_CREATION_ENABLED", {
      enumerable: true,
      get: () => "true",
    });
    const hidden = {};
    Object.defineProperty(hidden, "VIBERACING_SOURCE_CREATION_ENABLED", {
      enumerable: false,
      value: "true",
    });

    expect(resolveSourceCreationConfig(inherited)).toEqual({ enabled: false });
    expect(resolveSourceCreationConfig(accessor)).toEqual({ enabled: false });
    expect(resolveSourceCreationConfig(hidden)).toEqual({ enabled: false });
    expect(resolveSourceCreationConfig({ VIBERACING_SOURCE_CREATION_ENABLED: true })).toEqual({
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
          if (key === "VIBERACING_SOURCE_CREATION_ENABLED") {
            return { configurable: true, enumerable: true, value: "true" };
          }
          throw new Error("private-environment-value");
        },
      },
    );

    expect(resolveSourceCreationConfig(trapped)).toEqual({ enabled: false });
    expect(resolveSourceCreationConfig(exactOnly)).toEqual({ enabled: true });
  });

  it("reads the real process environment only through the server configuration boundary", () => {
    vi.stubEnv("VIBERACING_SOURCE_CREATION_ENABLED", "true");

    expect(resolveSourceCreationConfig()).toEqual({ enabled: true });
  });
});
