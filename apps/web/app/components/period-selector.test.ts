import { describe, expect, it } from "vitest";
import { resolveUsagePeriod, type UsagePeriod } from "@/lib/usage-period";
import { periodSelectorDefaults } from "./period-selector";

function defaults(period: UsagePeriod, now: string) {
  const instant = new Date(`${now}T12:00:00.000Z`);
  return periodSelectorDefaults(period, resolveUsagePeriod(period, instant), now);
}

describe("period selector custom defaults", () => {
  it("does not default a Tuesday week to its future Sunday", () => {
    expect(defaults({ kind: "week" }, "2026-09-01")).toEqual({
      from: "2026-08-31",
      to: "2026-09-01",
      yearStart: "2026-01-01",
    });
  });

  it("does not default a mid-month selection to the future month end", () => {
    expect(defaults({ kind: "month" }, "2026-09-15")).toEqual({
      from: "2026-09-01",
      to: "2026-09-15",
      yearStart: "2026-01-01",
    });
  });

  it("keeps the real current year when the December week ends in January", () => {
    expect(defaults({ kind: "week" }, "2026-12-31")).toEqual({
      from: "2026-12-28",
      to: "2026-12-31",
      yearStart: "2026-01-01",
    });
  });
});
