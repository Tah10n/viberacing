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
  const readSession = vi.fn();

  beforeEach(() => {
    dependencies.headers.mockResolvedValue(
      new Headers({ cookie: `${enrollmentCookieNames.session}=opaque-session` }),
    );
    dependencies.getEnrollmentRuntime.mockReturnValue({
      service: { readSession },
    });
    readSession.mockReturnValue(session);
  });

  it("returns only the exact passkey session for batch pairing", async () => {
    await expect(readEnrollmentPageConnect()).resolves.toEqual({ session });
    expect(readSession).toHaveBeenCalledWith("opaque-session");
  });

  it("fails closed without a valid session", async () => {
    readSession.mockReturnValue(undefined);

    await expect(readEnrollmentPageConnect()).resolves.toBeUndefined();
  });
});

describe("account page session", () => {
  const readAccountDashboard = vi.fn();
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
        readAccountDashboard,
        readPasskeyInventory,
        readSession,
      },
    });
    readSession.mockReturnValue(session);
    readPasskeyInventory.mockResolvedValue(Object.freeze([]));
    readAccountDashboard.mockResolvedValue(
      Object.freeze({
        accounts: Object.freeze([]),
        installations: Object.freeze([]),
        ranking: Object.freeze({
          participantCount: 0,
          providerBreakdownVisible: false,
          publicVisibility: "public",
          rankPosition: null,
          seasonEnd: "2026-07-19",
          seasonStart: "2026-07-13",
          seasonState: "open",
          snapshotGeneratedAt: "2026-07-16T10:00Z",
          weeklyTokenTotal: "0",
        }),
      }),
    );
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

  it("composes the session-owned CarRecipe state with the private dashboard", async () => {
    const result = await readEnrollmentPageAccount();

    expect(result).toMatchObject({
      carRecipeState: {
        active: null,
        proposal: {
          control: "opaque-proposal-control",
          recipe: { schemaVersion: 1, chassis: "rally", seed: 42 },
        },
      },
      dashboard: {
        accounts: [],
        installations: [],
        ranking: {
          publicVisibility: "public",
          weeklyTokenTotal: "0",
        },
      },
      passkeys: [],
      session,
    });
    expect(readCarRecipeState).toHaveBeenCalledWith("opaque-session");
    expect(readAccountDashboard).toHaveBeenCalledWith("opaque-session");
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("fails closed when the protected recipe state cannot be read", async () => {
    readCarRecipeState.mockRejectedValue(new Error("synthetic dependency failure"));
    await expect(readEnrollmentPageAccount()).resolves.toBeUndefined();
  });
});
