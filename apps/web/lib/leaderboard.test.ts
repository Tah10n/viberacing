import { describe, expect, it } from "vitest";
import {
  currentWeekLabel,
  currentWeekStart,
  formatCompactTokens,
  formatExactTokens,
} from "./leaderboard";

describe("leaderboard helpers", () => {
  it("starts a UTC week on Monday", () => {
    expect(currentWeekStart(new Date("2026-08-13T23:59:59Z"))).toBe("2026-08-10");
    expect(currentWeekStart(new Date("2026-08-16T01:00:00Z"))).toBe("2026-08-10");
    expect(currentWeekStart(new Date("2026-08-17T00:00:00Z"))).toBe("2026-08-17");
  });

  it("formats integer token counts without losing precision", () => {
    expect(formatExactTokens("12345678901234567890")).toBe("12 345 678 901 234 567 890");
    expect(formatCompactTokens("2638674684")).toBe("2,6B");
    expect(formatCompactTokens("2550000")).toBe("2,6M");
    expect(formatCompactTokens("999999")).toBe("1M");
    expect(formatCompactTokens("999")).toBe("999");
  });

  it("prints a compact UTC week range", () => {
    expect(currentWeekLabel(new Date("2026-08-13T12:00:00Z"))).toBe("10–16 Aug 2026");
    expect(currentWeekLabel(new Date("2026-08-31T12:00:00Z"))).toBe("31 Aug–6 Sept 2026");
  });
});
