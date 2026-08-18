import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "./proxy";

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
  it("returns a fresh nonce-based CSP for every page response", () => {
    const first = proxy(new NextRequest("https://viberacing.example/"));
    const second = proxy(new NextRequest("https://viberacing.example/dashboard"));
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
    "/health",
    "/ready",
  ])("skips CSP for the non-HTML path %s", (path) => {
    expect(doesProxyMatch({ config, url: `https://viberacing.example${path}` })).toBe(false);
  });

  it("skips router prefetch requests", () => {
    expect(
      doesProxyMatch({
        config,
        url: "https://viberacing.example/dashboard",
        headers: { "next-router-prefetch": "1" },
      }),
    ).toBe(false);
  });
});
