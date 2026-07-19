import { isValidElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const sessionMock = vi.hoisted(() => ({
  readEnrollmentPageConnect: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock("@/lib/enrollment-page-session", () => sessionMock);

describe("connect page source-creation entrypoint", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    sessionMock.readEnrollmentPageConnect.mockClear();
  });

  it.each([
    ["false", false],
    ["true", true],
  ] as const)(
    "forwards environment value %s as the literal decision %s",
    async (value, expected) => {
      vi.stubEnv("VIBERACING_SOURCE_CREATION_ENABLED", value);
      const page = await import("./page");
      const element = await page.default();

      expect(isValidElement<{ sourceCreationEnabled: boolean }>(element)).toBe(true);
      if (!isValidElement<{ sourceCreationEnabled: boolean }>(element)) {
        throw new Error("expected the connect experience element");
      }
      expect(element.props.sourceCreationEnabled).toBe(expected);
      expect(sessionMock.readEnrollmentPageConnect).toHaveBeenCalledOnce();
    },
  );
});
