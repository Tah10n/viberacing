import { afterEach, describe, expect, it, vi } from "vitest";

const { consumeRateLimitMock, transactionMock } = vi.hoisted(() => ({
  consumeRateLimitMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  clientAddress: () => ({ trusted: true, key: "203.0.113.40" }),
  clientAdmissionLimit: (_address: unknown, trusted: number) => trusted,
  consumeAdmissionRateLimit: async (
    scope: string,
    key: string,
    limit: number,
    _globalLimit: number,
    window: number,
  ) => ({ allowed: Boolean(await consumeRateLimitMock(scope, key, limit, window)), reason: null }),
  consumeRateLimit: consumeRateLimitMock,
}));
vi.mock("@/lib/db", () => ({ transaction: transactionMock }));

import { POST } from "./route";

const installationId = "11111111-1111-4111-8111-111111111111";
const installationSecret = "synthetic-installation-secret-that-is-long-enough";

function request(body: unknown): Request {
  return new Request("https://viberacing.example/api/pairing/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validBody(): unknown {
  return {
    protocolVersion: 2,
    connectorVersion: "0.2.0",
    installationId,
    installationSecret,
    sources: [
      {
        clientSourceId: "codex-desktop",
        agentId: "codex",
        collectionMethod: "codex_app_server",
        supportedSurface: "desktop",
        suggestedLabel: "Codex",
      },
    ],
    supersededClientSourceIds: [],
  };
}

describe("pairing start admission ordering", () => {
  afterEach(() => {
    consumeRateLimitMock.mockReset();
    transactionMock.mockReset();
  });

  it("rejects the client before parsing or shared quota", async () => {
    consumeRateLimitMock.mockResolvedValue(false);
    const incoming = request(validBody());

    const response = await POST(incoming);

    expect(response.status).toBe(429);
    expect(incoming.bodyUsed).toBe(false);
    expect(consumeRateLimitMock).toHaveBeenCalledOnce();
    expect(consumeRateLimitMock).toHaveBeenCalledWith("pairing_start", "203.0.113.40", 6, 60);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("does not spend installation or shared quota for malformed input", async () => {
    consumeRateLimitMock.mockResolvedValue(true);

    const response = await POST(request({ installationId }));

    expect(response.status).toBe(400);
    expect(consumeRateLimitMock).toHaveBeenCalledOnce();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("spends capability-key quota before shared quota and mutation", async () => {
    consumeRateLimitMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const response = await POST(request(validBody()));

    expect(response.status).toBe(429);
    expect(consumeRateLimitMock.mock.calls[1]?.[0]).toBe("pairing_installation");
    expect(consumeRateLimitMock).toHaveBeenNthCalledWith(
      3,
      "pairing_start_global",
      "all",
      2_000,
      60,
    );
    expect(consumeRateLimitMock.mock.invocationCallOrder[1]).toBeLessThan(
      consumeRateLimitMock.mock.invocationCallOrder[2] ?? Number.NEGATIVE_INFINITY,
    );
    expect(transactionMock).not.toHaveBeenCalled();
  });
});
