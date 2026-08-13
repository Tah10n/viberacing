import { describe, expect, it } from "vitest";
import {
  currentWeekLabel,
  currentWeekNumber,
  currentWeekStart,
  formatAgentShare,
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

  it("returns the ISO week number", () => {
    expect(currentWeekNumber(new Date("2026-08-13T12:00:00Z"))).toBe(33);
    expect(currentWeekNumber(new Date("2027-01-01T12:00:00Z"))).toBe(53);
    expect(currentWeekNumber(new Date("2027-01-04T12:00:00Z"))).toBe(1);
  });

  it("formats real agent shares", () => {
    expect(formatAgentShare("720", "1000")).toBe("72%");
    expect(formatAgentShare("1", "3")).toBe("33%");
    expect(formatAgentShare("0", "0")).toBe("0%");
  });
});
