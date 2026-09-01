import { afterEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock("./db", () => ({ query: queryMock }));

import { currentWeekStart, leaderboard, publicProfile } from "./leaderboard";
import { addUtcDays, resolveUsagePeriod } from "./usage-period";

describe("leaderboard query", () => {
  afterEach(() => {
    queryMock.mockReset();
  });

  it("uses bounded server-side pagination", async () => {
    queryMock.mockResolvedValue([]);

    await leaderboard({ limit: 101, offset: 100 });

    expect(queryMock).toHaveBeenCalledOnce();
    expect(queryMock.mock.calls[0]?.[0]).toMatch(/LIMIT \$3 OFFSET \$4/);
    expect(queryMock.mock.calls[0]?.[0]).toMatch(/dense_rank\(\) OVER \(ORDER BY total DESC\)/);
    expect(queryMock.mock.calls[0]?.[0]).toMatch(/ORDER BY r\.rank, lower\(u\.handle\), u\.id/);
    const weekStart = currentWeekStart();
    expect(queryMock.mock.calls[0]?.[1]).toEqual([weekStart, addUtcDays(weekStart, 7), 101, 100]);
  });

  it("rejects requests that could return an unbounded page", async () => {
    await expect(leaderboard({ limit: 102 })).rejects.toThrow(RangeError);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns a known racer with zero usage instead of treating the handle as missing", async () => {
    queryMock.mockResolvedValue([{ handle: "Known", rank: null, total: "0", breakdown: null }]);
    const resolved = resolveUsagePeriod(
      { kind: "custom", from: "2026-08-01", to: "2026-08-02" },
      new Date("2026-09-01T12:00:00Z"),
    );

    await expect(publicProfile("known", resolved)).resolves.toEqual({
      handle: "Known",
      rank: null,
      total: "0",
      breakdown: [],
    });
    expect(queryMock.mock.calls[0]?.[0]).toMatch(/FROM users u LEFT JOIN ranked r/);
    expect(queryMock.mock.calls[0]?.[0]).toMatch(
      /EXISTS \(SELECT 1 FROM daily_agent_usage retained/,
    );
    expect(queryMock.mock.calls[0]?.[0]).toMatch(/installation\.status = 'active'/);
    expect(queryMock.mock.calls[0]?.[1]).toEqual(["2026-08-01", "2026-08-03", "known"]);
  });
});
