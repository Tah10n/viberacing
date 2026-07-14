import { describe, expect, it } from "vitest";

import {
  calculateDailyScore,
  calculateWeeklyScore,
  maximumDailyScore,
  maximumWeeklyScore,
  rankWeeklyScores,
  scoreProgress,
} from "./scoring";

describe("scoring", () => {
  it("implements the capped logarithmic daily formula", () => {
    expect(calculateDailyScore(0)).toBe(0);
    expect(calculateDailyScore(10_000)).toBe(173);
    expect(calculateDailyScore(100_000)).toBe(599);
    expect(calculateDailyScore(Number.MAX_SAFE_INTEGER)).toBe(maximumDailyScore);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid token input %s",
    (tokens) => {
      expect(() => calculateDailyScore(tokens)).toThrow(RangeError);
    },
  );

  it("requires seven days and applies the weekly cap", () => {
    expect(() => calculateWeeklyScore([1, 2, 3])).toThrow(RangeError);
    expect(calculateWeeklyScore(Array.from({ length: 7 }, () => Number.MAX_SAFE_INTEGER))).toBe(
      maximumWeeklyScore,
    );
  });

  it("uses active days as the only score tie-break and keeps shared ranks", () => {
    const ranked = rankWeeklyScores([
      {
        id: "one-active-day",
        dailyTokens: [10_000, 0, 0, 0, 0, 0, 0],
        sourceCount: 1,
        freshnessDays: 0,
      },
      {
        id: "two-active-days",
        dailyTokens: [10_000, 1, 0, 0, 0, 0, 0],
        sourceCount: 1,
        freshnessDays: 0,
      },
      {
        id: "same-rounded-score-a",
        dailyTokens: [20_000, 0, 0, 0, 0, 0, 0],
        sourceCount: 1,
        freshnessDays: 0,
      },
      {
        id: "same-rounded-score-b",
        dailyTokens: [20_001, 0, 0, 0, 0, 0, 0],
        sourceCount: 2,
        freshnessDays: 1,
      },
    ]);

    const oneDay = ranked.find((entry) => entry.id === "one-active-day");
    const twoDays = ranked.find((entry) => entry.id === "two-active-days");
    const roundedA = ranked.find((entry) => entry.id === "same-rounded-score-a");
    const roundedB = ranked.find((entry) => entry.id === "same-rounded-score-b");
    expect(twoDays?.weeklyScore).toBe(oneDay?.weeklyScore);
    expect(twoDays?.rank).toBeLessThan(oneDay?.rank ?? 0);
    expect(roundedA?.weeklyScore).toBe(roundedB?.weeklyScore);
    expect(roundedA?.rank).toBe(roundedB?.rank);
  });

  it("bounds visual progress", () => {
    expect(scoreProgress(50, 100)).toBe(0.5);
    expect(scoreProgress(200, 100)).toBe(1);
    expect(scoreProgress(-1, 100)).toBe(0);
    expect(scoreProgress(10, 0)).toBe(0);
  });
});
