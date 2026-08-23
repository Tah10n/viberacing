import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeRateLimit: vi.fn(),
  query: vi.fn(),
  viewer: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ query: mocks.query }));
vi.mock("@/lib/rate-limit", () => ({ consumeRateLimit: mocks.consumeRateLimit }));
vi.mock("@/lib/session", () => ({ viewer: mocks.viewer }));
vi.mock("@/lib/request-log", () => ({
  withRequestLogging: (_route: string, handler: unknown) => handler,
}));

import { GET } from "./route";

const requestId = "33333333-3333-4333-8333-333333333333";
const context = { params: Promise.resolve({ id: requestId }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.viewer.mockResolvedValue({ id: "42", handle: "racer" });
  mocks.consumeRateLimit.mockResolvedValue(true);
  mocks.query.mockResolvedValue([{ status: "running", result_code: null }]);
});

describe("browser Sync status", () => {
  it("returns an owned run within the bounded polling quota", async () => {
    const response = await GET(
      new Request(`https://viberacing.example/api/accounts/sync/${requestId}`),
      context,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "running", resultCode: null });
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith("browser_sync_status_user", "42", 30, 60);
  });

  it("returns a terminal busy result for a server-rejected duplicate claim", async () => {
    mocks.query.mockResolvedValue([{ status: "failed", result_code: "busy" }]);

    const response = await GET(
      new Request(`https://viberacing.example/api/accounts/sync/${requestId}`),
      context,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "failed", resultCode: "busy" });
  });

  it("rejects excess polling before reading the run table", async () => {
    mocks.consumeRateLimit.mockResolvedValue(false);

    const response = await GET(
      new Request(`https://viberacing.example/api/accounts/sync/${requestId}`),
      context,
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: "rate_limited" });
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
