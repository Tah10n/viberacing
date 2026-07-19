import { isValidElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const pageMock = vi.hoisted(() => ({
  readEnrollmentPageSession: vi.fn<() => Promise<unknown>>(() =>
    Promise.resolve({
      handle: "pixel_driver",
      locale: "en" as const,
      passkeyRegistered: false,
    }),
  ),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("@/lib/enrollment-page-session", () => ({
  readEnrollmentPageSession: pageMock.readEnrollmentPageSession,
}));
vi.mock("next/navigation", () => ({ redirect: pageMock.redirect }));

describe("initial passkey page enrollment entrypoint", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    pageMock.readEnrollmentPageSession.mockReset();
    pageMock.readEnrollmentPageSession.mockResolvedValue({
      handle: "pixel_driver",
      locale: "en",
      passkeyRegistered: false,
    });
    pageMock.redirect.mockClear();
  });

  it.each([
    ["false", false],
    ["true", true],
  ] as const)(
    "forwards environment value %s as the literal decision %s",
    async (value, expected) => {
      vi.stubEnv("VIBERACING_ENROLLMENT_ENABLED", value);
      const page = await import("./page");
      const element = await page.default();

      expect(isValidElement<{ enrollmentEnabled: boolean }>(element)).toBe(true);
      if (!isValidElement<{ enrollmentEnabled: boolean }>(element)) {
        throw new Error("expected the passkey setup element");
      }
      expect(element.props.enrollmentEnabled).toBe(expected);
      expect(pageMock.readEnrollmentPageSession).toHaveBeenCalledOnce();
    },
  );

  it("preserves the active-session redirect while enrollment is disabled", async () => {
    pageMock.readEnrollmentPageSession.mockResolvedValue({
      handle: "pixel_driver",
      locale: "en",
      passkeyRegistered: true,
    });
    vi.stubEnv("VIBERACING_ENROLLMENT_ENABLED", "false");
    const page = await import("./page");

    await expect(page.default()).rejects.toThrow("redirect:/account");
  });
});
