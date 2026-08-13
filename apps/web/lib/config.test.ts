import { afterEach, describe, expect, it } from "vitest";
import { publicOrigin, secureCookies } from "./config";

const originalOrigin = process.env.VIBERACING_PUBLIC_ORIGIN;

afterEach(() => {
  if (originalOrigin === undefined) delete process.env.VIBERACING_PUBLIC_ORIGIN;
  else process.env.VIBERACING_PUBLIC_ORIGIN = originalOrigin;
});

describe("public origin", () => {
  it("allows HTTP only for a local test server", () => {
    process.env.VIBERACING_PUBLIC_ORIGIN = "http://localhost:3000";
    expect(publicOrigin().origin).toBe("http://localhost:3000");
    expect(secureCookies()).toBe(false);
  });

  it("requires HTTPS for external hosts", () => {
    process.env.VIBERACING_PUBLIC_ORIGIN = "http://viberacing.example";
    expect(() => publicOrigin()).toThrow(/must use HTTPS/);
  });

  it("uses secure cookies over HTTPS", () => {
    process.env.VIBERACING_PUBLIC_ORIGIN = "https://viberacing.example";
    expect(secureCookies()).toBe(true);
  });
});
