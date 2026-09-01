import { describe, expect, it } from "vitest";
import {
  addUtcDays,
  currentUtcWeekStart,
  parseUsagePeriod,
  resolveUsagePeriod,
  utcDate,
  utcToday,
  usagePeriodSearch,
} from "./usage-period";

const september = new Date("2026-09-01T12:00:00.000Z");

describe("usage period domain", () => {
  it("resolves the Monday-Sunday UTC week independently of local time", () => {
    expect(currentUtcWeekStart(new Date("2026-09-06T23:59:59.999-11:00"))).toBe("2026-09-07");
    expect(resolveUsagePeriod({ kind: "week" }, september)).toEqual({
      period: { kind: "week" },
      from: "2026-08-31",
      toInclusive: "2026-09-06",
      toExclusive: "2026-09-07",
    });
  });

  it("resolves the first and last day of a calendar UTC month", () => {
    expect(resolveUsagePeriod({ kind: "month" }, september)).toMatchObject({
      from: "2026-09-01",
      toInclusive: "2026-09-30",
      toExclusive: "2026-10-01",
    });
    expect(resolveUsagePeriod({ kind: "month" }, new Date("2024-02-29T23:59:59Z"))).toMatchObject({
      from: "2024-02-01",
      toInclusive: "2024-02-29",
      toExclusive: "2024-03-01",
    });
  });

  it("defines All time as the current UTC year through today", () => {
    expect(resolveUsagePeriod({ kind: "year" }, september)).toEqual({
      period: { kind: "year" },
      from: "2026-01-01",
      toInclusive: "2026-09-01",
      toExclusive: "2026-09-02",
    });
    expect(resolveUsagePeriod({ kind: "year" }, new Date("2027-01-01T00:00:00Z"))).toMatchObject({
      from: "2027-01-01",
      toInclusive: "2027-01-01",
      toExclusive: "2027-01-02",
    });
    expect(resolveUsagePeriod({ kind: "year" }, new Date("2026-12-31T23:59:59Z"))).toMatchObject({
      from: "2026-01-01",
      toInclusive: "2026-12-31",
      toExclusive: "2027-01-01",
    });
  });

  it("accepts inclusive same-day custom ranges in the current UTC year", () => {
    expect(
      parseUsagePeriod({ period: "custom", from: "2026-02-29", to: "2026-03-01" }, september),
    ).toEqual({ kind: "week" });
    const sameDay = parseUsagePeriod(
      { period: "custom", from: "2026-09-01", to: "2026-09-01" },
      september,
    );
    expect(resolveUsagePeriod(sameDay, september)).toMatchObject({
      from: "2026-09-01",
      toInclusive: "2026-09-01",
      toExclusive: "2026-09-02",
    });
  });

  it.each([
    [{ period: "custom", from: "2026-05-02", to: "2026-05-01" }, "inverted"],
    [{ period: "custom", from: "2026-09-01", to: "2026-09-02" }, "future"],
    [{ period: "custom", from: "2025-12-31", to: "2026-01-01" }, "previous year"],
    [{ period: "custom", from: "2026-02-30", to: "2026-03-01" }, "invalid ISO date"],
    [{ period: "custom", from: ["2026-01-01"], to: "2026-01-02" }, "duplicate query"],
  ] as const)("normalizes an invalid custom range to week ($1)", (query, reason) => {
    expect(parseUsagePeriod(query, september), reason).toEqual({ kind: "week" });
  });

  it("handles leap day, date validation, date arithmetic, and canonical query strings", () => {
    expect(utcDate("2024-02-29")?.toISOString()).toBe("2024-02-29T00:00:00.000Z");
    expect(utcDate("2023-02-29")).toBeNull();
    expect(utcToday(new Date("2026-01-01T00:30:00+14:00"))).toBe("2025-12-31");
    expect(addUtcDays("2024-02-28", 2)).toBe("2024-03-01");
    expect(usagePeriodSearch({ kind: "custom", from: "2026-04-01", to: "2026-05-15" })).toBe(
      "period=custom&from=2026-04-01&to=2026-05-15",
    );
  });
});
