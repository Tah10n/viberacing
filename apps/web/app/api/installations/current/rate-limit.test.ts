import { afterEach, describe, expect, it, vi } from "vitest";

const { consumeRateLimitMock, queryMock, transactionMock } = vi.hoisted(() => ({
  consumeRateLimitMock: vi.fn(),
  queryMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({ consumeRateLimit: consumeRateLimitMock }));
vi.mock("@/lib/db", () => ({ query: queryMock, transaction: transactionMock }));

import { POST } from "./route";

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

  it("applies the global quota before authentication lookup", async () => {
    consumeRateLimitMock.mockResolvedValue(false);

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(consumeRateLimitMock).toHaveBeenCalledOnce();
    expect(consumeRateLimitMock).toHaveBeenCalledWith("reconciliation_global", "all", 10_000, 60);
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
});
