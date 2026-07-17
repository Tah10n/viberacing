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

import { readEnrollmentPageConnect } from "./enrollment-page-session";

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
