import { afterEach, describe, expect, it, vi } from "vitest";

const runtimeMock = vi.hoisted(() => ({
  getEnrollmentRuntime: vi.fn<() => unknown>(() => {
    throw new Error("runtime-unavailable");
  }),
}));

vi.mock("@/lib/enrollment-runtime", () => runtimeMock);

const path = "https://viberacing.invalid/auth/cars/proposals";

describe("CarRecipe proposal Next.js entrypoint", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    runtimeMock.getEnrollmentRuntime.mockReset();
    runtimeMock.getEnrollmentRuntime.mockImplementation(() => {
      throw new Error("runtime-unavailable");
    });
  });

  it("fails closed before enrollment runtime construction when disabled", async () => {
    vi.stubEnv("VIBERACING_CAR_PROPOSALS_ENABLED", "false");
    const route = await import("./route");
    const response = await route.POST(new Request(path, { method: "POST" }));

    expect(route.dynamic).toBe("force-dynamic");
    expect(route.runtime).toBe("nodejs");
    expect(response.status).toBe(503);
    expect(runtimeMock.getEnrollmentRuntime).not.toHaveBeenCalled();
  });

  it("forwards exact enablement to the browser proposal service", async () => {
    const propose = vi.fn(() => Promise.resolve(false));
    runtimeMock.getEnrollmentRuntime.mockReturnValue({
      carProposalService: {
        approve: vi.fn(),
        propose,
        read: vi.fn(),
        reject: vi.fn(),
      },
      config: {
        publicOrigin: "https://viberacing.invalid",
        recoveryMinimumResponseMs: 250,
        secureCookies: true,
      },
      service: {},
    });
    vi.stubEnv("VIBERACING_CAR_PROPOSALS_ENABLED", "true");
    const route = await import("./route");
    const response = await route.POST(
      new Request(path, {
        body: new URLSearchParams({
          schemaVersion: "1",
          chassis: "rally",
          nose: "scoop",
          cockpit: "rally",
          wing: "low",
          wheels: "all-terrain",
          palette: "sunburst",
          trail: "spark",
          seed: "42",
        }),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: "viberacing_session=opaque-session",
          host: "viberacing.invalid",
          origin: "https://viberacing.invalid",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(303);
    expect(propose).toHaveBeenCalledWith(
      "opaque-session",
      {
        schemaVersion: 1,
        chassis: "rally",
        nose: "scoop",
        cockpit: "rally",
        wing: "low",
        wheels: "all-terrain",
        palette: "sunburst",
        trail: "spark",
        seed: 42,
      },
      true,
    );
  });
});
