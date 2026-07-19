import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveEnrollmentEnableConfig } from "./enrollment-enable-config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("enrollment enable configuration", () => {
  it("accepts only the exact enable value and returns a frozen decision", () => {
    const config = resolveEnrollmentEnableConfig({ VIBERACING_ENROLLMENT_ENABLED: "true" });

    expect(config).toEqual({ enabled: true });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it.each([undefined, "", "false", "TRUE", "1", "enabled"])(
    "keeps enrollment disabled for the value %s",
    (value) => {
      expect(resolveEnrollmentEnableConfig({ VIBERACING_ENROLLMENT_ENABLED: value })).toEqual({
        enabled: false,
      });
    },
  );

  it.each([null, "environment", 1, [], {}])(
    "keeps enrollment disabled for the unreadable environment %#",
    (environment) => {
      expect(resolveEnrollmentEnableConfig(environment)).toEqual({ enabled: false });
    },
  );

  it("rejects inherited, accessor-backed, hidden, and non-string enable values", () => {
    const inherited: unknown = Object.create({ VIBERACING_ENROLLMENT_ENABLED: "true" });
    const accessor = {};
    Object.defineProperty(accessor, "VIBERACING_ENROLLMENT_ENABLED", {
      enumerable: true,
      get: () => "true",
    });
    const hidden = {};
    Object.defineProperty(hidden, "VIBERACING_ENROLLMENT_ENABLED", {
      enumerable: false,
      value: "true",
    });

    expect(resolveEnrollmentEnableConfig(inherited)).toEqual({ enabled: false });
    expect(resolveEnrollmentEnableConfig(accessor)).toEqual({ enabled: false });
    expect(resolveEnrollmentEnableConfig(hidden)).toEqual({ enabled: false });
    expect(resolveEnrollmentEnableConfig({ VIBERACING_ENROLLMENT_ENABLED: true })).toEqual({
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
          if (key === "VIBERACING_ENROLLMENT_ENABLED") {
            return { configurable: true, enumerable: true, value: "true" };
          }
          throw new Error("private-environment-value");
        },
      },
    );

    expect(resolveEnrollmentEnableConfig(trapped)).toEqual({ enabled: false });
    expect(resolveEnrollmentEnableConfig(exactOnly)).toEqual({ enabled: true });
  });

  it("reads the real process environment only through the server configuration boundary", () => {
    vi.stubEnv("VIBERACING_ENROLLMENT_ENABLED", "true");

    expect(resolveEnrollmentEnableConfig()).toEqual({ enabled: true });
  });
});
