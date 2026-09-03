import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  rebuildAgentDailySummaries: vi.fn(),
  transaction: vi.fn(),
  viewer: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ transaction: mocks.transaction }));
vi.mock("@/lib/session", () => ({ viewer: mocks.viewer }));
vi.mock("@/lib/usage-summary", () => ({
  rebuildAgentDailySummaries: mocks.rebuildAgentDailySummaries,
}));
vi.mock("@/lib/request-log", () => ({
  withRequestLogging: (_route: string, handler: unknown) => handler,
}));

import { POST } from "./route";

const accountId = "11111111-1111-4111-8111-111111111111";

function request(confirm = true): Request {
  const body = new URLSearchParams({ accountId });
  if (confirm) body.set("confirm", "delete");
  return new Request("http://localhost:3000/api/accounts/delete", {
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "http://localhost:3000",
    },
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.viewer.mockResolvedValue({ id: "42" });
  mocks.transaction.mockImplementation(async (work: (client: unknown) => Promise<unknown>) =>
    work({ query: mocks.clientQuery }),
  );
});

describe("account deletion", () => {
  it("refuses to cascade through a primary Codex profile", async () => {
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [{ id: "42" }] })
      .mockResolvedValueOnce({ rows: [{ agent_id: "codex" }] })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] });

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "primary_account_has_linked_accounts",
    });
    expect(mocks.clientQuery).toHaveBeenCalledTimes(3);
    expect(mocks.rebuildAgentDailySummaries).not.toHaveBeenCalled();
  });

  it("deletes an unreferenced account after explicit confirmation", async () => {
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [{ id: "42" }] })
      .mockResolvedValueOnce({ rows: [{ agent_id: "codex" }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const response = await POST(request());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/dashboard?accountDeleted=1",
    );
    expect(mocks.rebuildAgentDailySummaries).toHaveBeenCalledWith(expect.anything(), "42", "codex");
  });

  it("still requires confirmation for an account with sources", async () => {
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [{ id: "42" }] })
      .mockResolvedValueOnce({ rows: [{ agent_id: "codex" }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] });

    const response = await POST(request(false));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "confirmation_required" });
    expect(mocks.clientQuery).toHaveBeenCalledTimes(4);
  });
});
