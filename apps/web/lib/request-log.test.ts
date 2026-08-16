import { afterEach, describe, expect, it, vi } from "vitest";
import { annotateResponse, problem } from "./http";
import { withRequestLogging } from "./request-log";

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
});
