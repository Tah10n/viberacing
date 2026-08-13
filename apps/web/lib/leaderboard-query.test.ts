import { afterEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock("./db", () => ({ query: queryMock }));

import { currentWeekStart, leaderboard } from "./leaderboard";

describe("leaderboard query", () => {
  afterEach(() => {
    queryMock.mockReset();
  });

  it("uses bounded server-side pagination", async () => {
    queryMock.mockResolvedValue([]);

    await leaderboard({ limit: 101, offset: 100 });

    expect(queryMock).toHaveBeenCalledOnce();
    expect(queryMock.mock.calls[0]?.[0]).toMatch(/LIMIT \$2 OFFSET \$3/);
    expect(queryMock.mock.calls[0]?.[1]).toEqual([currentWeekStart(), 101, 100]);
  });

  it("rejects requests that could return an unbounded page", async () => {
    await expect(leaderboard({ limit: 102 })).rejects.toThrow(RangeError);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
