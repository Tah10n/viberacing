import { afterEach, describe, expect, it, vi } from "vitest";

const invalidRequest = new Request(
  "https://viberacing.invalid/v1/community/scores?seasonStart=2026-07-14",
);

describe("public Community score Next.js entrypoint", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("stays disabled under a non-enabling deployment value", async () => {
    vi.stubEnv("VIBERACING_PUBLIC_RANKING_ENABLED", "false");
    const route = await import("./route");

    expect(route.dynamic).toBe("force-dynamic");
    expect(route.runtime).toBe("nodejs");
    await expect(route.GET(invalidRequest)).resolves.toMatchObject({ status: 503 });
  });

  it("evaluates the existing request boundary only after exact enablement", async () => {
    vi.stubEnv("VIBERACING_PUBLIC_RANKING_ENABLED", "true");
    const route = await import("./route");

    await expect(route.GET(invalidRequest)).resolves.toMatchObject({ status: 400 });
  });

  it("dispatches every non-GET Next.js method through the closed 405 response", async () => {
    vi.stubEnv("VIBERACING_PUBLIC_RANKING_ENABLED", "false");
    const route = await import("./route");

    for (const handler of [
      route.DELETE,
      route.HEAD,
      route.OPTIONS,
      route.PATCH,
      route.POST,
      route.PUT,
    ]) {
      const response = handler();
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET");
      expect(response.headers.get("vary")).toBe("Accept");
      await expect(response.json()).resolves.toMatchObject({
        errorCode: "method_not_allowed",
        status: 405,
      });
    }
  });
});
