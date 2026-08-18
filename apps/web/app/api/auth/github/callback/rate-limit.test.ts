import { afterEach, describe, expect, it, vi } from "vitest";

const { consumeRateLimitMock } = vi.hoisted(() => ({ consumeRateLimitMock: vi.fn() }));

vi.mock("@/lib/rate-limit", () => ({
  clientAddress: (request: Request) => request.headers.get("x-real-ip") ?? "unknown",
  consumeRateLimit: consumeRateLimitMock,
}));

import { GET } from "./route";

function request(): Request {
  return new Request("https://viberacing.example/api/auth/github/callback", {
    headers: { "X-Real-IP": "203.0.113.12" },
  });
}

describe("OAuth callback rate limiting", () => {
  afterEach(() => consumeRateLimitMock.mockReset());

  it("applies the global quota before reading OAuth state", async () => {
    consumeRateLimitMock.mockResolvedValue(false);

    const response = await GET(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(consumeRateLimitMock).toHaveBeenCalledOnce();
    expect(consumeRateLimitMock).toHaveBeenCalledWith("oauth_callback_global", "all", 500, 60);
  });

  it("applies the client quota before an outbound GitHub request", async () => {
    consumeRateLimitMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const response = await GET(request());

    expect(response.status).toBe(429);
    expect(consumeRateLimitMock).toHaveBeenNthCalledWith(
      2,
      "oauth_callback",
      "203.0.113.12",
      20,
      60,
    );
  });
});
