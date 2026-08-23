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
const secondRequestId = "44444444-4444-4444-8444-444444444444";
const thirdRequestId = "55555555-5555-4555-8555-555555555555";
const contextFor = (id: string) => ({ params: Promise.resolve({ id }) });
const context = contextFor(requestId);

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
    expect(mocks.consumeRateLimit).toHaveBeenNthCalledWith(
      1,
      "browser_sync_status_user",
      "42",
      300,
      60,
    );
    expect(mocks.consumeRateLimit).toHaveBeenNthCalledWith(
      2,
      "browser_sync_status_run",
      `42:${requestId}`,
      60,
      60,
    );
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

  it("isolates two waiting pollers and several running installations", async () => {
    const counts = new Map<string, number>();
    mocks.consumeRateLimit.mockImplementation((scope: string, key: string, limit: number) => {
      const bucket = `${scope}:${key}`;
      const count = (counts.get(bucket) ?? 0) + 1;
      counts.set(bucket, count);
      return Promise.resolve(count <= limit);
    });

    const waiting = await Promise.all(
      [requestId, secondRequestId].flatMap((id) =>
        Array.from({ length: 30 }, () =>
          GET(new Request(`https://viberacing.example/api/accounts/sync/${id}`), contextFor(id)),
        ),
      ),
    );
    const running = await Promise.all(
      [requestId, secondRequestId, thirdRequestId].flatMap((id) =>
        Array.from({ length: 12 }, () =>
          GET(new Request(`https://viberacing.example/api/accounts/sync/${id}`), contextFor(id)),
        ),
      ),
    );

    expect([...waiting, ...running].every((response) => response.status === 200)).toBe(true);
    expect(counts.get("browser_sync_status_user:42")).toBe(96);
    expect(counts.get(`browser_sync_status_run:42:${requestId}`)).toBe(42);
    expect(counts.get(`browser_sync_status_run:42:${secondRequestId}`)).toBe(42);
    expect(counts.get(`browser_sync_status_run:42:${thirdRequestId}`)).toBe(12);
  });

  it("rejects the aggregate quota before reading the run table", async () => {
    mocks.consumeRateLimit.mockResolvedValueOnce(false);

    const response = await GET(
      new Request(`https://viberacing.example/api/accounts/sync/${requestId}`),
      context,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    await expect(response.json()).resolves.toEqual({ error: "rate_limited" });
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.consumeRateLimit).toHaveBeenCalledTimes(1);
  });

  it("rejects one abusive run without spending another run quota", async () => {
    mocks.consumeRateLimit.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const response = await GET(
      new Request(`https://viberacing.example/api/accounts/sync/${requestId}`),
      context,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.consumeRateLimit).toHaveBeenNthCalledWith(
      2,
      "browser_sync_status_run",
      `42:${requestId}`,
      60,
      60,
    );
  });
});
