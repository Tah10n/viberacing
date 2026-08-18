import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./return-path";

const origin = new URL("https://viberacing.example");

describe("OAuth return paths", () => {
  it("preserves a same-origin relative path", () => {
    expect(safeReturnPath("/connect?code=ABCD1234#approve", origin)).toBe(
      "/connect?code=ABCD1234#approve",
    );
  });

  it.each([
    "https://attacker.example/after-login",
    "//attacker.example/after-login",
    "/\\attacker.example/after-login",
    "dashboard",
  ])("rejects an external or malformed return path: %s", (value) => {
    expect(safeReturnPath(value, origin)).toBe("/dashboard");
  });

  it("rejects an oversized cookie value", () => {
    expect(safeReturnPath(`/${"a".repeat(500)}`, origin)).toBe("/dashboard");
  });
});
