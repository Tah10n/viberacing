import { describe, expect, it } from "vitest";

import { resolve } from "node:path";

import { nextConfig, securityHeaders, workspaceRoot } from "./next.config";

function headerMap(production: boolean): Map<string, string> {
  return new Map(securityHeaders(production).map((header) => [header.key, header.value]));
}

describe("static security headers", () => {
  it("pins Turbopack to this repository instead of inferring a parent workspace", () => {
    expect(resolve(workspaceRoot, "apps", "web")).toBe(process.cwd());
  });

  it("sets browser isolation, framing, MIME, referrer, and capability policy", () => {
    const headers = headerMap(false);
    expect(headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
    expect(headers.get("Permissions-Policy")).toContain("publickey-credentials-get=()");
    expect(headers.get("Permissions-Policy")).not.toContain("publickey-credentials-create=()");
    expect(headers.has("Strict-Transport-Security")).toBe(false);
  });

  it("adds a two-year preload HSTS policy only to production", () => {
    expect(headerMap(true).get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
  });

  it("keeps the unavailable native image optimizer disabled", () => {
    expect(nextConfig.images?.unoptimized).toBe(true);
    expect(nextConfig.images?.remotePatterns).toEqual([]);
    expect(nextConfig.images?.dangerouslyAllowSVG).toBe(false);
  });

  it("keeps OAuth callback codes out of development request logs", () => {
    const logging = nextConfig.logging;
    if (logging === undefined || logging === false) {
      throw new Error("Expected a narrow logging policy.");
    }
    const incomingRequests = logging.incomingRequests;
    if (typeof incomingRequests !== "object") {
      throw new Error("Expected a narrow incoming-request logging policy.");
    }
    expect(
      incomingRequests.ignore?.some((pattern) =>
        pattern.test("/auth/github/callback?code=temporary&state=opaque"),
      ),
    ).toBe(true);
    expect(incomingRequests.ignore?.some((pattern) => pattern.test("/join"))).toBe(false);
  });
});
