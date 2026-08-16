import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configuredLogLevel,
  installProductionConsoleGuard,
  safeErrorFields,
  writeLog,
  writeRequiredError,
} from "./log";

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

  it("sanitizes malformed and hostile error objects without throwing", () => {
    const nullMessage = new Error("replace-me");
    Object.defineProperty(nullMessage, "message", { value: null });
    const numericMessage = new Error("replace-me");
    Object.defineProperty(numericMessage, "message", { value: 42 });
    const throwingMessage = new Error("replace-me");
    Object.defineProperty(throwingMessage, "message", {
      get() {
        throw new Error("secret message getter");
      },
    });
    const throwingCode = new Proxy(new Error("fetch failed"), {
      get(target, property, receiver): unknown {
        if (property === "code") throw new Error("secret code getter");
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    expect(safeErrorFields(nullMessage)).toEqual({ errorType: "Error" });
    expect(safeErrorFields(numericMessage)).toEqual({ errorType: "Error" });
    expect(safeErrorFields(throwingMessage)).toEqual({ errorType: "Error" });
    expect(safeErrorFields(throwingCode)).toEqual({
      errorType: "Error",
      diagnosticCode: "FETCH_FAILED",
    });
  });

  it("rejects unsupported production log levels", () => {
    for (const invalid of ["verbose", "constructor", "__proto__"]) {
      vi.stubEnv("VIBERACING_LOG_LEVEL", invalid);
      expect(configuredLogLevel).toThrow(/VIBERACING_LOG_LEVEL/);
    }
  });

  it("can report invalid logging configuration without consulting the invalid level", () => {
    vi.stubEnv("VIBERACING_LOG_LEVEL", "constructor");
    const output = vi.spyOn(console, "error").mockImplementation(() => {});

    writeRequiredError("server_configuration_invalid", {
      errorCode: "CONFIG_LOG_LEVEL_INVALID",
    });

    expect(output).toHaveBeenCalledOnce();
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({
      level: "error",
      event: "server_configuration_invalid",
      errorCode: "CONFIG_LOG_LEVEL_INVALID",
    });
  });

  it("sanitizes framework console errors before they reach stderr", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VIBERACING_LOG_LEVEL", "debug");
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    const restoreConsole = installProductionConsoleGuard();

    try {
      const frameworkError = Object.assign(
        new Error("Bearer secret-value failed at /private/user/repository"),
        { code: "ECONNREFUSED" },
      );
      const guardedError = globalThis.console.error;
      guardedError("framework prefix", frameworkError);

      expect(output).toHaveBeenCalledOnce();
      const serialized = String(output.mock.calls[0]?.[0]);
      const record = JSON.parse(serialized) as Record<string, unknown>;
      expect(record).toMatchObject({
        level: "error",
        service: "viberacing-web",
        event: "framework_console_error",
        errorType: "Error",
        errorCode: "ECONNREFUSED",
      });
      expect(serialized).not.toContain("secret-value");
      expect(serialized).not.toContain("/private/user");
      expect(serialized).not.toContain("stack");
    } finally {
      restoreConsole();
    }
  });

  it("classifies known framework failures without retaining their messages", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VIBERACING_LOG_LEVEL", "debug");
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    const restoreConsole = installProductionConsoleGuard();

    try {
      globalThis.console.error(
        "connect ECONNREFUSED 127.0.0.1:5432 Bearer first-secret /private/database",
      );
      globalThis.console.error("TypeError: fetch failed with second-secret");

      expect(output).toHaveBeenCalledTimes(2);
      const first = JSON.parse(String(output.mock.calls[0]?.[0])) as Record<string, unknown>;
      const second = JSON.parse(String(output.mock.calls[1]?.[0])) as Record<string, unknown>;
      expect(first).toMatchObject({
        event: "framework_console_error",
        diagnosticCode: "CONNECTION_REFUSED",
      });
      expect(second).toMatchObject({
        event: "framework_console_error",
        diagnosticCode: "FETCH_FAILED",
      });
      const serialized = output.mock.calls.map(([record]) => String(record)).join("\n");
      expect(serialized).not.toContain("first-secret");
      expect(serialized).not.toContain("second-secret");
      expect(serialized).not.toContain("127.0.0.1");
      expect(serialized).not.toContain("/private/database");
    } finally {
      restoreConsole();
    }
  });

  it("keeps the production console guard total for hostile objects", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VIBERACING_LOG_LEVEL", "debug");
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    const restoreConsole = installProductionConsoleGuard();
    const hostile = new Proxy(new Error("fetch failed"), {
      get(target, property, receiver): unknown {
        if (property === "code") throw new Error("secret code getter");
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    try {
      expect(() => {
        globalThis.console.error(hostile);
      }).not.toThrow();
      expect(output).toHaveBeenCalledOnce();
      const serialized = String(output.mock.calls[0]?.[0]);
      expect(JSON.parse(serialized)).toMatchObject({
        event: "framework_console_error",
        errorType: "Error",
        diagnosticCode: "FETCH_FAILED",
      });
      expect(serialized).not.toContain("fetch failed");
      expect(serialized).not.toContain("secret code getter");
    } finally {
      restoreConsole();
    }
  });
});
