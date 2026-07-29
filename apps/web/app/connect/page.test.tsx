import { isValidElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const sessionMock = vi.hoisted(() => ({
  readEnrollmentPageConnect: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock("@/lib/enrollment-page-session", () => sessionMock);

describe("connect page batch-pairing entrypoint", () => {
  afterEach(() => {
    vi.resetModules();
    sessionMock.readEnrollmentPageConnect.mockClear();
  });

  it.each([
    ["7K9M-P2QR-W4XY", "7K9M-P2QR-W4XY"],
    ["lower-case", undefined],
    [["7K9M-P2QR-W4XY"] as string[], undefined],
  ] as const)("forwards only one canonical deep-link code %#", async (code, expected) => {
    const page = await import("./page");
    const element = await page.default({ searchParams: Promise.resolve({ code }) });

    expect(isValidElement<{ initialCode?: string }>(element)).toBe(true);
    if (!isValidElement<{ initialCode?: string }>(element)) {
      throw new Error("expected the connect experience element");
    }
    expect(element.props.initialCode).toBe(expected);
    expect(sessionMock.readEnrollmentPageConnect).toHaveBeenCalledOnce();
  });
});
