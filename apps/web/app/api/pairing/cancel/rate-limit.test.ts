import { afterEach, describe, expect, it, vi } from "vitest";

const { consumeRateLimitMock, queryMock, transactionMock } = vi.hoisted(() => ({
  consumeRateLimitMock: vi.fn(),
  queryMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  clientAddress: (request: Request) => ({
    trusted: true,
    key: request.headers.get("x-real-ip") ?? "unknown",
  }),
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
vi.mock("@/lib/db", () => ({ query: queryMock, transaction: transactionMock }));

import { POST } from "./route";

const installationId = "22222222-2222-4222-8222-222222222222";
const pollToken = "synthetic-poll-token-that-is-long-enough";

function request(body: unknown = { installationId, pollToken }): Request {
  return new Request("https://viberacing.example/api/pairing/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Real-IP": "203.0.113.20" },
    body: JSON.stringify(body),
  });
}

describe("pairing cancellation boundaries", () => {
  afterEach(() => {
    consumeRateLimitMock.mockReset();
    queryMock.mockReset();
    transactionMock.mockReset();
  });

  it("rejects the client before parsing, authentication, or global quota", async () => {
    consumeRateLimitMock.mockResolvedValue(false);

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(consumeRateLimitMock).toHaveBeenNthCalledWith(
      1,
      "pairing_cancel_pre_auth",
      "203.0.113.20",
      120,
      60,
    );
    expect(queryMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects extra fields before accessing pairing state", async () => {
    consumeRateLimitMock.mockResolvedValue(true);
    queryMock.mockResolvedValue([]);

    const response = await POST(request({ installationId, pollToken, path: "/private" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_request" });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("does not spend authenticated or global quota for an invalid capability", async () => {
    consumeRateLimitMock.mockResolvedValue(true);
    queryMock.mockResolvedValue([]);

    const response = await POST(request());

    expect(response.status).toBe(204);
    expect(consumeRateLimitMock).toHaveBeenCalledOnce();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects the global valid-operation quota before mutation", async () => {
    consumeRateLimitMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    queryMock.mockResolvedValue([{ id: installationId }]);

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(consumeRateLimitMock).toHaveBeenNthCalledWith(
      2,
      "pairing_cancel",
      installationId,
      20,
      60,
    );
    expect(consumeRateLimitMock).toHaveBeenNthCalledWith(
      3,
      "pairing_cancel_global",
      "all",
      10_000,
      60,
    );
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("is idempotent when the exact attempt no longer exists", async () => {
    consumeRateLimitMock.mockResolvedValue(true);
    queryMock.mockResolvedValue([{ id: installationId }]);
    const query = vi.fn().mockResolvedValue({ rows: [] });
    transactionMock.mockImplementation(
      (callback: (client: { query: typeof query }) => Promise<unknown>) => callback({ query }),
    );

    const response = await POST(request());

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(query).toHaveBeenCalledTimes(2);
  });
});
