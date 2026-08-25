import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalClientAddress,
  clientAddress,
  clientAdmissionLimit,
  consumeRateLimit,
  deleteExpiredRateLimitBuckets,
  publicAdmissionMaximumAllocatedBuckets,
  publicAdmissionMaximumBucketsPerRequest,
  rateLimitCleanupBatchSize,
  rateLimitCleanupMaximumBatches,
  rateLimitCleanupDue,
} from "./rate-limit";

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

  it("schedules best-effort cleanup at most once per minute", () => {
    expect(rateLimitCleanupDue(0, 1)).toBe(true);
    expect(rateLimitCleanupDue(1_000, 60_999)).toBe(false);
    expect(rateLimitCleanupDue(1_000, 61_000)).toBe(true);
  });

  it("drains more buckets than all pre-auth and post-auth scopes can allocate per public window", async () => {
    const rowCounts = [rateLimitCleanupBatchSize, rateLimitCleanupBatchSize, 52];
    const limits: unknown[] = [];
    const client = {
      query: (_sql: string, values: unknown[]) => {
        limits.push(values[0]);
        return Promise.resolve({ rowCount: rowCounts.shift() ?? 0 });
      },
    };
    await expect(deleteExpiredRateLimitBuckets(client as never)).resolves.toBe(
      rateLimitCleanupBatchSize * 2 + 52,
    );
    expect(limits).toEqual([
      rateLimitCleanupBatchSize,
      rateLimitCleanupBatchSize,
      rateLimitCleanupBatchSize,
    ]);
    expect(publicAdmissionMaximumBucketsPerRequest).toBe(6);
    expect(rateLimitCleanupBatchSize * rateLimitCleanupMaximumBatches).toBeGreaterThan(
      publicAdmissionMaximumAllocatedBuckets,
    );
  });

  it("expires maximum multi-window allocations without deleting a future window", async () => {
    const rowsByWindow = new Map([
      [0, publicAdmissionMaximumAllocatedBuckets],
      [1, publicAdmissionMaximumAllocatedBuckets],
      [2, publicAdmissionMaximumAllocatedBuckets],
    ]);
    let expiringThrough = 0;
    const client = {
      query: (_sql: string, values: unknown[]) => {
        const limit = values[0] as number;
        let remaining = limit;
        let deleted = 0;
        for (const [window, rows] of rowsByWindow) {
          if (window > expiringThrough || remaining === 0) continue;
          const count = Math.min(rows, remaining);
          rowsByWindow.set(window, rows - count);
          remaining -= count;
          deleted += count;
        }
        return Promise.resolve({ rowCount: deleted });
      },
    };

    await expect(deleteExpiredRateLimitBuckets(client as never)).resolves.toBe(
      publicAdmissionMaximumAllocatedBuckets,
    );
    expect(rowsByWindow).toEqual(
      new Map([
        [0, 0],
        [1, publicAdmissionMaximumAllocatedBuckets],
        [2, publicAdmissionMaximumAllocatedBuckets],
      ]),
    );
    expiringThrough = 1;
    await expect(deleteExpiredRateLimitBuckets(client as never)).resolves.toBe(
      publicAdmissionMaximumAllocatedBuckets,
    );
    expect(rowsByWindow.get(1)).toBe(0);
    expect(rowsByWindow.get(2)).toBe(publicAdmissionMaximumAllocatedBuckets);
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

  it("canonicalizes IPv6 clients to a stable /64 key", () => {
    expect(canonicalClientAddress("2001:0db8:0000:0001:0000:0000:0000:0001")).toBe(
      "2001:db8:0:1::/64",
    );
    expect(canonicalClientAddress("2001:db8:0:1::abcd")).toBe("2001:db8:0:1::/64");
    expect(canonicalClientAddress("2001:db8:0:2::1")).toBe("2001:db8:0:2::/64");
    expect(canonicalClientAddress("2001:db8:0:1::1")).not.toBe(
      canonicalClientAddress("2001:db8:0:2::1"),
    );
  });

  it("maps IPv4-mapped IPv6 to the canonical IPv4 client key", () => {
    expect(canonicalClientAddress("::ffff:192.0.2.128")).toBe("192.0.2.128");
    expect(canonicalClientAddress("192.0.2.128")).toBe("192.0.2.128");
    expect(canonicalClientAddress("not-an-address")).toBeNull();
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
    ).toEqual({ trusted: true, key: "2001:db8::/64" });
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
