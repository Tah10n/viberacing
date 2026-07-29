import { isValidElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const pageMock = vi.hoisted(() => ({
  readEnrollmentPageAccount: vi.fn(() =>
    Promise.resolve({
      carRecipeState: { active: null, proposal: null },
      dashboard: undefined,
      passkeys: [],
      session: {
        expiresAt: 2_000_000_000,
        handle: "pixel_driver",
        locale: "en" as const,
        passkeyRegistered: true,
        profileId: "00000000-0000-4000-8000-000000000101",
        sessionId: "00000000-0000-4000-8000-000000000201",
        sessionVerifier: "A".repeat(43),
        version: 1 as const,
      },
    }),
  ),
}));

vi.mock("@/lib/enrollment-page-session", () => pageMock);
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("redirect-must-not-run");
  }),
}));

describe("account page CarRecipe proposal entrypoint", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    pageMock.readEnrollmentPageAccount.mockClear();
  });

  it.each([
    ["false", false],
    ["true", true],
  ] as const)(
    "forwards environment value %s as the literal decision %s",
    async (value, expected) => {
      vi.stubEnv("VIBERACING_CAR_PROPOSALS_ENABLED", value);
      const page = await import("./page");
      const element = await page.default({ searchParams: Promise.resolve({}) });

      expect(isValidElement<{ carProposalsEnabled: boolean }>(element)).toBe(true);
      if (!isValidElement<{ carProposalsEnabled: boolean }>(element)) {
        throw new Error("expected the account experience element");
      }
      expect(element.props.carProposalsEnabled).toBe(expected);
      expect(pageMock.readEnrollmentPageAccount).toHaveBeenCalledOnce();
    },
  );
});
