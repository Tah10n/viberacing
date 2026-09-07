import { describe, expect, it } from "vitest";
import { usageSeries } from "./usage-series";

describe("observed daily usage series", () => {
  it("does not draw the rest of the month as measured zeroes", () => {
    const days = usageSeries("2026-09-01", "2026-10-01", "2026-09-07", [
      { usage_date: "2026-09-07", tokens: "999999999999999999999999999999" },
    ]);
    expect(days).toHaveLength(7);
    expect(days.at(-1)).toEqual({
      date: "2026-09-07",
      label: "7 September 2026",
      tokens: "999999999999999999999999999999",
    });
    expect(days[0]?.tokens).toBe("0");
  });

  it("keeps a completed custom range intact and excludes its end boundary", () => {
    expect(
      usageSeries("2026-08-30", "2026-09-02", "2026-09-07", []).map((day) => day.date),
    ).toEqual(["2026-08-30", "2026-08-31", "2026-09-01"]);
  });

  it("cuts a week at December 31 without inventing January usage", () => {
    expect(
      usageSeries("2026-12-28", "2027-01-04", "2026-12-31", []).map((day) => day.date),
    ).toEqual(["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31"]);
  });

  it("includes leap day and returns no observations for a future-only range", () => {
    expect(usageSeries("2028-02-28", "2028-03-02", "2028-02-29", [])).toHaveLength(2);
    expect(usageSeries("2026-09-08", "2026-09-14", "2026-09-07", [])).toEqual([]);
  });
});
