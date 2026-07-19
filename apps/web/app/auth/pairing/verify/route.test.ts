import { afterEach, describe, expect, it, vi } from "vitest";

const runtimeMock = vi.hoisted(() => ({
  getEnrollmentRuntime: vi.fn(() => {
    throw new Error("runtime-unavailable");
  }),
}));

vi.mock("@/lib/enrollment-runtime", () => runtimeMock);

const path = "https://viberacing.invalid/auth/pairing/verify";

describe("pairing approval verification Next.js entrypoint", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    runtimeMock.getEnrollmentRuntime.mockClear();
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
});
