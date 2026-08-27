import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ConfigModule from "@/lib/config";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("@/lib/config", async (importOriginal) => ({
  ...(await importOriginal<typeof ConfigModule>()),
  validateRuntimeConfig: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ query }));

import { expectedSchemaVersion } from "@/lib/config";
import { GET } from "./route";

beforeEach(() => query.mockReset());

describe("readiness migration ledger", () => {
  it("is ready when the expected migration and required tables exist", async () => {
    query.mockResolvedValue([{ expected_version: true, required_tables: true }]);
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      schemaVersion: expectedSchemaVersion,
    });
    expect(expectedSchemaVersion).toBe("008_account_dedup_notice_dismissal.sql");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("browser_sync_protocol"), [
      expectedSchemaVersion,
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("dismissed_at"), [
      expectedSchemaVersion,
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
