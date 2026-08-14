import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("browser-safe mutation forms", () => {
  it("routes page-level API forms through a client redirect handler", () => {
    for (const page of [
      source("./app-header.tsx"),
      source("../dashboard/page.tsx"),
      source("../connect/page.tsx"),
    ]) {
      expect(page).not.toMatch(/<form[^>]+action=["']\/api\//);
      expect(page).toContain("SameOriginActionForm");
    }
  });

  it("accepts only same-origin actions and same-origin redirect destinations", () => {
    for (const component of [
      source("./same-origin-action-form.tsx"),
      source("./danger-action-form.tsx"),
    ]) {
      expect(component).toContain("actionUrl.origin !== window.location.origin");
      expect(component).toContain("destination.origin !== window.location.origin");
      expect(component).toContain('credentials: "same-origin"');
      expect(component).toContain('redirect: "follow"');
    }
  });

  it("starts GitHub re-authentication outside fetch when a session expires", () => {
    for (const component of [
      source("./same-origin-action-form.tsx"),
      source("./danger-action-form.tsx"),
    ]) {
      expect(component).toContain("response.status === 401");
      expect(component).toContain("window.location.assign(authenticationPath())");
      expect(component).toContain("/api/auth/github/start?next=");
    }

    for (const route of [
      source("../api/connections/revoke/route.ts"),
      source("../api/leaderboard/leave/route.ts"),
      source("../api/pairing/approve/route.ts"),
    ]) {
      expect(route).toContain('problem(401, "unauthorized")');
      expect(route).not.toContain('new URL("/api/auth/github/start"');
    }
  });
});
