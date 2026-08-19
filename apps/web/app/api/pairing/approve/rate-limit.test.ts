import { afterEach, describe, expect, it, vi } from "vitest";

const { consumeRateLimitMock, transactionMock, viewerMock } = vi.hoisted(() => ({
  consumeRateLimitMock: vi.fn(),
  transactionMock: vi.fn(),
  viewerMock: vi.fn(),
}));

vi.mock("@/lib/config", () => ({ publicOrigin: () => new URL("https://viberacing.example") }));
vi.mock("@/lib/db", () => ({ transaction: transactionMock }));
vi.mock("@/lib/rate-limit", () => ({
  clientAddress: (request: Request) => request.headers.get("x-real-ip") ?? "unknown",
  consumeRateLimit: consumeRateLimitMock,
}));
vi.mock("@/lib/session", () => ({ viewer: viewerMock }));

import { POST } from "./route";

function request(): Request {
  return new Request("https://viberacing.example/api/pairing/approve", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://viberacing.example",
      "X-Real-IP": "203.0.113.12",
    },
    body: new URLSearchParams({ code: "ABCD1234" }),
  });
}

describe("pairing approval rate limiting", () => {
  afterEach(() => {
    consumeRateLimitMock.mockReset();
    transactionMock.mockReset();
    viewerMock.mockReset();
  });

  it("applies a trusted client quota before session work", async () => {
    consumeRateLimitMock.mockResolvedValue(false);

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(consumeRateLimitMock).toHaveBeenCalledOnce();
    expect(consumeRateLimitMock).toHaveBeenCalledWith(
      "pairing_approve_pre_auth",
      "203.0.113.12",
      60,
      60,
    );
    expect(viewerMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("does not let an unauthenticated request consume the global quota", async () => {
    consumeRateLimitMock.mockResolvedValue(true);
    viewerMock.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(consumeRateLimitMock).toHaveBeenCalledOnce();
    expect(consumeRateLimitMock).not.toHaveBeenCalledWith(
      "pairing_approve_global",
      "all",
      2_000,
      60,
    );
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("applies the user quota before the authenticated global quota", async () => {
    consumeRateLimitMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    viewerMock.mockResolvedValue({ id: "42", handle: "octocat" });

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(consumeRateLimitMock).toHaveBeenNthCalledWith(2, "pairing_approve_user", "42", 20, 60);
    expect(consumeRateLimitMock).not.toHaveBeenCalledWith(
      "pairing_approve_global",
      "all",
      2_000,
      60,
    );
  });

  it("uses the global quota only for authenticated work within the user quota", async () => {
    consumeRateLimitMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    viewerMock.mockResolvedValue({ id: "42", handle: "octocat" });

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(consumeRateLimitMock).toHaveBeenNthCalledWith(
      3,
      "pairing_approve_global",
      "all",
      2_000,
      60,
    );
    expect(transactionMock).not.toHaveBeenCalled();
  });
});
