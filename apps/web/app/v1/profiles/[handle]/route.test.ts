import { afterEach, describe, expect, it, vi } from "vitest";

const request = new Request("https://viberacing.invalid/v1/profiles/UPPER?trustTier=community");
const context = { params: Promise.resolve({ handle: "UPPER" }) };

describe("public profile Next.js entrypoint", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("stays unavailable before dynamic path parsing when disabled", async () => {
    vi.stubEnv("VIBERACING_PUBLIC_SNAPSHOTS_ENABLED", "false");
    const route = await import("./route");

    await expect(route.GET(request, context)).resolves.toMatchObject({ status: 503 });
  });

  it("validates the canonical handle only after exact enablement", async () => {
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
