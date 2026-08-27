import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), viewer: vi.fn() }));

vi.mock("@/lib/db", () => ({ query: mocks.query }));
vi.mock("@/lib/session", () => ({ viewer: mocks.viewer }));
vi.mock("@/lib/request-log", () => ({
  withRequestLogging: (_route: string, handler: unknown) => handler,
}));

import { POST } from "./route";

function request(body = ""): Request {
  return new Request("http://localhost:3000/api/accounts/notices/dismiss", {
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
  mocks.query.mockResolvedValue([]);
});

describe("new account notice dismissal", () => {
  it("acknowledges only the current user's pending notices", async () => {
    const response = await POST(request());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3000/dashboard");
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringMatching(/new_account_notice_pending = false[\s\S]*user_id = \$1/),
      ["42"],
    );
  });

  it("rejects unexpected form fields", async () => {
    const response = await POST(request("account=private"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_request" });
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
