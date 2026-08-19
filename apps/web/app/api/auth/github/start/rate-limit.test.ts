import { afterEach, describe, expect, it, vi } from "vitest";

const { consumeRateLimitMock, cookieSetMock } = vi.hoisted(() => ({
  consumeRateLimitMock: vi.fn(),
  cookieSetMock: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ set: cookieSetMock }),
}));
vi.mock("@/lib/config", () => ({
  githubWebOrigin: () => new URL("https://github.example"),
  publicOrigin: () => new URL("https://viberacing.example"),
  requiredEnv: () => "synthetic-client",
  secureCookies: () => true,
}));
vi.mock("@/lib/rate-limit", () => ({
  clientAddress: (request: Request) =>
    request.headers.get("x-real-ip") ?? "untrusted-forwarding-headers",
  consumeRateLimit: consumeRateLimitMock,
}));

import { GET } from "./route";

describe("OAuth start rate limiting", () => {
  afterEach(() => {
    consumeRateLimitMock.mockReset();
    cookieSetMock.mockReset();
  });

  it("limits a trusted client without a globally exhaustible bucket", async () => {
    consumeRateLimitMock.mockResolvedValue(false);
    const request = new Request("https://viberacing.example/api/auth/github/start", {
      headers: { "X-Real-IP": "203.0.113.12" },
    });

    const response = await GET(request);

    expect(response.status).toBe(429);
    expect(consumeRateLimitMock).toHaveBeenCalledOnce();
    expect(consumeRateLimitMock).toHaveBeenCalledWith("oauth_start", "203.0.113.12", 20, 60);
    expect(cookieSetMock).not.toHaveBeenCalled();
  });

  it("does not collapse untrusted forwarding headers into a global pre-auth bucket", async () => {
    const response = await GET(
      new Request("https://viberacing.example/api/auth/github/start?next=/dashboard"),
    );

    expect(response.status).toBe(307);
    expect(consumeRateLimitMock).not.toHaveBeenCalled();
    expect(cookieSetMock).toHaveBeenCalledTimes(2);
  });
});
