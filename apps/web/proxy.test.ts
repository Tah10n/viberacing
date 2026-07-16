import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy, proxy } from "./proxy";

describe("content security policy", () => {
  it("builds a strict production policy around one supplied nonce", () => {
    const policy = buildContentSecurityPolicy("fixedNonce123", false);
    expect(policy).toContain("script-src 'self' 'nonce-fixedNonce123' 'strict-dynamic'");
    expect(policy).toContain("style-src 'self' 'nonce-fixedNonce123'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("form-action 'self' https://github.com");
    expect(policy).not.toContain("connect-src 'self' https://github.com");
    expect(policy).toContain("upgrade-insecure-requests");
    expect(policy).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toMatch(/(?:^|\s)\*(?:\s|;|$)/);
  });

  it("limits development relaxation to eval and local websocket transport", () => {
    const policy = buildContentSecurityPolicy("devNonce123", true);
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("connect-src 'self' ws: wss:");
    expect(policy).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  it("generates a fresh response nonce for each navigation", () => {
    const first = proxy(new NextRequest("https://viberacing.invalid/"));
    const second = proxy(new NextRequest("https://viberacing.invalid/"));
    const firstPolicy = first.headers.get("Content-Security-Policy") ?? "";
    const secondPolicy = second.headers.get("Content-Security-Policy") ?? "";
    const firstNonce = /'nonce-([^']+)'/.exec(firstPolicy)?.[1];
    const secondNonce = /'nonce-([^']+)'/.exec(secondPolicy)?.[1];
    expect(firstNonce).toMatch(/^[A-Za-z0-9+/]{24}$/);
    expect(secondNonce).toMatch(/^[A-Za-z0-9+/]{24}$/);
    expect(firstNonce).not.toBe(secondNonce);
  });
});
