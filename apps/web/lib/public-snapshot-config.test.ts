import { afterEach, describe, expect, it, vi } from "vitest";

import { resolvePublicSnapshotConfig } from "./public-snapshot-config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public snapshot configuration", () => {
  it("accepts only the exact enable value and returns a frozen decision", () => {
    const config = resolvePublicSnapshotConfig({ VIBERACING_PUBLIC_SNAPSHOTS_ENABLED: "true" });

    expect(config).toEqual({ enabled: true });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it.each([undefined, "", "false", "TRUE", "1", "enabled"])(
    "keeps public snapshots disabled for the value %s",
    (value) => {
      expect(resolvePublicSnapshotConfig({ VIBERACING_PUBLIC_SNAPSHOTS_ENABLED: value })).toEqual({
        enabled: false,
      });
    },
  );

  it.each([null, "environment", 1, [], {}])(
    "keeps public snapshots disabled for the unreadable environment %#",
    (environment) => {
      expect(resolvePublicSnapshotConfig(environment)).toEqual({ enabled: false });
    },
  );

  it("rejects inherited, accessor-backed, hidden, and non-string enable values", () => {
    const inherited: unknown = Object.create({ VIBERACING_PUBLIC_SNAPSHOTS_ENABLED: "true" });
    const accessor = {};
    Object.defineProperty(accessor, "VIBERACING_PUBLIC_SNAPSHOTS_ENABLED", {
      enumerable: true,
      get: () => "true",
    });
    const hidden = {};
    Object.defineProperty(hidden, "VIBERACING_PUBLIC_SNAPSHOTS_ENABLED", {
      enumerable: false,
      value: "true",
    });

    expect(resolvePublicSnapshotConfig(inherited)).toEqual({ enabled: false });
    expect(resolvePublicSnapshotConfig(accessor)).toEqual({ enabled: false });
    expect(resolvePublicSnapshotConfig(hidden)).toEqual({ enabled: false });
    expect(resolvePublicSnapshotConfig({ VIBERACING_PUBLIC_SNAPSHOTS_ENABLED: true })).toEqual({
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
          if (key === "VIBERACING_PUBLIC_SNAPSHOTS_ENABLED") {
            return { configurable: true, enumerable: true, value: "true" };
          }
          throw new Error("private-environment-value");
        },
      },
    );

    expect(resolvePublicSnapshotConfig(trapped)).toEqual({ enabled: false });
    expect(resolvePublicSnapshotConfig(exactOnly)).toEqual({ enabled: true });
  });

  it("reads the real process environment only through the server configuration boundary", () => {
    vi.stubEnv("VIBERACING_PUBLIC_SNAPSHOTS_ENABLED", "true");

    expect(resolvePublicSnapshotConfig()).toEqual({ enabled: true });
  });
});
