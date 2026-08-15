import { afterEach, describe, expect, it, vi } from "vitest";
import { configuredLogLevel, safeErrorFields, writeLog } from "./log";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("structured logging", () => {
  it("writes one JSON object with stable service fields", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VIBERACING_LOG_LEVEL", "debug");
    const output = vi.spyOn(console, "log").mockImplementation(() => {});

    writeLog("info", "sync_completed", { durationMs: 12.5, status: 200 });

    expect(output).toHaveBeenCalledOnce();
    const record = JSON.parse(String(output.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(record).toMatchObject({
      level: "info",
      service: "viberacing-web",
      event: "sync_completed",
      durationMs: 12.5,
      status: 200,
    });
    expect(record.timestamp).toEqual(expect.any(String));
  });

  it("keeps messages, stacks, credentials, and paths out of error fields", () => {
    const error = Object.assign(
      new Error("Bearer secret-value failed in /private/user/repository"),
      { code: "08006", severity: "ERROR" },
    );

    const fields = safeErrorFields(error);

    expect(fields).toEqual({ errorType: "Error", errorCode: "08006", errorSeverity: "ERROR" });
    const serialized = JSON.stringify(fields);
    expect(serialized).not.toContain("secret-value");
    expect(serialized).not.toContain("/private/user");
    expect(serialized).not.toContain("stack");
  });

  it("rejects unsupported production log levels", () => {
    vi.stubEnv("VIBERACING_LOG_LEVEL", "verbose");
    expect(configuredLogLevel).toThrow(/VIBERACING_LOG_LEVEL/);
  });
});
