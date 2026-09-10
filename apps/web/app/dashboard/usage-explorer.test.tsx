import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UsageExplorer, usageChartPointerIndex } from "./usage-explorer";

describe("usage chart pointer mapping", () => {
  it("hits the first, middle, and last visible year bar inside the plot area", () => {
    const left = 100;
    const width = 1_000;
    const firstPoint = left + 72;
    const lastPoint = left + 982;
    expect(usageChartPointerIndex(firstPoint, left, width, 366)).toBe(0);
    expect(usageChartPointerIndex((firstPoint + lastPoint) / 2, left, width, 366)).toBe(183);
    expect(usageChartPointerIndex(lastPoint, left, width, 366)).toBe(365);
  });
  it("uses equal-width day slots including their edges", () => {
    expect(usageChartPointerIndex(72 + 910 / 7 - 1, 0, 1000, 7)).toBe(0);
    expect(usageChartPointerIndex(72 + 910 / 7 + 1, 0, 1000, 7)).toBe(1);
  });
  it("keeps tooltip dates aligned with partially visible days during a swipe", () => {
    expect(usageChartPointerIndex(72 + 910 * 0.1, 0, 1000, 3, 1000, 0.8)).toBe(1);
    expect(usageChartPointerIndex(982, 0, 1000, 3, 1000, 0.8)).toBe(3);
    expect(usageChartPointerIndex(982, 0, 1000, 3, 1000)).toBe(2);
  });
  it("maps mobile pointers to the resized plot instead of a desktop viewBox", () => {
    expect(usageChartPointerIndex(72, 0, 332, 31, 332)).toBe(0);
    expect(usageChartPointerIndex(193, 0, 332, 31, 332)).toBe(15);
    expect(usageChartPointerIndex(314, 0, 332, 31, 332)).toBe(30);
  });
});

describe("usage chart single-day rendering", () => {
  it("renders a visible bar for non-zero usage", () => {
    const markup = renderToStaticMarkup(
      <UsageExplorer
        days={[{ date: "2026-01-01", label: "1 January 2026", tokens: "42" }]}
        periodLabel="Custom"
        rangeLabel="1 January 2026"
        status="complete"
      />,
    );
    expect(markup).toContain('class="usage-series-bar"');
    expect(markup).not.toContain('aria-label="Zoom in on usage chart"');
  });
  it("does not offer inert chart controls when no data has been reported", () => {
    const markup = renderToStaticMarkup(
      <UsageExplorer
        days={[]}
        periodLabel="This week"
        rangeLabel="7–13 September"
        status="no-data"
      />,
    );
    expect(markup).toContain("No exact usage was reported");
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("<svg");
  });
});

describe("partial calendar bars", () => {
  it.each([
    ["2026-01-01", "2026-08-03", "2026-08-03"],
    ["2026-01-01", "2026-02-17", "2026-02-17"],
    ["2023-01-01", "2026-01-03", "2026-01-03"],
    ["2023-12-31", "2026-09-10", "2023-12-31"],
  ])("keeps nonzero edge usage visible in %s–%s", (from, to, reported) => {
    const start = Date.parse(`${from}T00:00:00Z`);
    const length = (Date.parse(`${to}T00:00:00Z`) - start) / 86_400_000 + 1;
    const days = Array.from({ length }, (_, index) => ({
      date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
      label: "",
      tokens: "0",
    }));
    const markup = renderToStaticMarkup(
      <UsageExplorer
        days={days}
        history={[{ date: reported, tokens: "100" }]}
        historyTo={to}
        periodLabel="Custom"
        rangeLabel={`${from}–${to}`}
        status="complete"
      />,
    );
    const bars = [...markup.matchAll(/<rect\b[^>]*class="usage-series-bar"[^>]*>/g)].map(([tag]) =>
      Object.fromEntries<string>(
        [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(
          ([, name, value]) => [name ?? "", value ?? ""] as const,
        ),
      ),
    );
    const nonzero = bars.filter((bar) => Number(bar.height) > 0);
    expect(nonzero).toHaveLength(1);
    expect(Number(nonzero[0]?.x)).toBeLessThan(982);
    expect(Number(nonzero[0]?.x) + Number(nonzero[0]?.width)).toBeGreaterThan(72);
  });
});
