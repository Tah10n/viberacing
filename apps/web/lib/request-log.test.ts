import { afterEach, describe, expect, it, vi } from "vitest";
import { annotateResponse, markResponse, problem } from "./http";
import { withRequestLogging } from "./request-log";

function throwUnknown(value: unknown): never {
  throw value;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("request logging", () => {
  it("logs route diagnostics without URL queries, headers, or bodies", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VIBERACING_LOG_LEVEL", "info");
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = withRequestLogging("/api/example/[id]", (loggedRequest: Request) => {
      expect(loggedRequest.method).toBe("POST");
      return problem(
        500,
        "server_error",
        Object.assign(new Error("database secret-value at /private/user/repository"), {
          code: "08006",
        }),
      );
    });
    const request = new Request("http://localhost/api/example/id?pairingCode=secret-query", {
      method: "POST",
      headers: {
        Authorization: "Bearer secret-credential",
        "Content-Length": "19",
        "X-Real-IP": "203.0.113.91",
      },
      body: "secret-request-body",
    });

    const response = await handler(request);

    expect(response.status).toBe(500);
    expect(response.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(output).toHaveBeenCalledOnce();
    const serialized = String(output.mock.calls[0]?.[0]);
    const record = JSON.parse(serialized) as Record<string, unknown>;
    expect(record).toMatchObject({
      level: "error",
      event: "http_request_completed",
      method: "POST",
      route: "/api/example/[id]",
      status: 500,
      outcome: "server_error",
      errorType: "Error",
      errorCode: "08006",
      requestBytes: 19,
    });
    expect(record.durationMs).toEqual(expect.any(Number));
    expect(record.requestId).toBe(response.headers.get("X-Request-Id"));
    expect(serialized).not.toContain("secret-query");
    expect(serialized).not.toContain("secret-credential");
    expect(serialized).not.toContain("secret-request-body");
    expect(serialized).not.toContain("203.0.113.91");
    expect(serialized).not.toContain("/private/user");
  });

  it("turns an unhandled route failure into a correlated generic response", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VIBERACING_LOG_LEVEL", "info");
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = withRequestLogging("/api/example", (loggedRequest: Request) => {
      expect(loggedRequest.method).toBe("GET");
      throw Object.assign(new Error("secret failure detail"), { code: "57P01" });
    });

    const response = await handler(new Request("http://localhost/api/example"));

    await expect(response.json()).resolves.toEqual({ error: "server_error" });
    expect(response.status).toBe(500);
    expect(output).toHaveBeenCalledOnce();
    const serialized = String(output.mock.calls[0]?.[0]);
    expect(serialized).toContain('"event":"http_request_failed"');
    expect(serialized).toContain('"errorCode":"57P01"');
    expect(serialized).not.toContain("secret failure detail");
    expect(response.headers.get("X-Request-Id")).toBe(
      (JSON.parse(serialized) as Record<string, unknown>).requestId,
    );
  });

  it("classifies an unhandled fetch failure without retaining its message", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VIBERACING_LOG_LEVEL", "info");
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = withRequestLogging("/api/example", () => {
      throw new TypeError("fetch failed");
    });

    const response = await handler();

    await expect(response.json()).resolves.toEqual({ error: "server_error" });
    expect(response.status).toBe(500);
    expect(output).toHaveBeenCalledOnce();
    const serialized = String(output.mock.calls[0]?.[0]);
    expect(JSON.parse(serialized)).toMatchObject({
      level: "error",
      event: "http_request_failed",
      status: 500,
      outcome: "server_error",
      errorType: "TypeError",
      diagnosticCode: "FETCH_FAILED",
    });
    expect(serialized).not.toContain("fetch failed");
  });

  it("returns a correlated generic response for arbitrary and hostile thrown values", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VIBERACING_LOG_LEVEL", "info");
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    const throwingMessage = new Error("replace-me");
    Object.defineProperty(throwingMessage, "message", {
      get() {
        throw new Error("secret message getter");
      },
    });
    const throwingCode = new Proxy(new Error("replace-me"), {
      get(target, property, receiver): unknown {
        if (property === "code") throw new Error("secret code getter");
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const thrownValues: unknown[] = [
      { privateReason: "secret arbitrary object" },
      throwingMessage,
      throwingCode,
    ];

    for (const thrownValue of thrownValues) {
      output.mockClear();
      const handler = withRequestLogging("/api/example", () => {
        throwUnknown(thrownValue);
      });

      const response = await handler();

      await expect(response.json()).resolves.toEqual({ error: "server_error" });
      expect(response.status).toBe(500);
      expect(response.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
      expect(output).toHaveBeenCalledOnce();
      const serialized = String(output.mock.calls[0]?.[0]);
      expect(serialized).not.toContain("secret");
      expect(response.headers.get("X-Request-Id")).toBe(
        (JSON.parse(serialized) as Record<string, unknown>).requestId,
      );
    }
  });

  it("never changes success or failure responses when logging configuration fails", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VIBERACING_LOG_LEVEL", "invalid");
    const handler = withRequestLogging("/api/example", () => Response.json({ status: "ok" }));

    const response = await handler();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(response.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);

    const failedResponse = await withRequestLogging("/api/example", () => {
      throwUnknown({ privateReason: "secret arbitrary object" });
    })();
    expect(failedResponse.status).toBe(500);
    await expect(failedResponse.json()).resolves.toEqual({ error: "server_error" });
    expect(failedResponse.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("honors response-specific log levels for polling outcomes", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VIBERACING_LOG_LEVEL", "debug");
    const standardOutput = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorOutput = vi.spyOn(console, "error").mockImplementation(() => {});
    const pendingHandler = withRequestLogging("/api/pairing/poll", () =>
      annotateResponse(Response.json({ status: "pending" }), { pairingStatus: "pending" }, "debug"),
    );
    const revokedHandler = withRequestLogging("/api/pairing/poll", () =>
      annotateResponse(Response.json({ status: "revoked" }), { pairingStatus: "revoked" }, "warn"),
    );

    await pendingHandler();
    await revokedHandler();

    const standardRecords = standardOutput.mock.calls.map(
      ([record]) => JSON.parse(String(record)) as Record<string, unknown>,
    );
    const pendingCompletion = standardRecords.find(
      (record) => record.event === "http_request_completed" && record.pairingStatus === "pending",
    );
    expect(pendingCompletion).toMatchObject({ level: "debug", status: 200 });
    expect(errorOutput).toHaveBeenCalledOnce();
    expect(JSON.parse(String(errorOutput.mock.calls[0]?.[0]))).toMatchObject({
      level: "warn",
      event: "http_request_completed",
      pairingStatus: "revoked",
      status: 200,
    });
  });

  it("keeps routine unauthenticated responses at debug while preserving bounded warnings", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VIBERACING_LOG_LEVEL", "debug");
    const standardOutput = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorOutput = vi.spyOn(console, "error").mockImplementation(() => {});

    for (const status of [401, 403, 404]) {
      await withRequestLogging("/api/public", () => problem(status, "routine_rejection"))();
    }
    await withRequestLogging("/api/auth/github/callback", () =>
      markResponse(
        new Response(null, { status: 307 }),
        "github_oauth_state_validation_failed",
        undefined,
        "debug",
      ),
    )();
    await withRequestLogging("/api/public", () => new Response(null, { status: 429 }))();
    await withRequestLogging("/api/pairing/poll", () =>
      annotateResponse(problem(404, "pairing_not_found"), {}, "warn"),
    )();

    const completed = standardOutput.mock.calls
      .map(([record]) => JSON.parse(String(record)) as Record<string, unknown>)
      .filter((record) => record.event === "http_request_completed");
    expect(completed).toHaveLength(4);
    expect(completed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: "debug", status: 401, outcome: "routine_rejection" }),
        expect.objectContaining({ level: "debug", status: 403, outcome: "routine_rejection" }),
        expect.objectContaining({ level: "debug", status: 404, outcome: "routine_rejection" }),
        expect.objectContaining({
          level: "debug",
          status: 307,
          outcome: "github_oauth_state_validation_failed",
        }),
      ]),
    );
    const warnings = errorOutput.mock.calls.map(
      ([record]) => JSON.parse(String(record)) as Record<string, unknown>,
    );
    expect(warnings).toEqual([
      expect.objectContaining({ level: "warn", status: 429, outcome: "rate_limited" }),
      expect.objectContaining({ level: "warn", status: 404, outcome: "pairing_not_found" }),
    ]);
  });
});
