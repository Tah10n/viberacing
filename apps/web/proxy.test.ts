import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "./proxy";
import { consumeAdmissionRateLimit } from "@/lib/rate-limit";
import { logError } from "@/lib/log";
import { allowRequestLog } from "@/lib/metrics";
import { ResourceOverloaded } from "@/lib/overload";

vi.mock("@/lib/log", async (original) => ({ ...(await original<object>()), logError: vi.fn() }));
vi.mock("@/lib/metrics", () => ({ allowRequestLog: vi.fn().mockReturnValue(true) }));

vi.mock("@/lib/rate-limit", () => ({
  clientAddress: () => ({ trusted: true, key: "192.0.2.1" }),
  clientAdmissionLimit: () => 120,
  consumeAdmissionRateLimit: vi.fn().mockResolvedValue({ allowed: true, reason: null }),
}));

// Next 16.2.11's experimental helper declaration references a renamed internal type.
const nextTesting = createRequire(import.meta.url)("next/experimental/testing/server") as {
  unstable_doesMiddlewareMatch: (input: {
    config: typeof config;
    url: string;
    headers?: Record<string, string>;
  }) => boolean;
};
const doesProxyMatch = (input: Parameters<typeof nextTesting.unstable_doesMiddlewareMatch>[0]) =>
  nextTesting.unstable_doesMiddlewareMatch(input);

describe("HTML security proxy", () => {
  it("returns a fresh nonce-based CSP for every page response", async () => {
    const first = await proxy(new NextRequest("https://viberacing.example/"));
    const second = await proxy(new NextRequest("https://viberacing.example/dashboard"));
    const firstPolicy = first.headers.get("content-security-policy");
    const secondPolicy = second.headers.get("content-security-policy");

    expect(firstPolicy).toMatch(/'nonce-[0-9a-f-]+'/);
    expect(secondPolicy).toMatch(/'nonce-[0-9a-f-]+'/);
    expect(firstPolicy).not.toBe(secondPolicy);
    expect(firstPolicy).not.toContain("'unsafe-inline'");
  });

  it.each(["/", "/dashboard", "/apiary", "/healthcheck", "/ready-ui", "/favicon.ico-test"])(
    "applies CSP to the HTML path %s",
    (path) => {
      expect(doesProxyMatch({ config, url: `https://viberacing.example${path}` })).toBe(true);
    },
  );

  it.each([
    "/api",
    "/api/pairing/approve",
    "/_next/static/chunks/app.js",
    "/_next/image",
    "/favicon.ico",
    "/favicon.svg",
    "/health",
    "/ready",
  ])("skips CSP for the non-HTML path %s", (path) => {
    expect(doesProxyMatch({ config, url: `https://viberacing.example${path}` })).toBe(false);
  });

  it("protects router prefetch requests", () => {
    expect(
      doesProxyMatch({
        config,
        url: "https://viberacing.example/dashboard",
        headers: { "next-router-prefetch": "1" },
      }),
    ).toBe(true);
  });
});

it("logs a bounded safe diagnostic for admission failure and correlates the 503", async () => {
  const cause = Object.assign(new Error("connect ECONNREFUSED private-password@private-host"), {
    code: "ECONNREFUSED",
  });
  const error = Object.assign(new ResourceOverloaded(), { cause });
  vi.mocked(consumeAdmissionRateLimit).mockRejectedValueOnce(error);
  vi.mocked(logError).mockClear();
  const response = await proxy(new NextRequest("https://viberacing.example/"));
  expect(response.status).toBe(503);
  expect(response.headers.get("Retry-After")).toBe("1");
  expect(response.headers.get("X-Request-Id")).toMatch(/^[a-f0-9-]{36}$/);
  expect(logError).toHaveBeenCalledWith(
    "public_admission_failed",
    expect.objectContaining({
      requestId: response.headers.get("X-Request-Id"),
      status: 503,
      errorCode: "ECONNREFUSED",
      diagnosticCode: "CONNECTION_REFUSED",
    }),
  );
  expect(JSON.stringify(vi.mocked(logError).mock.calls)).not.toMatch(
    /private-password|private-host|stack/,
  );
  vi.mocked(allowRequestLog).mockReturnValueOnce(false);
  vi.mocked(logError).mockClear();
  vi.mocked(consumeAdmissionRateLimit).mockRejectedValueOnce(error);
  expect((await proxy(new NextRequest("https://viberacing.example/"))).status).toBe(503);
  expect(logError).not.toHaveBeenCalled();
});
