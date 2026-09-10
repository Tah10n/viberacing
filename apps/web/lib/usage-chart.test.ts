import { describe, expect, it } from "vitest";
import { aggregateUsageChartDays, usageChartBuckets, usageChartUnit } from "./usage-chart";

describe("calendar chart aggregation", () => {
  it("chooses days, weeks, months and years as the time span grows", () => {
    expect([7, 45, 46, 210, 211, 900, 901].map(usageChartUnit)).toEqual([
      "day",
      "day",
      "week",
      "week",
      "month",
      "month",
      "year",
    ]);
  });
  it("uses Monday UTC weeks across years and sums integers without losing precision", () => {
    const buckets = aggregateUsageChartDays(
      [
        { date: "2025-12-31", tokens: "9007199254740993" },
        { date: "2026-01-01", tokens: "8" },
        { date: "2026-01-05", tokens: "3" },
        { date: "2026-01-06", tokens: "100" },
      ],
      "2025-12-31",
      "2026-01-05",
      "week",
    );
    expect(buckets).toEqual([
      {
        key: "2025-12-29",
        date: "2025-12-31",
        to: "2026-01-04",
        tokens: "9007199254741001",
        partial: true,
      },
      { key: "2026-01-05", date: "2026-01-05", to: "2026-01-05", tokens: "3", partial: true },
    ]);
  });
  it("uses actual month lengths, leap days and clipped edge buckets", () => {
    expect(usageChartBuckets("2024-02-01", "2024-03-10", "month")).toEqual([
      { key: "2024-02-01", date: "2024-02-01", to: "2024-02-29", tokens: "0", partial: false },
      { key: "2024-03-01", date: "2024-03-01", to: "2024-03-10", tokens: "0", partial: true },
    ]);
    expect(
      usageChartBuckets("2024-01-01", "2025-12-31", "year").map((bucket) => bucket.partial),
    ).toEqual([false, false]);
  });
  it("rejects invalid and unbounded calendar ranges", () => {
    expect(() => usageChartBuckets("2026-02-30", "2026-03-01", "day")).toThrow();
    expect(() => usageChartBuckets("2024-01-01", "2026-01-01", "day")).toThrow();
  });
});
