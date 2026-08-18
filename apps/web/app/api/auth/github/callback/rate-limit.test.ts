import { afterEach, describe, expect, it, vi } from "vitest";

const { consumeRateLimitMock, cookieDeleteMock, cookieGetMock } = vi.hoisted(() => ({
  consumeRateLimitMock: vi.fn(),
  cookieDeleteMock: vi.fn(),
  cookieGetMock: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: cookieGetMock, delete: cookieDeleteMock }),
}));
vi.mock("@/lib/config", () => ({
  githubApiOrigin: () => new URL("https://api.github.example"),
  githubWebOrigin: () => new URL("https://github.example"),
  publicOrigin: () => new URL("https://viberacing.example"),
  requiredEnv: () => "synthetic",
}));
vi.mock("@/lib/rate-limit", () => ({
  clientAddress: (request: Request) => request.headers.get("x-real-ip") ?? "unknown",
  consumeRateLimit: consumeRateLimitMock,
}));

import { GET } from "./route";

function request(query = ""): Request {
  return new Request(`https://viberacing.example/api/auth/github/callback${query}`, {
    headers: { "X-Real-IP": "203.0.113.12" },
  });
}

describe("OAuth callback rate limiting", () => {
  afterEach(() => {
    consumeRateLimitMock.mockReset();
    cookieDeleteMock.mockReset();
    cookieGetMock.mockReset();
  });

  it("applies the trusted client quota before reading OAuth state", async () => {
    consumeRateLimitMock.mockResolvedValue(false);

    const response = await GET(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(consumeRateLimitMock).toHaveBeenCalledOnce();
    expect(consumeRateLimitMock).toHaveBeenCalledWith("oauth_callback", "203.0.113.12", 20, 60);
    expect(cookieGetMock).not.toHaveBeenCalled();
  });

  it("does not consume the global quota without the state cookie", async () => {
    consumeRateLimitMock.mockResolvedValue(true);
    cookieGetMock.mockReturnValue(undefined);

    const response = await GET(request("?code=synthetic&state=synthetic-state"));

    expect(response.status).toBe(307);
    expect(consumeRateLimitMock).toHaveBeenCalledOnce();
    expect(consumeRateLimitMock).not.toHaveBeenCalledWith("oauth_callback_global", "all", 500, 60);
  });

  it("applies the global quota only after constant-time state validation", async () => {
    consumeRateLimitMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    cookieGetMock.mockImplementation((name: string) =>
      name === "vr_oauth_state" ? { value: "matching-state" } : undefined,
    );

    const response = await GET(request("?code=synthetic&state=matching-state"));

    expect(response.status).toBe(429);
    expect(consumeRateLimitMock).toHaveBeenNthCalledWith(
      2,
      "oauth_callback_global",
      "all",
      500,
      60,
    );
  });
});
