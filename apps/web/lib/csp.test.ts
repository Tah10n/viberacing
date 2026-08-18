import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "./csp";

describe("content security policy", () => {
  it("uses request-scoped nonces without unsafe inline script or style execution", () => {
    const policy = contentSecurityPolicy("synthetic-nonce", false);

    expect(policy).toContain("script-src 'self' 'nonce-synthetic-nonce' 'strict-dynamic'");
    expect(policy).toContain("style-src 'self' 'nonce-synthetic-nonce'");
    expect(policy).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it("permits React development diagnostics without weakening production", () => {
    const policy = contentSecurityPolicy("development-nonce", true);

    expect(policy).toContain("'unsafe-eval'");
    expect(policy).not.toContain("'unsafe-inline'");
  });
});
