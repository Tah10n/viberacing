import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  viewer: vi.fn(),
  localInstallationId: vi.fn(),
  consumeRateLimit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ query: mocks.query }));
vi.mock("@/lib/session", () => ({
  viewer: mocks.viewer,
  localInstallationId: mocks.localInstallationId,
}));
vi.mock("@/lib/rate-limit", () => ({ consumeRateLimit: mocks.consumeRateLimit }));

import { POST } from "./route";

function request(): Request {
  return new Request("http://localhost/api/accounts/sync/grant", {
    method: "POST",
    headers: { Origin: "http://localhost", "Content-Type": "application/x-www-form-urlencoded" },
    body: "",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.VIBERACING_PUBLIC_ORIGIN = "http://localhost";
  mocks.viewer.mockResolvedValue({ id: "42", handle: "racer" });
  mocks.localInstallationId.mockResolvedValue("11111111-1111-4111-8111-111111111111");
  mocks.consumeRateLimit.mockResolvedValue(true);
});

describe("browser Sync grant", () => {
  it("creates a short-lived grant only for the browser-bound active installation", async () => {
    mocks.query.mockResolvedValue([
      { expires_at: new Date("2026-08-21T12:05:00Z"), rate_limited: false },
    ]);
    const response = await POST(request());
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    if (body === null || typeof body !== "object") throw new Error("expected grant response");
    expect("installationId" in body ? body.installationId : null).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect("token" in body ? body.token : null).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringMatching(/browser_sync_capable[\s\S]*INSERT INTO browser_sync_grants/),
      ["11111111-1111-4111-8111-111111111111", "42", expect.any(Buffer)],
    );
  });

  it("does not expose Sync without a valid local installation binding", async () => {
    mocks.localInstallationId.mockResolvedValue(null);
    const response = await POST(request());
    expect(response.status).toBe(404);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("does not issue another grant during the server-enforced sync cooldown", async () => {
    mocks.query.mockResolvedValue([{ expires_at: null, rate_limited: true }]);

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    await expect(response.json()).resolves.toEqual({ error: "sync_rate_limited" });
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /FOR UPDATE[\s\S]*browser_sync_runs[\s\S]*interval '60 seconds'[\s\S]*IS DISTINCT FROM 'busy'/,
      ),
      ["11111111-1111-4111-8111-111111111111", "42", expect.any(Buffer)],
    );
  });
});
