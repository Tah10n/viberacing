import { afterEach, describe, expect, it, vi } from "vitest";

const { consumeRateLimitMock, logInfoMock, logWarnMock, queryMock } = vi.hoisted(() => ({
  consumeRateLimitMock: vi.fn(),
  logInfoMock: vi.fn(),
  logWarnMock: vi.fn(),
  queryMock: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  clientAddress: () => ({ trusted: true, key: "203.0.113.30" }),
  clientAdmissionLimit: (_address: unknown, trusted: number) => trusted,
  consumeRateLimit: consumeRateLimitMock,
}));
vi.mock("@/lib/db", () => ({ query: queryMock }));
vi.mock("@/lib/log", () => ({ logInfo: logInfoMock, logWarn: logWarnMock }));
vi.mock("@/lib/request-log", () => ({
  withRequestLogging: (_route: string, handler: unknown) => handler,
}));

import { parseDiagnosticBody, POST } from "./route";

const deviceToken = "synthetic-device-token-that-is-long-enough";
const installationId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const codexSourceId = "33333333-3333-4333-8333-333333333333";
const qwenSourceId = "44444444-4444-4444-8444-444444444444";

function diagnosticRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://viberacing.example/api/installations/current/diagnostics", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${deviceToken}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function validBody(): {
  schemaVersion: number;
  connectorVersion: string;
  events: Record<string, unknown>[];
} {
  return {
    schemaVersion: 1,
    connectorVersion: "0.3.10",
    events: [
      {
        sourceId: codexSourceId,
        code: "codex_lineage_ambiguous",
        state: "opened",
        phase: "collect",
      },
      {
        sourceId: qwenSourceId,
        code: "pending_payload_rejected",
        state: "resolved",
        phase: "deliver",
      },
    ],
  };
}

function authenticate(
  sources = [
    { id: codexSourceId, agent_id: "codex" },
    { id: qwenSourceId, agent_id: "qwen_code" },
  ],
) {
  consumeRateLimitMock.mockResolvedValue(true);
  queryMock
    .mockResolvedValueOnce([{ id: installationId, user_id: userId }])
    .mockResolvedValueOnce(sources);
}

afterEach(() => {
  consumeRateLimitMock.mockReset();
  logInfoMock.mockReset();
  logWarnMock.mockReset();
  queryMock.mockReset();
});

describe("connector diagnostic payload", () => {
  it("accepts only allowlisted code, phase, and state combinations", () => {
    expect(parseDiagnosticBody(validBody())).not.toBeNull();
    for (const mutation of [
      { code: "future_code" },
      { state: "continuing" },
      { phase: "deliver" },
      { stack: "secret" },
    ]) {
      const body = validBody();
      body.events = [{ ...body.events[0], ...mutation }];
      expect(parseDiagnosticBody(body)).toBeNull();
    }
    expect(parseDiagnosticBody({ ...validBody(), schemaVersion: 2 })).toBeNull();
    expect(parseDiagnosticBody({ ...validBody(), connectorVersion: "0.3.10-beta" })).toBeNull();
    expect(parseDiagnosticBody({ ...validBody(), extra: true })).toBeNull();
  });

  it("rejects empty, oversized, and duplicate batches", () => {
    expect(parseDiagnosticBody({ ...validBody(), events: [] })).toBeNull();
    expect(
      parseDiagnosticBody({
        ...validBody(),
        events: Array.from({ length: 33 }, (_, index) => ({
          ...validBody().events[0],
          code: index % 2 === 0 ? "collector_failed" : "codex_components_incomplete",
        })),
      }),
    ).toBeNull();
    const event = validBody().events[0];
    expect(parseDiagnosticBody({ ...validBody(), events: [event, { ...event }] })).toBeNull();
  });
});

describe("connector diagnostic ingestion", () => {
  it("authenticates ownership before logging privacy-safe opened and resolved events", async () => {
    authenticate();

    const response = await POST(diagnosticRequest(validBody()));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ acceptedEvents: 2 });
    expect(logWarnMock).toHaveBeenCalledWith("connector_diagnostic", {
      agentId: "codex",
      diagnosticCode: "codex_lineage_ambiguous",
      diagnosticState: "opened",
      diagnosticPhase: "collect",
      connectorVersion: "0.3.10",
    });
    expect(logInfoMock).toHaveBeenCalledWith("connector_diagnostic", {
      agentId: "qwen_code",
      diagnosticCode: "pending_payload_rejected",
      diagnosticState: "resolved",
      diagnosticPhase: "deliver",
      connectorVersion: "0.3.10",
    });
    const serialized = JSON.stringify([...logWarnMock.mock.calls, ...logInfoMock.mock.calls]);
    expect(serialized).not.toContain(codexSourceId);
    expect(serialized).not.toContain(qwenSourceId);
    expect(serialized).not.toContain(installationId);
    expect(serialized).not.toContain(userId);
  });

  it("rejects a source outside the authenticated installation without partial logs", async () => {
    authenticate([{ id: codexSourceId, agent_id: "codex" }]);

    const response = await POST(diagnosticRequest(validBody()));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "unsupported_source" });
    expect(logWarnMock).not.toHaveBeenCalled();
    expect(logInfoMock).not.toHaveBeenCalled();
  });

  it("rejects hostile extra fields before they can reach logs", async () => {
    consumeRateLimitMock.mockResolvedValue(true);
    queryMock.mockResolvedValueOnce([{ id: installationId, user_id: userId }]);
    const body = validBody();
    body.events = [
      {
        ...body.events[0],
        message: "prompt at /private/repository",
        stack: "secret stack",
        env: "SECRET=value",
        command: "agent --token secret",
        transcript: "private response",
        providerId: "provider-session-id",
      },
    ];

    const response = await POST(diagnosticRequest(body));

    expect(response.status).toBe(400);
    expect(queryMock).toHaveBeenCalledOnce();
    expect(logWarnMock).not.toHaveBeenCalled();
    expect(logInfoMock).not.toHaveBeenCalled();
  });

  it("applies pre-auth, installation, user, and global rate limits in order", async () => {
    consumeRateLimitMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    queryMock.mockResolvedValueOnce([{ id: installationId, user_id: userId }]);

    const response = await POST(diagnosticRequest(validBody()));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(consumeRateLimitMock.mock.calls).toEqual([
      ["diagnostics_pre_auth", "203.0.113.30", 120, 60],
      ["diagnostics_installation", installationId, 30, 60],
      ["diagnostics_user", userId, 120, 60],
      ["diagnostics_global", "all", 10_000, 60],
    ]);
    expect(logWarnMock).not.toHaveBeenCalled();
  });

  it("bounds the request body before source lookup", async () => {
    consumeRateLimitMock.mockResolvedValue(true);
    queryMock.mockResolvedValueOnce([{ id: installationId, user_id: userId }]);

    const response = await POST(diagnosticRequest({ ...validBody(), padding: "x".repeat(20_000) }));

    expect(response.status).toBe(400);
    expect(queryMock).toHaveBeenCalledOnce();
    expect(logWarnMock).not.toHaveBeenCalled();
  });
});
