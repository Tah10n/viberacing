import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  consumeRateLimit: vi.fn(),
  inTransaction: false,
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  transaction: mocks.transaction,
}));
vi.mock("@/lib/rate-limit", () => ({
  clientAddress: () => ({ trusted: true, key: "127.0.0.1" }),
  clientAdmissionLimit: (_address: unknown, trustedLimit: number) => trustedLimit,
  consumeAdmissionRateLimit: async (
    scope: string,
    key: string,
    limit: number,
    _globalLimit: number,
    window: number,
  ) => ({
    allowed: Boolean(await mocks.consumeRateLimit(scope, key, limit, window)),
    reason: null,
  }),
  consumeRateLimit: mocks.consumeRateLimit,
}));
vi.mock("@/lib/request-log", () => ({
  withRequestLogging: (_route: string, handler: unknown) => handler,
}));

import { POST } from "./route";

const installationId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const sourceId = "44444444-4444-4444-8444-444444444444";

function request(): Request {
  return new Request("https://viberacing.example/api/installations/current/sync/claim", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${"d".repeat(43)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ accountId, grant: "g".repeat(43), requestId }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inTransaction = false;
  mocks.consumeRateLimit.mockImplementation(() => {
    if (mocks.inTransaction) throw new Error("rate limiter requested a nested pool connection");
    return Promise.resolve(true);
  });
  mocks.transaction.mockImplementation(async (work: (client: unknown) => Promise<unknown>) => {
    mocks.inTransaction = true;
    try {
      return await work({ query: mocks.clientQuery });
    } finally {
      mocks.inTransaction = false;
    }
  });
});

describe("browser Sync claim", () => {
  it("authenticates and serializes the installation inside the claim transaction", async () => {
    mocks.clientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: installationId, user_id: "42" }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ grant_hash: Buffer.alloc(32) }] })
      .mockResolvedValueOnce({ rows: [{ id: sourceId, agent_id: "codex" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ requestId, sourceIds: [sourceId] });
    expect(mocks.consumeRateLimit).toHaveBeenCalledTimes(1);
    expect(mocks.clientQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/device_token_hash = \$1[\s\S]*FOR UPDATE/),
      [expect.any(Buffer)],
    );
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("rejects the pre-auth admission quota without reserving a transaction connection", async () => {
    mocks.consumeRateLimit.mockResolvedValueOnce(false);

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("atomically rejects another recent run before starting connector work", async () => {
    mocks.clientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: installationId, user_id: "42" }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ grant_hash: Buffer.alloc(32) }] })
      .mockResolvedValueOnce({ rows: [{ id: sourceId, agent_id: "codex" }] })
      .mockResolvedValueOnce({ rows: [{ id: "55555555-5555-4555-8555-555555555555" }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    await expect(response.json()).resolves.toEqual({ error: "sync_rate_limited" });
    expect(mocks.clientQuery).toHaveBeenCalledTimes(6);
    expect(mocks.clientQuery).toHaveBeenNthCalledWith(
      5,
      expect.stringMatching(
        /browser_sync_runs[\s\S]*interval '60 seconds'[\s\S]*IS DISTINCT FROM 'busy'/,
      ),
      [installationId, "42"],
    );
    expect(mocks.clientQuery).toHaveBeenNthCalledWith(
      6,
      expect.stringMatching(/INSERT INTO browser_sync_runs[\s\S]*'failed', 'busy'/),
      [requestId, installationId, "42", accountId, "codex"],
    );
  });
});
