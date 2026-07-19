import { afterEach, describe, expect, it, vi } from "vitest";

const runtimeMock = vi.hoisted(() => ({
  getEnrollmentRuntime: vi.fn<() => unknown>(() => {
    throw new Error("runtime-unavailable");
  }),
}));

vi.mock("@/lib/enrollment-runtime", () => runtimeMock);

const path = "https://viberacing.invalid/auth/github/callback";

describe("GitHub enrollment callback Next.js entrypoint", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    runtimeMock.getEnrollmentRuntime.mockClear();
  });

  it("fails closed before enrollment runtime construction when disabled", async () => {
    vi.stubEnv("VIBERACING_ENROLLMENT_ENABLED", "false");
    const route = await import("./route");
    const response = await route.GET(new Request(path));

    expect(route.dynamic).toBe("force-dynamic");
    expect(route.runtime).toBe("nodejs");
    expect(response.status).toBe(503);
    expect(runtimeMock.getEnrollmentRuntime).not.toHaveBeenCalled();
  });

  it("reaches the enrollment runtime boundary only after exact enablement", async () => {
    vi.stubEnv("VIBERACING_ENROLLMENT_ENABLED", "true");
    const route = await import("./route");
    const response = await route.GET(new Request(path));

    expect(response.status).toBe(503);
    expect(runtimeMock.getEnrollmentRuntime).toHaveBeenCalledOnce();
  });
});
