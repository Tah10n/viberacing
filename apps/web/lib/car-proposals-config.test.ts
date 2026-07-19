import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveCarProposalsConfig } from "./car-proposals-config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("CarRecipe proposal configuration", () => {
  it("accepts only the exact enable value and returns a frozen decision", () => {
    const config = resolveCarProposalsConfig({ VIBERACING_CAR_PROPOSALS_ENABLED: "true" });

    expect(config).toEqual({ enabled: true });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it.each([undefined, "", "false", "TRUE", "1", "enabled"])(
    "keeps CarRecipe proposals disabled for the value %s",
    (value) => {
      expect(resolveCarProposalsConfig({ VIBERACING_CAR_PROPOSALS_ENABLED: value })).toEqual({
        enabled: false,
      });
    },
  );

  it.each([null, "environment", 1, [], {}])(
    "keeps CarRecipe proposals disabled for the unreadable environment %#",
    (environment) => {
      expect(resolveCarProposalsConfig(environment)).toEqual({ enabled: false });
    },
  );

  it("rejects inherited, accessor-backed, hidden, and non-string enable values", () => {
    const inherited: unknown = Object.create({ VIBERACING_CAR_PROPOSALS_ENABLED: "true" });
    const accessor = {};
    Object.defineProperty(accessor, "VIBERACING_CAR_PROPOSALS_ENABLED", {
      enumerable: true,
      get: () => "true",
    });
    const hidden = {};
    Object.defineProperty(hidden, "VIBERACING_CAR_PROPOSALS_ENABLED", {
      enumerable: false,
      value: "true",
    });

    expect(resolveCarProposalsConfig(inherited)).toEqual({ enabled: false });
    expect(resolveCarProposalsConfig(accessor)).toEqual({ enabled: false });
    expect(resolveCarProposalsConfig(hidden)).toEqual({ enabled: false });
    expect(resolveCarProposalsConfig({ VIBERACING_CAR_PROPOSALS_ENABLED: true })).toEqual({
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
          if (key === "VIBERACING_CAR_PROPOSALS_ENABLED") {
            return { configurable: true, enumerable: true, value: "true" };
          }
          throw new Error("private-environment-value");
        },
      },
    );

    expect(resolveCarProposalsConfig(trapped)).toEqual({ enabled: false });
    expect(resolveCarProposalsConfig(exactOnly)).toEqual({ enabled: true });
  });

  it("reads the real process environment only through the server configuration boundary", () => {
    vi.stubEnv("VIBERACING_CAR_PROPOSALS_ENABLED", "true");

    expect(resolveCarProposalsConfig()).toEqual({ enabled: true });
  });
});
