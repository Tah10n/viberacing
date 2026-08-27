import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), viewer: vi.fn() }));

vi.mock("@/lib/db", () => ({ query: mocks.query }));
vi.mock("@/lib/session", () => ({ viewer: mocks.viewer }));
vi.mock("@/lib/request-log", () => ({
  withRequestLogging: (_route: string, handler: unknown) => handler,
}));

import { POST } from "./route";

const sourceId = "616e2e21-d41f-48cf-8b2e-38ad1b90faba";

function request(body = `sourceId=${sourceId}`, origin = "http://localhost:3000"): Request {
  return new Request("http://localhost:3000/api/installations/codex-hook-notice/dismiss", {
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: origin,
    },
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.viewer.mockResolvedValue({ id: "42" });
  mocks.query.mockResolvedValue([]);
});

describe("Codex hook approval notice dismissal", () => {
  it("acknowledges one synced physical Codex profile owned by the current user", async () => {
    const response = await POST(request());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3000/dashboard");
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /SET codex_hook_notice_dismissed_at = now\(\), updated_at = now\(\)[\s\S]*profile.id = \$1[\s\S]*profile.user_id = \$2[\s\S]*profile.agent_id = 'codex'[\s\S]*profile.profile_source_id IS NULL[\s\S]*last_successful_sync_at IS NOT NULL/,
      ),
      [sourceId, "42"],
    );
  });

  it("keeps repeated or unknown acknowledgements non-disclosing and idempotent", async () => {
    const response = await POST(request());

    expect(response.status).toBe(303);
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["missing source id", ""],
    ["invalid source id", "sourceId=private"],
    ["duplicate source id", `sourceId=${sourceId}&sourceId=${sourceId}`],
    ["unexpected field", `sourceId=${sourceId}&account=private`],
  ])("rejects %s", async (_label, body) => {
    const response = await POST(request(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_request" });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests before session or database work", async () => {
    const response = await POST(request(undefined, "https://attacker.example"));

    expect(response.status).toBe(403);
    expect(mocks.viewer).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("requires a signed-in viewer", async () => {
    mocks.viewer.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
