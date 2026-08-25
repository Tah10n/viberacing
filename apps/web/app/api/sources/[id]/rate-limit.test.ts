import { afterEach, describe, expect, it, vi } from "vitest";

const { consumeRateLimitMock, queryMock, transactionMock } = vi.hoisted(() => ({
  consumeRateLimitMock: vi.fn(),
  queryMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  clientAddress: () => ({ trusted: true, key: "203.0.113.50" }),
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

import { DELETE } from "./route";

const sourceId = "22222222-2222-4222-8222-222222222222";
const installationId = "11111111-1111-4111-8111-111111111111";
const token = "synthetic-device-token-that-is-long-enough";

function request(): Request {
  return new Request(`https://viberacing.example/api/sources/${sourceId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

const context = { params: Promise.resolve({ id: sourceId }) };

describe("source deletion admission ordering", () => {
  afterEach(() => {
    consumeRateLimitMock.mockReset();
    queryMock.mockReset();
    transactionMock.mockReset();
  });

  it("rejects the client before capability lookup or transaction", async () => {
    consumeRateLimitMock.mockResolvedValue(false);

    const response = await DELETE(request(), context);

    expect(response.status).toBe(429);
    expect(queryMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("does not open a transaction for an invalid capability", async () => {
    consumeRateLimitMock.mockResolvedValue(true);
    queryMock.mockResolvedValue([]);

    const response = await DELETE(request(), context);

    expect(response.status).toBe(401);
    expect(consumeRateLimitMock).toHaveBeenCalledOnce();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("limits the authenticated installation before mutation", async () => {
    consumeRateLimitMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    queryMock.mockResolvedValue([{ id: installationId }]);

    const response = await DELETE(request(), context);

    expect(response.status).toBe(429);
    expect(consumeRateLimitMock).toHaveBeenNthCalledWith(
      2,
      "source_delete",
      installationId,
      20,
      60,
    );
    expect(queryMock.mock.invocationCallOrder[0]).toBeLessThan(
      consumeRateLimitMock.mock.invocationCallOrder[1] ?? Number.NEGATIVE_INFINITY,
    );
    expect(transactionMock).not.toHaveBeenCalled();
  });
});
