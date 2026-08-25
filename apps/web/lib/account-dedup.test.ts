import { describe, expect, it } from "vitest";
import {
  isConfidentAccountMatch,
  minimumAccountDedupDistinctPositiveTotals,
  minimumAccountDedupMatchedDays,
  minimumAccountDedupMatchedSpanDays,
  selectAccountDedupCandidate,
} from "./account-dedup";

const created = new Date("2026-08-01T00:00:00Z");

describe("account-wide usage matching", () => {
  it("requires seven exact days, three distinct positive totals, a week span, and no mismatch", () => {
    expect(
      isConfidentAccountMatch({
        matched_days: minimumAccountDedupMatchedDays,
        distinct_matched_totals: minimumAccountDedupDistinctPositiveTotals,
        matched_span_days: minimumAccountDedupMatchedSpanDays,
        mismatched_days: 0,
      }),
    ).toBe(true);
    expect(
      isConfidentAccountMatch({
        matched_days: 6,
        distinct_matched_totals: 3,
        matched_span_days: 6,
        mismatched_days: 0,
      }),
    ).toBe(false);
    expect(
      isConfidentAccountMatch({
        matched_days: 7,
        distinct_matched_totals: 2,
        matched_span_days: 6,
        mismatched_days: 0,
      }),
    ).toBe(false);
    expect(
      isConfidentAccountMatch({
        matched_days: 7,
        distinct_matched_totals: 3,
        matched_span_days: 5,
        mismatched_days: 0,
      }),
    ).toBe(false);
    expect(
      isConfidentAccountMatch({
        matched_days: 7,
        distinct_matched_totals: 3,
        matched_span_days: 6,
        mismatched_days: 1,
      }),
    ).toBe(false);
  });

  it("prefers more evidence, then the oldest account, then its id", () => {
    const selected = selectAccountDedupCandidate([
      {
        account_id: "b",
        source_id: "sb",
        created_at: created,
        matched_days: 7,
        distinct_matched_totals: 3,
        matched_span_days: 6,
        mismatched_days: 0,
      },
      {
        account_id: "c",
        source_id: "sc",
        created_at: new Date("2026-07-01T00:00:00Z"),
        matched_days: 8,
        distinct_matched_totals: 3,
        matched_span_days: 7,
        mismatched_days: 0,
      },
      {
        account_id: "a",
        source_id: "sa",
        created_at: new Date("2026-07-01T00:00:00Z"),
        matched_days: 8,
        distinct_matched_totals: 3,
        matched_span_days: 7,
        mismatched_days: 0,
      },
    ]);
    expect(selected?.account_id).toBe("a");
  });

  it("returns no candidate when every overlap is weak or contradictory", () => {
    expect(
      selectAccountDedupCandidate([
        {
          account_id: "a",
          source_id: "sa",
          created_at: created,
          matched_days: 1,
          distinct_matched_totals: 1,
          matched_span_days: 0,
          mismatched_days: 0,
        },
        {
          account_id: "b",
          source_id: "sb",
          created_at: created,
          matched_days: 7,
          distinct_matched_totals: 3,
          matched_span_days: 6,
          mismatched_days: 1,
        },
      ]),
    ).toBeNull();
  });
});
