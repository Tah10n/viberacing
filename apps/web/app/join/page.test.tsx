import { isValidElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const pageMock = vi.hoisted(() => ({
  readEnrollmentPageSession: vi.fn<() => Promise<unknown>>(() => Promise.resolve(undefined)),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("@/lib/enrollment-page-session", () => ({
  readEnrollmentPageSession: pageMock.readEnrollmentPageSession,
}));
vi.mock("next/navigation", () => ({ redirect: pageMock.redirect }));

describe("join page enrollment entrypoint", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    pageMock.readEnrollmentPageSession.mockReset();
    pageMock.readEnrollmentPageSession.mockResolvedValue(undefined);
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
      const element = await page.default({ searchParams: Promise.resolve({}) });

      expect(isValidElement<{ enrollmentEnabled: boolean }>(element)).toBe(true);
      if (!isValidElement<{ enrollmentEnabled: boolean }>(element)) {
        throw new Error("expected the join experience element");
      }
      expect(element.props.enrollmentEnabled).toBe(expected);
      expect(pageMock.readEnrollmentPageSession).toHaveBeenCalledOnce();
    },
  );

  it.each([
    [false, "/join/passkey"],
    [true, "/account"],
  ] as const)(
    "preserves the passkeyRegistered=%s session redirect while enrollment is disabled",
    async (passkeyRegistered, path) => {
      pageMock.readEnrollmentPageSession.mockResolvedValue({ passkeyRegistered });
      vi.stubEnv("VIBERACING_ENROLLMENT_ENABLED", "false");
      const page = await import("./page");

      await expect(page.default({ searchParams: Promise.resolve({}) })).rejects.toThrow(
        `redirect:${path}`,
      );
    },
  );
});
