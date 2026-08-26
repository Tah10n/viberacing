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

function request(
  body: Record<string, string> = { accountId, grant: "g".repeat(43), requestId },
): Request {
  return new Request("https://viberacing.example/api/installations/current/sync/claim", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${"d".repeat(43)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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
      .mockResolvedValueOnce({
        rows: [{ id: installationId, user_id: "42", browser_sync_protocol: 1 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: sourceId, agent_id: "codex", agent_account_id: accountId }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ grant_hash: Buffer.alloc(32) }] })
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
    expect(mocks.clientQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringMatching(/\$3::uuid IS NULL OR agent_account_id = \$3/),
      [installationId, "42", accountId],
    );
    expect(mocks.clientQuery).toHaveBeenNthCalledWith(
      6,
      expect.stringMatching(/scope, agent_account_id, agent_id, status/),
      [requestId, installationId, "42", "account", accountId, "codex"],
    );
  });

  it("authorizes one installation-scoped run for all active local agents", async () => {
    const secondSourceId = "55555555-5555-4555-8555-555555555555";
    const secondAccountId = "66666666-6666-4666-8666-666666666666";
    mocks.clientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: installationId, user_id: "42", browser_sync_protocol: 2 }],
      })
      .mockResolvedValueOnce({
        rows: [
          { id: sourceId, agent_id: "codex", agent_account_id: accountId },
          { id: secondSourceId, agent_id: "claude_code", agent_account_id: secondAccountId },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ grant_hash: Buffer.alloc(32) }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const response = await POST(
      request({ grant: "g".repeat(43), requestId, scope: "installation" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      requestId,
      sourceIds: [sourceId, secondSourceId],
    });
    expect(mocks.clientQuery).toHaveBeenNthCalledWith(3, expect.any(String), [
      installationId,
      "42",
      null,
    ]);
    expect(mocks.clientQuery).toHaveBeenNthCalledWith(
      6,
      expect.stringMatching(/INSERT INTO browser_sync_runs/),
      [requestId, installationId, "42", "installation", null, null],
    );
  });

  it("rejects an oversized installation before consuming its grant or creating a run", async () => {
    const sources = Array.from({ length: 33 }, (_, index) => ({
      id: `${index.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`,
      agent_id: "codex",
      agent_account_id: accountId,
    }));
    mocks.clientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: installationId, user_id: "42", browser_sync_protocol: 2 }],
      })
      .mockResolvedValueOnce({ rows: sources });

    const response = await POST(
      request({ grant: "g".repeat(43), requestId, scope: "installation" }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "browser_sync_source_limit" });
    expect(mocks.clientQuery).toHaveBeenCalledTimes(3);
    const queries = mocks.clientQuery.mock.calls.map(([sql]) => String(sql));
    expect(queries.some((sql) => sql.includes("DELETE FROM browser_sync_grants"))).toBe(false);
    expect(queries.some((sql) => sql.includes("INSERT INTO browser_sync_runs"))).toBe(false);
  });

  it("rejects installation scope before consuming the grant for an account-only handler", async () => {
    mocks.clientQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] }).mockResolvedValueOnce({
      rows: [{ id: installationId, user_id: "42", browser_sync_protocol: 1 }],
    });

    const response = await POST(
      request({ grant: "g".repeat(43), requestId, scope: "installation" }),
    );

    expect(response.status).toBe(426);
    await expect(response.json()).resolves.toEqual({ error: "browser_sync_upgrade_required" });
    expect(mocks.clientQuery).toHaveBeenCalledTimes(2);
    expect(mocks.clientQuery.mock.calls[1]?.[0]).toContain("browser_sync_protocol");
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
      .mockResolvedValueOnce({
        rows: [{ id: installationId, user_id: "42", browser_sync_protocol: 1 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: sourceId, agent_id: "codex", agent_account_id: accountId }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ grant_hash: Buffer.alloc(32) }] })
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
      [requestId, installationId, "42", "account", accountId, "codex"],
    );
  });
});
