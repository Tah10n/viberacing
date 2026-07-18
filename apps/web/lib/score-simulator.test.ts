import { describe, expect, it } from "vitest";

import {
  maximumSimulatorTokenCount,
  parseSimulatorTokenCount,
  simulateScore,
} from "./score-simulator";
import { calculateDailyScore, calculateWeeklyScore } from "./scoring";

describe("public score simulator", () => {
  it("parses only canonical non-negative safe integers", () => {
    expect(parseSimulatorTokenCount("0")).toBe(0);
    expect(parseSimulatorTokenCount("10000")).toBe(10_000);
    expect(parseSimulatorTokenCount(String(maximumSimulatorTokenCount))).toBe(
      maximumSimulatorTokenCount,
    );

    for (const invalid of [
      "",
      "00",
      "01",
      "-1",
      "+1",
      "1.5",
      "1e4",
      " 1",
      "9007199254740992",
      "10000000000000000",
    ]) {
      expect(parseSimulatorTokenCount(invalid)).toBeUndefined();
    }
  });

  it("projects one bounded daily value across an exact active-day count", () => {
    expect(simulateScore(10_000, 5)).toEqual({
      dailyScore: 173,
      weeklyScore: 865,
    });
    expect(simulateScore(maximumSimulatorTokenCount, 7)).toEqual({
      dailyScore: 1_000,
      weeklyScore: 7_000,
    });
    expect(simulateScore(0, 0)).toEqual({ dailyScore: 0, weeklyScore: 0 });
  });

  it.each([-1, 1.5, 8])("rejects invalid active-day count %s", (activeDays) => {
    expect(() => simulateScore(10_000, activeDays)).toThrow(RangeError);
  });

  it("rejects invalid token counts through the production scoring boundary", () => {
    expect(() => simulateScore(-1, 1)).toThrow(RangeError);
    expect(() => simulateScore(Number.NaN, 1)).toThrow(RangeError);
  });

  it("proves four synthetic distributions through the production formula", () => {
    const distributions = [
      { id: "rest", tokens: [0, 0, 0, 0, 0, 0, 0] },
      { id: "steady", tokens: [10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000] },
      { id: "mixed", tokens: [0, 1_000, 10_000, 50_000, 100_000, 250_000, 500_000] },
      {
        id: "capped",
        tokens: [1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000],
      },
    ];
    expect(
      distributions.map(({ id, tokens }) => ({
        dailyScores: tokens.map(calculateDailyScore),
        id,
        weeklyScore: calculateWeeklyScore(tokens),
      })),
    ).toEqual([
      { dailyScores: [0, 0, 0, 0, 0, 0, 0], id: "rest", weeklyScore: 0 },
      {
        dailyScores: [173, 173, 173, 173, 173, 173, 173],
        id: "steady",
        weeklyScore: 1_211,
      },
      {
        dailyScores: [0, 24, 173, 448, 599, 815, 983],
        id: "mixed",
        weeklyScore: 3_042,
      },
      {
        dailyScores: [1_000, 1_000, 1_000, 1_000, 1_000, 1_000, 1_000],
        id: "capped",
        weeklyScore: 7_000,
      },
    ]);
  });
});
