import { afterEach, describe, expect, it, vi } from "vitest";

const runtimeMock = vi.hoisted(() => ({
  getEnrollmentRuntime: vi.fn<() => unknown>(() => {
    throw new Error("runtime-unavailable");
  }),
}));

vi.mock("@/lib/enrollment-runtime", () => runtimeMock);

const path = "https://viberacing.invalid/auth/pairing/verify";

describe("pairing approval verification Next.js entrypoint", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    runtimeMock.getEnrollmentRuntime.mockReset();
    runtimeMock.getEnrollmentRuntime.mockImplementation(() => {
      throw new Error("runtime-unavailable");
    });
  });

  it("fails closed before enrollment runtime construction when disabled", async () => {
    vi.stubEnv("VIBERACING_PAIRING_ENABLED", "false");
    const route = await import("./route");

    expect(route.dynamic).toBe("force-dynamic");
    expect(route.runtime).toBe("nodejs");
    await expect(route.POST(new Request(path, { method: "POST" }))).resolves.toMatchObject({
      status: 503,
    });
    expect(runtimeMock.getEnrollmentRuntime).not.toHaveBeenCalled();
  });

  it("enters the existing runtime boundary only after exact enablement", async () => {
    vi.stubEnv("VIBERACING_PAIRING_ENABLED", "true");
    const route = await import("./route");

    await expect(route.POST(new Request(path, { method: "POST" }))).resolves.toMatchObject({
      status: 503,
    });
    expect(runtimeMock.getEnrollmentRuntime).toHaveBeenCalledOnce();
  });

  it.each([
    ["false", false],
    ["true", true],
  ] as const)(
    "forwards source-creation value %s as the literal decision %s",
    async (environmentValue, expected) => {
      const completePairingApproval = vi.fn(() => Promise.resolve(false));
      runtimeMock.getEnrollmentRuntime.mockReturnValue({
        config: {
          publicOrigin: "https://viberacing.invalid",
          recoveryMinimumResponseMs: 250,
          secureCookies: true,
        },
        service: { completePairingApproval },
      });
      vi.stubEnv("VIBERACING_PAIRING_ENABLED", "true");
      vi.stubEnv("VIBERACING_SOURCE_CREATION_ENABLED", environmentValue);
      const route = await import("./route");
      const response = await route.POST(
        new Request(path, {
          body: JSON.stringify({ response: { id: "synthetic" } }),
          headers: {
            "content-type": "application/json",
            cookie:
              "viberacing_session=opaque-session; viberacing_pairing_approval=opaque-approval",
            host: "viberacing.invalid",
            origin: "https://viberacing.invalid",
          },
          method: "POST",
        }),
      );

      expect(response.status).toBe(401);
      expect(completePairingApproval).toHaveBeenCalledWith(
        "opaque-session",
        "opaque-approval",
        { response: { id: "synthetic" } },
        expected,
      );
    },
  );
});
