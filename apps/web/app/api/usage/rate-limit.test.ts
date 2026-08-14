import { afterEach, describe, expect, it, vi } from "vitest";

const { consumeRateLimitMock, queryMock, transactionMock } = vi.hoisted(() => ({
  consumeRateLimitMock: vi.fn(),
  queryMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  clientAddress: (request: Request) => request.headers.get("x-real-ip") ?? "unknown",
  consumeRateLimit: consumeRateLimitMock,
}));
vi.mock("@/lib/db", () => ({ query: queryMock, transaction: transactionMock }));

import { POST } from "./route";

const deviceToken = "synthetic-device-token-that-is-long-enough";
const installationId = "11111111-1111-4111-8111-111111111111";

function request(token = deviceToken): Request {
  return new Request("https://viberacing.example/api/usage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Real-IP": "203.0.113.9",
    },
    body: JSON.stringify({ protocolVersion: 2, snapshots: [] }),
  });
}

describe("usage pre-auth rate limiting", () => {
  afterEach(() => {
    consumeRateLimitMock.mockReset();
    queryMock.mockReset();
    transactionMock.mockReset();
  });

  it("does not create a rate-limit key from an untrusted bearer token", async () => {
    consumeRateLimitMock.mockResolvedValue(true);
    queryMock.mockResolvedValue([]);

    const response = await POST(request("attacker-controlled-random-token-0001"));

    expect(response.status).toBe(401);
    expect(consumeRateLimitMock).toHaveBeenCalledTimes(1);
    expect(consumeRateLimitMock.mock.calls[0]?.slice(0, 2)).toEqual([
      "usage_pre_auth",
      "203.0.113.9",
    ]);
    expect(consumeRateLimitMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("attacker-controlled"),
      expect.anything(),
      expect.anything(),
    );
  });

  it("keys the authenticated quota by the server-side installation id", async () => {
    consumeRateLimitMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    queryMock.mockResolvedValue([{ id: installationId, user_id: "1" }]);

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(consumeRateLimitMock).toHaveBeenNthCalledWith(
      1,
      "usage_pre_auth",
      "203.0.113.9",
      120,
      60,
    );
    expect(consumeRateLimitMock).toHaveBeenNthCalledWith(2, "usage_sync", installationId, 30, 60);
  });
});
