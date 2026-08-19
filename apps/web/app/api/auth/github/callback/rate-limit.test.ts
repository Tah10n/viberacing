import { afterEach, describe, expect, it, vi } from "vitest";

const {
  consumeRateLimitMock,
  cookieDeleteMock,
  cookieGetMock,
  createSessionMock,
  fetchMock,
  transactionMock,
} = vi.hoisted(() => ({
  consumeRateLimitMock: vi.fn(),
  cookieDeleteMock: vi.fn(),
  cookieGetMock: vi.fn(),
  createSessionMock: vi.fn(),
  fetchMock: vi.fn(),
  transactionMock: vi.fn(),
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
vi.mock("@/lib/db", () => ({ transaction: transactionMock }));
vi.mock("@/lib/session", () => ({ createSession: createSessionMock }));

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
    createSessionMock.mockReset();
    fetchMock.mockReset();
    transactionMock.mockReset();
    vi.unstubAllGlobals();
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

  it("does not consume the global quota when a matching state carries an invalid OAuth code", async () => {
    consumeRateLimitMock.mockResolvedValue(true);
    cookieGetMock.mockImplementation((name: string) =>
      name === "vr_oauth_state" ? { value: "matching-state" } : undefined,
    );
    fetchMock.mockResolvedValue(Response.json({ error: "bad_verification_code" }, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request("?code=forged-code&state=matching-state"));

    expect(response.status).toBe(307);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(new URL(fetchMock.mock.calls[0]?.[0] as string).pathname).toBe(
      "/login/oauth/access_token",
    );
    expect(consumeRateLimitMock).toHaveBeenCalledOnce();
    expect(consumeRateLimitMock).not.toHaveBeenCalledWith("oauth_callback_global", "all", 500, 60);
    expect(transactionMock).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("does not consume the global quota for an invalid successful token response", async () => {
    consumeRateLimitMock.mockResolvedValue(true);
    cookieGetMock.mockImplementation((name: string) =>
      name === "vr_oauth_state" ? { value: "matching-state" } : undefined,
    );
    fetchMock.mockResolvedValue(Response.json({ access_token: "" }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request("?code=forged-code&state=matching-state"));

    expect(response.status).toBe(307);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(consumeRateLimitMock).toHaveBeenCalledOnce();
    expect(consumeRateLimitMock).not.toHaveBeenCalledWith("oauth_callback_global", "all", 500, 60);
    expect(transactionMock).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("applies the global quota after token validation and before profile or database work", async () => {
    consumeRateLimitMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    cookieGetMock.mockImplementation((name: string) =>
      name === "vr_oauth_state" ? { value: "matching-state" } : undefined,
    );
    fetchMock.mockResolvedValue(Response.json({ access_token: "validated-access-token" }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request("?code=valid-code&state=matching-state"));

    expect(response.status).toBe(429);
    expect(consumeRateLimitMock).toHaveBeenNthCalledWith(
      2,
      "oauth_callback_global",
      "all",
      500,
      60,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY).toBeLessThan(
      consumeRateLimitMock.mock.invocationCallOrder[1] ?? Number.NEGATIVE_INFINITY,
    );
    expect(new URL(fetchMock.mock.calls[0]?.[0] as string).pathname).toBe(
      "/login/oauth/access_token",
    );
    expect(transactionMock).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("continues to profile and session work only after the global quota succeeds", async () => {
    consumeRateLimitMock.mockResolvedValue(true);
    cookieGetMock.mockImplementation((name: string) =>
      name === "vr_oauth_state" ? { value: "matching-state" } : undefined,
    );
    fetchMock
      .mockResolvedValueOnce(Response.json({ access_token: "validated-access-token" }))
      .mockResolvedValueOnce(Response.json({ id: 42, login: "octocat" }));
    transactionMock.mockResolvedValue({ id: "user-id" });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request("?code=valid-code&state=matching-state"));

    expect(response.status).toBe(307);
    expect(consumeRateLimitMock).toHaveBeenNthCalledWith(
      2,
      "oauth_callback_global",
      "all",
      500,
      60,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY).toBeLessThan(
      consumeRateLimitMock.mock.invocationCallOrder[1] ?? Number.NEGATIVE_INFINITY,
    );
    expect(
      consumeRateLimitMock.mock.invocationCallOrder[1] ?? Number.POSITIVE_INFINITY,
    ).toBeLessThan(fetchMock.mock.invocationCallOrder[1] ?? Number.NEGATIVE_INFINITY);
    expect(new URL(fetchMock.mock.calls[1]?.[0] as string).pathname).toBe("/user");
    expect(transactionMock).toHaveBeenCalledOnce();
    expect(createSessionMock).toHaveBeenCalledWith("user-id");
  });
});
