import { describe, expect, it } from "vitest";
import { usageChartStatus } from "./history-coverage";
import { resolveUsagePeriod } from "./usage-period";

const now = new Date("2026-09-01T12:00:00.000Z");

describe("dashboard history coverage", () => {
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
});
