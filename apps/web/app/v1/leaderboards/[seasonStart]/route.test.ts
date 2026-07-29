import { afterEach, describe, expect, it, vi } from "vitest";

const request = new Request(
  "https://viberacing.invalid/v1/leaderboards/2026-07-21?trustTier=community&page=1",
);
const context = { params: Promise.resolve({ seasonStart: "2026-07-21" }) };

describe("historical leaderboard Next.js entrypoint", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("does not await or parse path state while the module-load gate is closed", async () => {
    vi.stubEnv("VIBERACING_PUBLIC_SNAPSHOTS_ENABLED", "false");
    const route = await import("./route");
    const rejectedContext = {
      params: Promise.reject(new Error("path must remain unread")),
    };
    rejectedContext.params.catch(() => undefined);

    await expect(route.GET(request, rejectedContext)).resolves.toMatchObject({ status: 503 });
  });

  it("validates the Monday path only after exact enablement", async () => {
    vi.stubEnv("VIBERACING_PUBLIC_SNAPSHOTS_ENABLED", "true");
    const route = await import("./route");

    await expect(route.GET(request, context)).resolves.toMatchObject({ status: 400 });
  });

  it("keeps every non-GET method closed", async () => {
    vi.stubEnv("VIBERACING_PUBLIC_SNAPSHOTS_ENABLED", "false");
    const route = await import("./route");

    for (const handler of [
      route.DELETE,
      route.HEAD,
      route.OPTIONS,
      route.PATCH,
      route.POST,
      route.PUT,
    ]) {
      expect(handler().status).toBe(405);
    }
  });
});
