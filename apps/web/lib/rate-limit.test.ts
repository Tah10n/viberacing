import { afterEach, describe, expect, it } from "vitest";
import { clientAddress, consumeRateLimit } from "./rate-limit";

describe("database-backed rate limits", () => {
  const originalTrustProxy = process.env.VIBERACING_TRUST_PROXY;

  afterEach(() => {
    if (originalTrustProxy === undefined) delete process.env.VIBERACING_TRUST_PROXY;
    else process.env.VIBERACING_TRUST_PROXY = originalTrustProxy;
  });
  it("rejects invalid bucket configuration before touching the database", async () => {
    await expect(consumeRateLimit("Bad Scope", "client", 2, 60)).rejects.toThrow(
      "Invalid rate-limit scope",
    );
    await expect(consumeRateLimit("pairing", "client", 0, 60)).rejects.toThrow(
      "Invalid rate-limit limit",
    );
  });

  it("uses Railway's trusted client-address header", () => {
    process.env.VIBERACING_TRUST_PROXY = "railway";
    const request = new Request("https://viberacing.example", {
      headers: {
        "x-forwarded-for": "spoofed, 203.0.113.7",
        "x-real-ip": "203.0.113.9",
      },
    });
    expect(clientAddress(request)).toBe("203.0.113.9");
  });

  it("ignores forwarding headers unless the matching proxy is explicitly trusted", () => {
    process.env.VIBERACING_TRUST_PROXY = "none";
    const request = new Request("https://viberacing.example", {
      headers: { "x-real-ip": "203.0.113.9" },
    });
    expect(clientAddress(request)).toBe("untrusted-forwarding-headers");

    process.env.VIBERACING_TRUST_PROXY = "railway";
    const malformed = new Request("https://viberacing.example", {
      headers: { "x-real-ip": "attacker-controlled" },
    });
    expect(clientAddress(malformed)).toBe("missing-trusted-client-address");
  });
});
