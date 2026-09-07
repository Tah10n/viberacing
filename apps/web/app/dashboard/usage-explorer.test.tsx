import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UsageExplorer, usageChartPointerIndex } from "./usage-explorer";

describe("usage chart pointer mapping", () => {
  it("hits the first, middle, and last visible year point inside the plot area", () => {
    const left = 100;
    const width = 1_000;
    const firstPoint = left + 72;
    const lastPoint = left + 982;
    expect(usageChartPointerIndex(firstPoint, left, width, 366)).toBe(0);
    expect(usageChartPointerIndex((firstPoint + lastPoint) / 2, left, width, 366)).toBe(183);
    expect(usageChartPointerIndex(lastPoint, left, width, 366)).toBe(365);
  });
  it("maps mobile pointers to the resized plot instead of a desktop viewBox", () => {
    expect(usageChartPointerIndex(72, 0, 332, 31, 332)).toBe(0);
    expect(usageChartPointerIndex(193, 0, 332, 31, 332)).toBe(15);
    expect(usageChartPointerIndex(314, 0, 332, 31, 332)).toBe(30);
  });
});

describe("usage chart single-day rendering", () => {
  it("renders a persistent visible point for non-zero usage", () => {
    const markup = renderToStaticMarkup(
      <UsageExplorer
        days={[{ date: "2026-01-01", label: "1 January 2026", tokens: "42" }]}
        periodLabel="Custom"
        rangeLabel="1 January 2026"
        status="complete"
      />,
    );
    expect(markup).toContain('class="usage-series-point"');
    expect(markup).toContain('aria-label="Zoom in on usage chart" disabled=""');
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
