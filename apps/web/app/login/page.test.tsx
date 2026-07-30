import { isValidElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const sessionMock = vi.hoisted(() => ({
  readEnrollmentPageSession: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock("@/lib/enrollment-page-session", () => sessionMock);

describe("login return path", () => {
  afterEach(() => {
    vi.resetModules();
    sessionMock.readEnrollmentPageSession.mockClear();
  });

  it.each([
    ["/connect?code=7K9M-P2QR-W4XY", "/connect?code=7K9M-P2QR-W4XY"],
    ["/connect?code=lower-case", "/account"],
    ["https://attacker.invalid", "/account"],
    [["/connect?code=7K9M-P2QR-W4XY"] as string[], "/account"],
  ] as const)(
    "accepts only one exact internal pairing return path %#",
    async (returnTo, expected) => {
      const page = await import("./page");
      const element = await page.default({ searchParams: Promise.resolve({ returnTo }) });

      expect(isValidElement<{ returnTo: string }>(element)).toBe(true);
      if (!isValidElement<{ returnTo: string }>(element)) {
        throw new Error("expected the passkey login element");
      }
      expect(element.props.returnTo).toBe(expected);
      expect(sessionMock.readEnrollmentPageSession).toHaveBeenCalledOnce();
    },
  );
});
