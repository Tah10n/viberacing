import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("@/lib/config", () => ({
  expectedSchemaVersion: "005_browser_sync_protocol.sql",
  validateRuntimeConfig: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ query }));

import { GET } from "./route";

beforeEach(() => query.mockReset());

describe("readiness migration ledger", () => {
  it("is ready when the expected migration and required tables exist", async () => {
    query.mockResolvedValue([{ expected_version: true, required_tables: true }]);
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      schemaVersion: "005_browser_sync_protocol.sql",
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("browser_sync_protocol"), [
      "005_browser_sync_protocol.sql",
    ]);
  });

  it("returns 503 when the expected latest migration is absent", async () => {
    query.mockResolvedValue([{ expected_version: false, required_tables: true }]);
    expect((await GET()).status).toBe(503);
  });

  it("returns 503 when a required table is absent", async () => {
    query.mockResolvedValue([{ expected_version: true, required_tables: false }]);
    expect((await GET()).status).toBe(503);
  });
});
