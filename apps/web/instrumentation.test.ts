import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  installProductionConsoleGuard: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
  safeErrorFields: vi.fn(() => ({ errorType: "Error" })),
  serializeRequiredError: vi.fn(() => '{"event":"server_configuration_invalid"}'),
  writeRequiredError: vi.fn(),
  exitInvalidRuntimeConfiguration: vi.fn(),
  validateRuntimeConfig: vi.fn(),
}));

vi.mock("./lib/config", () => ({ validateRuntimeConfig: mocks.validateRuntimeConfig }));
vi.mock("./lib/log", () => ({
  installProductionConsoleGuard: mocks.installProductionConsoleGuard,
  logError: mocks.logError,
  logInfo: mocks.logInfo,
  safeErrorFields: mocks.safeErrorFields,
  serializeRequiredError: mocks.serializeRequiredError,
  writeRequiredError: mocks.writeRequiredError,
}));
vi.mock("./lib/startup.node", () => ({
  exitInvalidRuntimeConfiguration: mocks.exitInvalidRuntimeConfiguration,
}));

import { register } from "./instrumentation";

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("production instrumentation startup", () => {
  it("guards framework output and validates configuration before reporting startup", async () => {
    await register();

    expect(mocks.installProductionConsoleGuard).toHaveBeenCalledOnce();
    expect(mocks.validateRuntimeConfig).toHaveBeenCalledOnce();
    expect(mocks.logInfo).toHaveBeenCalledWith("server_started", expect.any(Object));
    expect(mocks.installProductionConsoleGuard.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.validateRuntimeConfig.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(mocks.validateRuntimeConfig.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.logInfo.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("logs and rejects an invalid runtime configuration", async () => {
    const error = Object.assign(new Error("missing secret"), {
      code: "CONFIG_GITHUB_CLIENT_SECRET_MISSING",
    });
    mocks.validateRuntimeConfig.mockImplementationOnce(() => {
      throw error;
    });

    await expect(register()).rejects.toBe(error);
    expect(mocks.writeRequiredError).toHaveBeenCalledWith("server_configuration_invalid", {
      errorType: "Error",
    });
    expect(mocks.logInfo).not.toHaveBeenCalled();
  });

  it("terminates production when runtime configuration is invalid", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const error = Object.assign(new Error("missing secret"), {
      code: "CONFIG_GITHUB_CLIENT_SECRET_MISSING",
    });
    mocks.validateRuntimeConfig.mockImplementationOnce(() => {
      throw error;
    });
    mocks.exitInvalidRuntimeConfiguration.mockImplementationOnce(() => {
      throw error;
    });

    await expect(register()).rejects.toBe(error);
    expect(mocks.serializeRequiredError).toHaveBeenCalledWith("server_configuration_invalid", {
      errorType: "Error",
    });
    expect(mocks.exitInvalidRuntimeConfiguration).toHaveBeenCalledWith(
      '{"event":"server_configuration_invalid"}',
    );
    expect(mocks.writeRequiredError).not.toHaveBeenCalled();
    expect(mocks.logInfo).not.toHaveBeenCalled();
  });

  it("does not validate while Next.js is producing the build", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");

    await register();

    expect(mocks.installProductionConsoleGuard).not.toHaveBeenCalled();
    expect(mocks.validateRuntimeConfig).not.toHaveBeenCalled();
    expect(mocks.logInfo).not.toHaveBeenCalled();
  });
});
