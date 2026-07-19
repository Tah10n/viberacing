import { afterEach, describe, expect, it, vi } from "vitest";

import { resolvePublicRankingConfig } from "./public-ranking-config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public ranking configuration", () => {
  it("accepts only the exact enable value and returns a frozen decision", () => {
    const config = resolvePublicRankingConfig({ VIBERACING_PUBLIC_RANKING_ENABLED: "true" });

    expect(config).toEqual({ enabled: true });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it.each([undefined, "", "false", "TRUE", "1", "enabled"])(
    "keeps public ranking disabled for the value %s",
    (value) => {
      expect(resolvePublicRankingConfig({ VIBERACING_PUBLIC_RANKING_ENABLED: value })).toEqual({
        enabled: false,
      });
    },
  );

  it.each([null, "environment", 1, [], {}])(
    "keeps public ranking disabled for the unreadable environment %#",
    (environment) => {
      expect(resolvePublicRankingConfig(environment)).toEqual({ enabled: false });
    },
  );

  it("rejects inherited, accessor-backed, hidden, and non-string enable values", () => {
    const inherited: unknown = Object.create({ VIBERACING_PUBLIC_RANKING_ENABLED: "true" });
    const accessor = {};
    Object.defineProperty(accessor, "VIBERACING_PUBLIC_RANKING_ENABLED", {
      enumerable: true,
      get: () => "true",
    });
    const hidden = {};
    Object.defineProperty(hidden, "VIBERACING_PUBLIC_RANKING_ENABLED", {
      enumerable: false,
      value: "true",
    });

    expect(resolvePublicRankingConfig(inherited)).toEqual({ enabled: false });
    expect(resolvePublicRankingConfig(accessor)).toEqual({ enabled: false });
    expect(resolvePublicRankingConfig(hidden)).toEqual({ enabled: false });
    expect(resolvePublicRankingConfig({ VIBERACING_PUBLIC_RANKING_ENABLED: true })).toEqual({
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
          if (key === "VIBERACING_PUBLIC_RANKING_ENABLED") {
            return { configurable: true, enumerable: true, value: "true" };
          }
          throw new Error("private-environment-value");
        },
      },
    );

    expect(resolvePublicRankingConfig(trapped)).toEqual({ enabled: false });
    expect(resolvePublicRankingConfig(exactOnly)).toEqual({ enabled: true });
  });

  it("reads the real process environment only through the server configuration boundary", () => {
    vi.stubEnv("VIBERACING_PUBLIC_RANKING_ENABLED", "true");

    expect(resolvePublicRankingConfig()).toEqual({ enabled: true });
  });
});
