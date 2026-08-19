import { afterEach, describe, expect, it, vi } from "vitest";

const { consumeRateLimitMock, queryMock, transactionMock } = vi.hoisted(() => ({
  consumeRateLimitMock: vi.fn(),
  queryMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  clientAddress: () => ({ trusted: true, key: "203.0.113.30" }),
  clientAdmissionLimit: (_address: unknown, trusted: number) => trusted,
  consumeRateLimit: consumeRateLimitMock,
}));
vi.mock("@/lib/db", () => ({ query: queryMock, transaction: transactionMock }));

import { DELETE, POST } from "./route";

const deviceToken = "synthetic-device-token-that-is-long-enough";
const installationId = "11111111-1111-4111-8111-111111111111";
const sourceId = "22222222-2222-4222-8222-222222222222";

function request(): Request {
  return new Request("https://viberacing.example/api/installations/current", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${deviceToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sourceIds: [sourceId] }),
  });
}

describe("compact reconciliation rate limiting", () => {
  afterEach(() => {
    consumeRateLimitMock.mockReset();
    queryMock.mockReset();
    transactionMock.mockReset();
  });

  it("applies the client quota before authentication lookup", async () => {
    consumeRateLimitMock.mockResolvedValue(false);

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(consumeRateLimitMock).toHaveBeenCalledOnce();
    expect(consumeRateLimitMock).toHaveBeenCalledWith(
      "reconciliation_pre_auth",
      "203.0.113.30",
      120,
      60,
    );
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("keys the authenticated quota by the server-side installation id", async () => {
    consumeRateLimitMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    queryMock.mockResolvedValue([{ id: installationId }]);

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(consumeRateLimitMock).toHaveBeenNthCalledWith(
      2,
      "reconciliation_installation",
      installationId,
      60,
      60,
    );
    expect(queryMock).toHaveBeenCalledOnce();
  });

  it("applies the shared quota only after capability and installation limits", async () => {
    consumeRateLimitMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    queryMock.mockResolvedValue([{ id: installationId }]);

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(consumeRateLimitMock).toHaveBeenNthCalledWith(
      3,
      "reconciliation_global",
      "all",
      10_000,
      60,
    );
    expect(queryMock.mock.invocationCallOrder[0]).toBeLessThan(
      consumeRateLimitMock.mock.invocationCallOrder[1] ?? Number.NEGATIVE_INFINITY,
    );
  });
});

describe("installation deletion admission ordering", () => {
  afterEach(() => {
    consumeRateLimitMock.mockReset();
    queryMock.mockReset();
    transactionMock.mockReset();
  });

  it("does not open a transaction for an invalid capability", async () => {
    consumeRateLimitMock.mockResolvedValue(true);
    queryMock.mockResolvedValue([]);

    const response = await DELETE(request());

    expect(response.status).toBe(401);
    expect(consumeRateLimitMock).toHaveBeenCalledOnce();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("applies the destructive installation quota before the transaction", async () => {
    consumeRateLimitMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    queryMock.mockResolvedValue([{ id: installationId }]);

    const response = await DELETE(request());

    expect(response.status).toBe(429);
    expect(consumeRateLimitMock).toHaveBeenNthCalledWith(
      2,
      "installation_delete",
      installationId,
      5,
      300,
    );
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("keeps an authenticated concurrent repeat idempotent", async () => {
    consumeRateLimitMock.mockResolvedValue(true);
    queryMock.mockResolvedValue([{ id: installationId }]);
    const clientQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    transactionMock.mockImplementation(
      (callback: (client: { query: typeof clientQuery }) => Promise<unknown>) =>
        callback({ query: clientQuery }),
    );

    const response = await DELETE(request());

    expect(response.status).toBe(204);
    expect(clientQuery).toHaveBeenCalledOnce();
  });
});
