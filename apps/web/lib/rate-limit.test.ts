import { afterEach, describe, expect, it } from "vitest";
import { clientAddress, clientAdmissionLimit, consumeRateLimit } from "./rate-limit";

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
    expect(clientAddress(request)).toEqual({ trusted: true, key: "203.0.113.9" });
  });

  it("ignores forwarding headers unless the matching proxy is explicitly trusted", () => {
    process.env.VIBERACING_TRUST_PROXY = "none";
    const request = new Request("https://viberacing.example", {
      headers: { "x-real-ip": "203.0.113.9" },
    });
    expect(clientAddress(request)).toEqual({
      trusted: false,
      key: "untrusted:proxy_disabled",
      reason: "proxy_disabled",
    });

    process.env.VIBERACING_TRUST_PROXY = "railway";
    const malformed = new Request("https://viberacing.example", {
      headers: { "x-real-ip": "attacker-controlled" },
    });
    expect(clientAddress(malformed)).toEqual({
      trusted: false,
      key: "untrusted:invalid_header",
      reason: "invalid_header",
    });
  });

  it("distinguishes a missing trusted header and accepts the self-host proxy mode", () => {
    process.env.VIBERACING_TRUST_PROXY = "trusted-x-real-ip";
    expect(clientAddress(new Request("https://viberacing.example"))).toEqual({
      trusted: false,
      key: "untrusted:missing_header",
      reason: "missing_header",
    });
    expect(
      clientAddress(
        new Request("https://viberacing.example", {
          headers: { "X-Real-IP": "2001:db8::1", "X-Forwarded-For": "spoofed" },
        }),
      ),
    ).toEqual({ trusted: true, key: "2001:db8::1" });
  });

  it("keeps local preview usable while bounding invalid trusted headers", () => {
    expect(
      clientAdmissionLimit(
        { trusted: false, key: "local", reason: "proxy_disabled" },
        120,
        10_000,
        20,
      ),
    ).toBe(10_000);
    expect(
      clientAdmissionLimit(
        { trusted: false, key: "invalid", reason: "invalid_header" },
        120,
        10_000,
        20,
      ),
    ).toBe(20);
  });
});
