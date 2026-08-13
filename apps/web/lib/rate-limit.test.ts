import { describe, expect, it } from "vitest";
import { clientAddress, createFixedWindowLimiter } from "./rate-limit";

describe("pairing rate limit", () => {
  it("allows a small burst and resets after the window", () => {
    const allow = createFixedWindowLimiter(2, 1_000, 10);
    expect(allow("client", 0)).toBe(true);
    expect(allow("client", 1)).toBe(true);
    expect(allow("client", 2)).toBe(false);
    expect(allow("client", 1_001)).toBe(true);
  });

  it("uses the proxy-appended address instead of a spoofable first value", () => {
    const request = new Request("https://viberacing.example", {
      headers: { "x-forwarded-for": "spoofed, 203.0.113.7" },
    });
    expect(clientAddress(request)).toBe("203.0.113.7");
  });
});
