import { afterEach, describe, expect, it, vi } from "vitest";

const { consumeRateLimitMock, queryMock } = vi.hoisted(() => ({
  consumeRateLimitMock: vi.fn(),
  queryMock: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  clientAddress: (request: Request) => request.headers.get("x-real-ip") ?? "unknown",
  consumeRateLimit: consumeRateLimitMock,
}));
vi.mock("@/lib/db", () => ({ query: queryMock }));

import { POST } from "./route";

const installationId = "22222222-2222-4222-8222-222222222222";

function request(pollToken: string): Request {
  return new Request("https://viberacing.example/api/pairing/poll", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Real-IP": "203.0.113.10" },
    body: JSON.stringify({ installationId, pollToken }),
  });
}

describe("pairing poll pre-auth rate limiting", () => {
  afterEach(() => {
    consumeRateLimitMock.mockReset();
    queryMock.mockReset();
  });

  it("does not create a rate-limit key from an untrusted poll token", async () => {
    consumeRateLimitMock.mockResolvedValue(true);
    queryMock.mockResolvedValue([]);

    const response = await POST(request("attacker-controlled-random-poll-token-01"));

    expect(response.status).toBe(404);
    expect(consumeRateLimitMock).toHaveBeenCalledOnce();
    expect(consumeRateLimitMock).toHaveBeenCalledWith(
      "pairing_poll_pre_auth",
      "203.0.113.10",
      120,
      60,
    );
  });

  it("keys the authenticated poll quota by the server-side installation id", async () => {
    consumeRateLimitMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    queryMock.mockResolvedValue([{ id: installationId, status: "pending", pairing_pending: true }]);

    const response = await POST(request("synthetic-poll-token-that-is-long-enough"));

    expect(response.status).toBe(429);
    expect(consumeRateLimitMock).toHaveBeenNthCalledWith(
      1,
      "pairing_poll_pre_auth",
      "203.0.113.10",
      120,
      60,
    );
    expect(consumeRateLimitMock).toHaveBeenNthCalledWith(2, "pairing_poll", installationId, 40, 60);
  });

  it("keeps an active installation pending until its replacement token is approved", async () => {
    consumeRateLimitMock.mockResolvedValue(true);
    queryMock.mockResolvedValue([{ id: installationId, status: "active", pairing_pending: true }]);

    const response = await POST(request("replacement-poll-token-that-is-long-enough"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "pending" });
    expect(queryMock).toHaveBeenCalledOnce();
  });
});
