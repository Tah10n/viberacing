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
    expect(expectedSchemaVersion).toBe("010_current_year_history.sql");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("browser_sync_protocol"), [
      expectedSchemaVersion,
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("dismissed_at"), [
      expectedSchemaVersion,
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("codex_hook_notice_dismissed_at"), [
      expectedSchemaVersion,
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("history_backfill_status"), [
      expectedSchemaVersion,
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("last_rolling_range_start"), [
      expectedSchemaVersion,
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("unresolved_usage_dates"), [
      expectedSchemaVersion,
    ]);
    const readinessQuery = query.mock.calls[0]?.[0] as string;
    expect(readinessQuery).not.toContain("weekly_agent_usage");
    expect(readinessQuery).not.toContain("installation_sources_legacy_partial_coverage");
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
