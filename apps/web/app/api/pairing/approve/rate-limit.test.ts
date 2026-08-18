import { afterEach, describe, expect, it, vi } from "vitest";

const { consumeRateLimitMock, transactionMock, viewerMock } = vi.hoisted(() => ({
  consumeRateLimitMock: vi.fn(),
  transactionMock: vi.fn(),
  viewerMock: vi.fn(),
}));

vi.mock("@/lib/config", () => ({ publicOrigin: () => new URL("https://viberacing.example") }));
vi.mock("@/lib/db", () => ({ transaction: transactionMock }));
vi.mock("@/lib/rate-limit", () => ({ consumeRateLimit: consumeRateLimitMock }));
vi.mock("@/lib/session", () => ({ viewer: viewerMock }));

import { POST } from "./route";

function request(): Request {
  return new Request("https://viberacing.example/api/pairing/approve", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://viberacing.example",
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

  it("applies the global quota before session and transaction work", async () => {
    consumeRateLimitMock.mockResolvedValue(false);

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(consumeRateLimitMock).toHaveBeenCalledWith("pairing_approve_global", "all", 2_000, 60);
    expect(viewerMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("keys the authenticated quota by the server-side user id", async () => {
    consumeRateLimitMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    viewerMock.mockResolvedValue({ id: "42", handle: "octocat" });

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(consumeRateLimitMock).toHaveBeenNthCalledWith(2, "pairing_approve_user", "42", 20, 60);
    expect(transactionMock).not.toHaveBeenCalled();
  });
});
