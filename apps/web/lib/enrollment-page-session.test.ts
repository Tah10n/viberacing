import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EnrollmentSession } from "./enrollment-domain";
import { enrollmentCookieNames } from "./enrollment-service";

const dependencies = vi.hoisted(() => ({
  getEnrollmentRuntime: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: dependencies.headers }));
vi.mock("./enrollment-runtime", () => ({
  getEnrollmentRuntime: dependencies.getEnrollmentRuntime,
}));

import { readEnrollmentPageAccount, readEnrollmentPageConnect } from "./enrollment-page-session";

const session: EnrollmentSession = Object.freeze({
  expiresAt: 1_800_000_000,
  handle: "pixel_driver",
  locale: "en",
  passkeyRegistered: true,
  profileId: "00000000-0000-4000-8000-000000000101",
  sessionId: "00000000-0000-4000-8000-000000000201",
  sessionVerifier: Buffer.alloc(32, 0x61).toString("base64url"),
  version: 1,
});

describe("connect page session", () => {
  const readActiveDeviceInventory = vi.fn();
  const readSession = vi.fn();

  beforeEach(() => {
    dependencies.headers.mockResolvedValue(
      new Headers({ cookie: `${enrollmentCookieNames.session}=opaque-session` }),
    );
    dependencies.getEnrollmentRuntime.mockReturnValue({
      service: { readActiveDeviceInventory, readSession },
    });
    readSession.mockReturnValue(session);
  });

  it("reads the exact passkey session inventory for existing-source choices", async () => {
    const inventory = Object.freeze([
      Object.freeze({
        devices: Object.freeze([]),
        sourceControl: "opaque-source-control",
        state: "active" as const,
      }),
    ]);
    readActiveDeviceInventory.mockResolvedValue(inventory);

    await expect(readEnrollmentPageConnect()).resolves.toEqual({
      activeDeviceInventory: inventory,
      session,
    });
    expect(readSession).toHaveBeenCalledWith("opaque-session");
    expect(readActiveDeviceInventory).toHaveBeenCalledWith("opaque-session");
  });

  it("keeps the valid session when existing-source inventory is unavailable", async () => {
    readActiveDeviceInventory.mockRejectedValue(new Error("synthetic dependency failure"));

    await expect(readEnrollmentPageConnect()).resolves.toEqual({
      activeDeviceInventory: undefined,
      session,
    });
  });

  it("does not read inventory without a valid session", async () => {
    readSession.mockReturnValue(undefined);

    await expect(readEnrollmentPageConnect()).resolves.toBeUndefined();
    expect(readActiveDeviceInventory).not.toHaveBeenCalled();
  });
});

describe("account page session", () => {
  const readAccountOverview = vi.fn();
  const readActiveDeviceInventory = vi.fn();
  const readCarRecipeState = vi.fn();
  const readPasskeyInventory = vi.fn();
  const readSession = vi.fn();

  beforeEach(() => {
    dependencies.headers.mockResolvedValue(
      new Headers({ cookie: `${enrollmentCookieNames.session}=opaque-session` }),
    );
    dependencies.getEnrollmentRuntime.mockReturnValue({
      carProposalService: { read: readCarRecipeState },
      service: {
        readAccountOverview,
        readActiveDeviceInventory,
        readPasskeyInventory,
        readSession,
      },
    });
    readSession.mockReturnValue(session);
    readActiveDeviceInventory.mockResolvedValue(Object.freeze([]));
    readPasskeyInventory.mockResolvedValue(Object.freeze([]));
    readAccountOverview.mockResolvedValue({ score: null, visibility: "public" });
    readCarRecipeState.mockResolvedValue(
      Object.freeze({
        active: null,
        proposal: Object.freeze({
          control: "opaque-proposal-control",
          recipe: Object.freeze({
            schemaVersion: 1,
            chassis: "rally",
            nose: "scoop",
            cockpit: "rally",
            wing: "low",
            wheels: "all-terrain",
            palette: "sunburst",
            trail: "spark",
            seed: 42,
          }),
        }),
      }),
    );
  });

  it("composes the session-owned CarRecipe state with the existing account inventory", async () => {
    const result = await readEnrollmentPageAccount();

    expect(result).toMatchObject({
      carRecipeState: {
        active: null,
        proposal: {
          control: "opaque-proposal-control",
          recipe: { schemaVersion: 1, chassis: "rally", seed: 42 },
        },
      },
      passkeys: [],
      score: null,
      session,
      visibility: "public",
    });
    expect(readCarRecipeState).toHaveBeenCalledWith("opaque-session");
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("fails closed when the protected recipe state cannot be read", async () => {
    readCarRecipeState.mockRejectedValue(new Error("synthetic dependency failure"));
    await expect(readEnrollmentPageAccount()).resolves.toBeUndefined();
  });
});
