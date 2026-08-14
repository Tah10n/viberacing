import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("@/lib/config", () => ({
  expectedSchemaVersion: "001_initial.sql",
  validateRuntimeConfig: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ query }));

import { GET } from "./route";

beforeEach(() => query.mockReset());

describe("readiness migration ledger", () => {
  it.each(["only 001 is applied", "001 and a future 002 are applied"])(
    "is ready when %s and the required tables exist",
    async () => {
      query.mockResolvedValue([{ expected_version: true, required_tables: true }]);
      const response = await GET();
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        status: "ready",
        schemaVersion: "001_initial.sql",
      });
    },
  );

  it("returns 503 when the expected latest migration is absent", async () => {
    query.mockResolvedValue([{ expected_version: false, required_tables: true }]);
    expect((await GET()).status).toBe(503);
  });

  it("returns 503 when a required table is absent", async () => {
    query.mockResolvedValue([{ expected_version: true, required_tables: false }]);
    expect((await GET()).status).toBe(503);
  });
});
