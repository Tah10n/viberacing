import { describe, expect, it } from "vitest";
import { resolveUsagePeriod, type UsagePeriod } from "@/lib/usage-period";
import { PeriodSelector, periodSelectorDefaults } from "./period-selector";

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

describe("native custom period form", () => {
  it.each(["/", "/dashboard", "/u/Racer"] as const)(
    "can expose and submit the form without JavaScript on %s",
    (basePath) => {
      const period = { kind: "week" } as const;
      const markup = renderToStaticMarkup(
        createElement(PeriodSelector, {
          basePath,
          period,
          resolved: resolveUsagePeriod(period, new Date("2026-09-08T12:00:00Z")),
          today: "2026-09-08",
        }),
      );
      expect(markup).toContain('<details class="custom-period">');
      expect(markup).toContain('<summary class="period-option">Custom</summary>');
      expect(markup).toContain(`action="${basePath}"`);
      expect(markup).toContain('method="get"');
      expect(markup).not.toContain('hidden=""');
      expect(markup).toContain('name="period" value="custom"');
      expect(markup).toContain('value="2026-09-07"');
      expect(markup).toContain('value="2026-09-08"');
    },
  );

  it("leaves the selected custom range expanded on a server render", () => {
    const period = { kind: "custom", from: "2026-08-01", to: "2026-08-03" } as const;
    const markup = renderToStaticMarkup(
      createElement(PeriodSelector, {
        basePath: "/",
        period,
        resolved: resolveUsagePeriod(period, new Date("2026-09-08T12:00:00Z")),
        today: "2026-09-08",
      }),
    );
    expect(markup).toContain('<details class="custom-period" open="">');
    expect(markup).toContain('value="2026-08-01"');
    expect(markup).toContain('value="2026-08-03"');
  });
});
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
