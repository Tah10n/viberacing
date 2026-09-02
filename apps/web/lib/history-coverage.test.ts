import { describe, expect, it } from "vitest";
import { sourcePeriodIncomplete, usageChartStatus } from "./history-coverage";
import { resolveUsagePeriod } from "./usage-period";

const now = new Date("2026-09-01T12:00:00.000Z");

describe("dashboard history coverage", () => {
  const completeSource = {
    included: true,
    active: true,
    aggregationMode: "source_sum" as const,
    historyBackfillYear: 2026,
    historyBackfillStatus: "complete" as const,
    lastCompleteness: "complete" as const,
    lastRollingRangeStart: "2026-08-02",
    lastRollingRangeEnd: "2026-09-01",
    unresolvedUsageDates: [] as string[],
    provenAccountDates: new Set<string>(),
  };

  it("keeps a rolling-covered month complete while January history is pending", () => {
    expect(
      usageChartStatus(resolveUsagePeriod({ kind: "month" }, now), "2026-09-01", {
        hasUsage: true,
        hasPartialAccount: false,
        historyIncomplete: true,
      }),
    ).toBe("complete");
  });

  it("does not mask an empty year with pending history as trusted no-data", () => {
    expect(
      usageChartStatus(resolveUsagePeriod({ kind: "year" }, now), "2026-09-01", {
        hasUsage: false,
        hasPartialAccount: false,
        historyIncomplete: true,
      }),
    ).toBe("partial");
  });

  it("only applies pending history to custom ranges before rolling coverage", () => {
    const recent = resolveUsagePeriod(
      { kind: "custom", from: "2026-08-15", to: "2026-08-20" },
      now,
    );
    const old = resolveUsagePeriod({ kind: "custom", from: "2026-07-01", to: "2026-07-10" }, now);
    const options = { hasUsage: true, hasPartialAccount: false, historyIncomplete: true };
    expect(usageChartStatus(recent, "2026-09-01", options)).toBe("complete");
    expect(usageChartStatus(old, "2026-09-01", options)).toBe("partial");
  });

  it("treats an omitted day inside a partial rolling range as partial", () => {
    const selected = resolveUsagePeriod(
      { kind: "custom", from: "2026-08-15", to: "2026-08-15" },
      now,
    );
    expect(
      sourcePeriodIncomplete(selected, "2026-09-01", {
        ...completeSource,
        lastCompleteness: "partial",
        unresolvedUsageDates: ["2026-08-15"],
      }),
    ).toBe(true);
  });

  it("keeps retained disconnected terminal-partial history conservative without a selected row", () => {
    const selected = resolveUsagePeriod(
      { kind: "custom", from: "2026-01-15", to: "2026-01-15" },
      now,
    );
    expect(
      sourcePeriodIncomplete(selected, "2026-09-01", {
        ...completeSource,
        historyBackfillStatus: "partial",
      }),
    ).toBe(true);
  });

  it("keeps an explicit complete zero range complete", () => {
    const selected = resolveUsagePeriod(
      { kind: "custom", from: "2026-08-15", to: "2026-08-15" },
      now,
    );
    expect(
      sourcePeriodIncomplete(selected, "2026-09-01", {
        ...completeSource,
        lastCompleteness: "partial",
        unresolvedUsageDates: ["2026-08-16"],
      }),
    ).toBe(false);
  });

  it("uses per-day mixed rolling coverage instead of the whole partial range", () => {
    const selected = (from: string) => resolveUsagePeriod({ kind: "custom", from, to: from }, now);
    const mixed = {
      ...completeSource,
      lastCompleteness: "partial" as const,
      unresolvedUsageDates: ["2026-08-17", "2026-08-18"],
    };
    expect(sourcePeriodIncomplete(selected("2026-08-15"), "2026-09-01", mixed)).toBe(false);
    expect(sourcePeriodIncomplete(selected("2026-08-16"), "2026-09-01", mixed)).toBe(false);
    expect(sourcePeriodIncomplete(selected("2026-08-17"), "2026-09-01", mixed)).toBe(true);
    expect(sourcePeriodIncomplete(selected("2026-08-18"), "2026-09-01", mixed)).toBe(true);
  });

  it("lets an account-wide authoritative observation prove a partial sibling day", () => {
    const selected = resolveUsagePeriod(
      { kind: "custom", from: "2026-08-17", to: "2026-08-17" },
      now,
    );
    const partial = {
      ...completeSource,
      aggregationMode: "account_max" as const,
      lastCompleteness: "partial" as const,
      unresolvedUsageDates: ["2026-08-17"],
      provenAccountDates: new Set(["2026-08-17"]),
    };
    expect(sourcePeriodIncomplete(selected, "2026-09-01", partial)).toBe(false);
    expect(
      sourcePeriodIncomplete(selected, "2026-09-01", {
        ...partial,
        aggregationMode: "source_sum",
      }),
    ).toBe(true);
  });

  it("treats legacy partial rolling metadata as conservatively incomplete", () => {
    const selected = resolveUsagePeriod(
      { kind: "custom", from: "2026-08-15", to: "2026-08-15" },
      now,
    );
    expect(
      sourcePeriodIncomplete(selected, "2026-09-01", {
        ...completeSource,
        lastCompleteness: "partial",
        lastRollingRangeStart: null,
        lastRollingRangeEnd: null,
        unresolvedUsageDates: [],
      }),
    ).toBe(true);
  });

  it("keeps an unresolved omitted date partial after it leaves the next rolling window", () => {
    const selected = resolveUsagePeriod(
      { kind: "custom", from: "2026-07-16", to: "2026-07-16" },
      now,
    );
    expect(
      sourcePeriodIncomplete(selected, "2026-09-01", {
        ...completeSource,
        lastRollingRangeStart: "2026-08-02",
        unresolvedUsageDates: ["2026-07-16"],
      }),
    ).toBe(true);
  });

  it("treats an active source ending yesterday and a never-synced source as partial today", () => {
    const today = resolveUsagePeriod({ kind: "custom", from: "2026-09-01", to: "2026-09-01" }, now);
    expect(
      sourcePeriodIncomplete(today, "2026-09-01", {
        ...completeSource,
        lastRollingRangeEnd: "2026-08-31",
      }),
    ).toBe(true);
    expect(
      sourcePeriodIncomplete(today, "2026-09-01", {
        ...completeSource,
        lastRollingRangeStart: null,
        lastRollingRangeEnd: null,
      }),
    ).toBe(true);
  });

  it("does not turn future week or month dates into false partial coverage", () => {
    const week = resolveUsagePeriod({ kind: "week" }, now);
    const month = resolveUsagePeriod({ kind: "month" }, now);
    for (const selected of [week, month])
      expect(
        sourcePeriodIncomplete(selected, "2026-09-01", {
          ...completeSource,
          lastRollingRangeEnd: "2026-09-01",
        }),
      ).toBe(false);
  });

  it("keeps source-sum gaps but lets an authoritative account-max sibling close the day", () => {
    const selected = resolveUsagePeriod(
      { kind: "custom", from: "2026-07-16", to: "2026-07-16" },
      now,
    );
    const unresolved = {
      ...completeSource,
      unresolvedUsageDates: ["2026-07-16"],
      provenAccountDates: new Set(["2026-07-16"]),
    };
    expect(
      sourcePeriodIncomplete(selected, "2026-09-01", {
        ...unresolved,
        aggregationMode: "account_max",
      }),
    ).toBe(false);
    expect(
      sourcePeriodIncomplete(selected, "2026-09-01", {
        ...unresolved,
        aggregationMode: "source_sum",
      }),
    ).toBe(true);
  });

  it("retains a known disconnected gap without inferring a new disconnected tail", () => {
    const selected = (date: string) =>
      resolveUsagePeriod({ kind: "custom", from: date, to: date }, now);
    const disconnected = {
      ...completeSource,
      active: false,
      lastRollingRangeEnd: "2026-08-20",
      unresolvedUsageDates: ["2026-08-10"],
    };
    expect(sourcePeriodIncomplete(selected("2026-08-10"), "2026-09-01", disconnected)).toBe(true);
    expect(sourcePeriodIncomplete(selected("2026-08-25"), "2026-09-01", disconnected)).toBe(false);
  });
});
