import { describe, expect, it } from "vitest";
import { rankingSignals } from "./ranking-signals";

describe("review signals from deduplicated UTC day totals", () => {
  it("uses exact integers and attributes offline/history delivery to its usage date", () => {
    const days = [{ date: "2026-01-01", total: "9007199254740993" }];
    expect(rankingSignals(days, 9007199254740992n, 20n)).toEqual([
      { date: "2026-01-01", rule: "daily_total" },
    ]);
    expect(rankingSignals(days, 9007199254740993n, 20n)).toEqual([]);
  });
  it("does not treat packets or missing dates as a daily jump, and clears corrected values", () => {
    expect(
      rankingSignals(
        [
          { date: "2026-01-01", total: "100" },
          { date: "2026-01-03", total: "900" },
        ],
        1000n,
        2n,
      ),
    ).toEqual([]);
    expect(
      rankingSignals(
        [
          { date: "2026-01-01", total: "100" },
          { date: "2026-01-02", total: "900" },
        ],
        1000n,
        2n,
      ),
    ).toEqual([{ date: "2026-01-02", rule: "daily_jump" }]);
    expect(
      rankingSignals(
        [
          { date: "2026-01-01", total: "100" },
          { date: "2026-01-02", total: "90" },
        ],
        1000n,
        2n,
      ),
    ).toEqual([]);
  });
  it("bounds deterministic history signals independent of delivery order", () => {
    const days = Array.from({ length: 60 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
      total: "2000",
    }));
    const first = rankingSignals(days, 1000n, 20n);
    expect(first).toHaveLength(32);
    expect(rankingSignals([...days].reverse(), 1000n, 20n)).toEqual(first);
  });
});
