import { afterEach, describe, expect, it, vi } from "vitest";

const path = "https://viberacing.invalid/v1/connector/pairing/poll";

describe("connector pairing poll Next.js entrypoint", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("stays disabled under a non-enabling deployment value", async () => {
    vi.stubEnv("VIBERACING_PAIRING_ENABLED", "false");
    const route = await import("./route");

    expect(route.dynamic).toBe("force-dynamic");
    expect(route.runtime).toBe("nodejs");
    await expect(route.POST(new Request(path, { method: "POST" }))).resolves.toMatchObject({
      status: 503,
    });
  });

  it("evaluates the existing request boundary only after exact enablement", async () => {
    vi.stubEnv("VIBERACING_PAIRING_ENABLED", "true");
    const route = await import("./route");

    await expect(route.POST(new Request(path, { method: "POST" }))).resolves.toMatchObject({
      status: 400,
    });
  });

  it("dispatches every non-POST method through the closed response", async () => {
    vi.stubEnv("VIBERACING_PAIRING_ENABLED", "false");
    const route = await import("./route");

    for (const [method, handler] of [
      ["DELETE", route.DELETE],
      ["GET", route.GET],
      ["HEAD", route.HEAD],
      ["OPTIONS", route.OPTIONS],
      ["PATCH", route.PATCH],
      ["PUT", route.PUT],
    ] as const) {
      const response = handler(new Request(path, { method }));
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
      expect(response.headers.get("vary")).toBe("Accept");
      if (method !== "HEAD") {
        await expect(response.json()).resolves.toMatchObject({
          errorCode: "method_not_allowed",
          status: 405,
        });
      }
    }
  });
});
