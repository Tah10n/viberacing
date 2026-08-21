import { describe, expect, it } from "vitest";
import {
  isConfidentAccountMatch,
  minimumAccountDedupMatchedDays,
  selectAccountDedupCandidate,
} from "./account-dedup";

const created = new Date("2026-08-01T00:00:00Z");

describe("account-wide usage matching", () => {
  it("requires two exact completed nonzero days and no mismatch", () => {
    expect(
      isConfidentAccountMatch({ matched_days: minimumAccountDedupMatchedDays, mismatched_days: 0 }),
    ).toBe(true);
    expect(isConfidentAccountMatch({ matched_days: 1, mismatched_days: 0 })).toBe(false);
    expect(isConfidentAccountMatch({ matched_days: 8, mismatched_days: 1 })).toBe(false);
  });

  it("prefers more evidence, then the oldest account, then its id", () => {
    const selected = selectAccountDedupCandidate([
      {
        account_id: "b",
        source_id: "sb",
        created_at: created,
        matched_days: 3,
        mismatched_days: 0,
      },
      {
        account_id: "c",
        source_id: "sc",
        created_at: new Date("2026-07-01T00:00:00Z"),
        matched_days: 4,
        mismatched_days: 0,
      },
      {
        account_id: "a",
        source_id: "sa",
        created_at: new Date("2026-07-01T00:00:00Z"),
        matched_days: 4,
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
          mismatched_days: 0,
        },
        {
          account_id: "b",
          source_id: "sb",
          created_at: created,
          matched_days: 5,
          mismatched_days: 1,
        },
      ]),
    ).toBeNull();
  });
});
