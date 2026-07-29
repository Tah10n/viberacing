import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveInviteGateConfig } from "./invite-gate-config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("optional invite gate configuration", () => {
  it("accepts only exact explicit enablement", () => {
    const config = resolveInviteGateConfig({ VIBERACING_INVITE_GATE_ENABLED: "true" });

    expect(config).toEqual({ enabled: true });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it.each([undefined, "", "false", "TRUE", "1", true, null, {}])(
    "defaults the invite policy off for %#",
    (value) => {
      const environment =
        value !== null && typeof value === "object"
          ? value
          : { VIBERACING_INVITE_GATE_ENABLED: value };
      expect(resolveInviteGateConfig(environment)).toEqual({ enabled: false });
    },
  );

  it("rejects inherited, accessor-backed, hidden, and trapped values", () => {
    const inherited: unknown = Object.create({ VIBERACING_INVITE_GATE_ENABLED: "true" });
    const accessor = {};
    Object.defineProperty(accessor, "VIBERACING_INVITE_GATE_ENABLED", {
      enumerable: true,
      get: () => "true",
    });
    const hidden = {};
    Object.defineProperty(hidden, "VIBERACING_INVITE_GATE_ENABLED", {
      enumerable: false,
      value: "true",
    });
    const trapped = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error("private-environment-value");
        },
      },
    );

    for (const environment of [inherited, accessor, hidden, trapped]) {
      expect(resolveInviteGateConfig(environment)).toEqual({ enabled: false });
    }
  });

  it("reads the real environment only through this server boundary", () => {
    vi.stubEnv("VIBERACING_INVITE_GATE_ENABLED", "true");

    expect(resolveInviteGateConfig()).toEqual({ enabled: true });
  });
});
