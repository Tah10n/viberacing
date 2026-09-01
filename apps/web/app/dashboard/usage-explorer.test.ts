import { describe, expect, it } from "vitest";
import { usageChartPointerIndex } from "./usage-explorer";

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
});
