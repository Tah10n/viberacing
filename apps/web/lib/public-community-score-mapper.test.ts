import { validateCommunityScorePageV1 } from "@viberacing/contracts";
import { describe, expect, it } from "vitest";

import {
  mapPublicCommunityScoreRows,
  PublicCommunityScoreMappingError,
  publicCommunityScorePageSize,
  type PublicCommunityScoreMappingErrorCode,
} from "./public-community-score-mapper";

interface ProjectionRow {
  readonly active_days: number;
  readonly display_position: number;
  readonly handle: string;
  readonly rank_position: number;
  readonly score_version: string;
  readonly season_end: string;
  readonly season_finalized: boolean;
  readonly season_start: string;
  readonly source_count: number;
  readonly weekly_score: number;
}

const baseRow: ProjectionRow = {
  season_start: "2026-07-13",
  season_end: "2026-07-19",
  score_version: "community_v1",
  season_finalized: false,
  handle: "alpha-driver",
  weekly_score: 500,
  active_days: 5,
  source_count: 2,
  rank_position: 1,
  display_position: 1,
};

function row(overrides: Partial<ProjectionRow> = {}): ProjectionRow {
  return { ...baseRow, ...overrides };
}

function secondRow(overrides: Partial<ProjectionRow> = {}): ProjectionRow {
  return row({
    handle: "beta-driver",
    weekly_score: 400,
    active_days: 4,
    rank_position: 2,
    display_position: 2,
    ...overrides,
  });
}

function expectMappingError(value: unknown, code: PublicCommunityScoreMappingErrorCode): void {
  try {
    mapPublicCommunityScoreRows(value);
  } catch (error) {
    expect(error).toBeInstanceOf(PublicCommunityScoreMappingError);
    expect(error).toMatchObject({
      code,
      message: "Community score projection could not be mapped.",
      name: "PublicCommunityScoreMappingError",
    });
    return;
  }
  throw new Error("expected Community score mapping to fail");
}

describe("public Community score mapper", () => {
  it("maps the exact database projection into the canonical frozen response", () => {
    const input = [row(), secondRow()];
    const page = mapPublicCommunityScoreRows(input);

    expect(page).toEqual({
      schemaVersion: 1,
      trustTier: "community",
      selfReported: true,
      participants: [
        {
          seasonStart: "2026-07-13",
          seasonEnd: "2026-07-19",
          scoreVersion: "community_v1",
          seasonFinalized: false,
          handle: "alpha-driver",
          weeklyScore: 500,
          activeDays: 5,
          sourceCount: 2,
          rankPosition: 1,
          displayPosition: 1,
        },
        {
          seasonStart: "2026-07-13",
          seasonEnd: "2026-07-19",
          scoreVersion: "community_v1",
          seasonFinalized: false,
          handle: "beta-driver",
          weeklyScore: 400,
          activeDays: 4,
          sourceCount: 2,
          rankPosition: 2,
          displayPosition: 2,
        },
      ],
    });
    expect(validateCommunityScorePageV1(page)).toEqual({ ok: true, value: page });
    expect(Object.isFrozen(page)).toBe(true);
    expect(Object.isFrozen(page.participants)).toBe(true);
    expect(page.participants.every(Object.isFrozen)).toBe(true);
    expect(input).toEqual([row(), secondRow()]);
  });

  it("maps an empty projection without inventing season or participant state", () => {
    expect(mapPublicCommunityScoreRows([])).toEqual({
      schemaVersion: 1,
      trustTier: "community",
      selfReported: true,
      participants: [],
    });
  });

  it("accepts the complete top-32 page and both database calendar boundaries", () => {
    const topPage = Array.from({ length: publicCommunityScorePageSize }, (_, index) =>
      row({
        handle: `driver-${String(index + 1).padStart(2, "0")}`,
        rank_position: 1,
        display_position: index + 1,
      }),
    );
    expect(mapPublicCommunityScoreRows(topPage).participants).toHaveLength(32);

    expect(
      mapPublicCommunityScoreRows([row({ season_start: "1999-12-27", season_end: "2000-01-02" })])
        .participants[0],
    ).toMatchObject({ seasonStart: "1999-12-27", seasonEnd: "2000-01-02" });
    expect(
      mapPublicCommunityScoreRows([row({ season_start: "2099-12-28", season_end: "2100-01-03" })])
        .participants[0],
    ).toMatchObject({ seasonStart: "2099-12-28", seasonEnd: "2100-01-03" });
  });

  it("enforces the page limit before reading any row", () => {
    let reads = 0;
    const oversized = Array.from({ length: publicCommunityScorePageSize + 1 }, () => row());
    Object.defineProperty(oversized, "0", {
      configurable: true,
      enumerable: true,
      get() {
        reads += 1;
        return row();
      },
    });

    expectMappingError(oversized, "page_limit_exceeded");
    expect(reads).toBe(0);
  });

  it("rejects malformed array and row structures without invoking row accessors", () => {
    class ProjectionRows extends Array<unknown> {}

    const sparse: unknown[] = [];
    sparse.length = 1;
    const accessorRow = { ...row() };
    let reads = 0;
    Object.defineProperty(accessorRow, "handle", {
      configurable: true,
      enumerable: true,
      get() {
        reads += 1;
        return "private-value";
      },
    });
    const inheritedRow = Object.assign(Object.create({ inherited: true }) as object, row());
    const extraArrayField = [row()];
    Object.defineProperty(extraArrayField, "private", {
      enumerable: true,
      value: "private-value",
    });
    const inheritedArray = new ProjectionRows(row());

    for (const value of [
      null,
      {},
      sparse,
      [null],
      [[]],
      [accessorRow],
      [inheritedRow],
      inheritedArray,
      extraArrayField,
    ]) {
      expectMappingError(value, "invalid_projection");
    }
    expect(reads).toBe(0);
  });

  it("requires the exact database column allowlist", () => {
    const missingHandle = {
      season_start: baseRow.season_start,
      season_end: baseRow.season_end,
      score_version: baseRow.score_version,
      season_finalized: baseRow.season_finalized,
      weekly_score: baseRow.weekly_score,
      active_days: baseRow.active_days,
      source_count: baseRow.source_count,
      rank_position: baseRow.rank_position,
      display_position: baseRow.display_position,
    };
    const privateField = {
      ...row(),
      github_user_id: "private-value-that-must-not-be-reflected",
    };

    expectMappingError([missingHandle], "invalid_projection");
    expectMappingError([privateField], "invalid_projection");
  });

  it.each([
    { handle: "UPPERCASE" },
    { weekly_score: 7_001 },
    { active_days: 8 },
    { source_count: 33 },
    { season_start: "2026-02-30" },
    { season_start: "2026-07-14", season_end: "2026-07-20" },
    { season_end: "2026-07-20" },
    { score_version: "v" },
    { rank_position: 0 },
  ])("fails closed when a projected scalar violates the public contract: %o", (override) => {
    expectMappingError([{ ...row(), ...override }], "contract_mismatch");
  });

  it.each([
    { rows: [row({ season_end: "2026-07-26" })] },
    {
      rows: [row(), secondRow({ season_start: "2026-07-20", season_end: "2026-07-26" })],
    },
    { rows: [row(), secondRow({ score_version: "community_v2" })] },
    { rows: [row(), secondRow({ season_finalized: true })] },
    { rows: [row(), secondRow({ handle: "alpha-driver" })] },
    { rows: [row(), secondRow({ display_position: 3 })] },
    { rows: [row({ rank_position: 2 })] },
  ])("rejects inconsistent season, participant, or display invariants", ({ rows }) => {
    expectMappingError(rows, "projection_invariant");
  });

  it.each([
    { rows: [row(), secondRow({ weekly_score: 501 })] },
    { rows: [row(), secondRow({ weekly_score: 500, active_days: 6 })] },
    {
      rows: [row(), secondRow({ weekly_score: 500, active_days: 5, rank_position: 2 })],
    },
    { rows: [row(), secondRow({ rank_position: 1 })] },
  ])("rejects score ordering and SQL rank-semantics drift", ({ rows }) => {
    expectMappingError(rows, "projection_invariant");
  });

  it("preserves shared ranks and the gap that follows a tie", () => {
    const page = mapPublicCommunityScoreRows([
      row(),
      secondRow({ weekly_score: 500, active_days: 5, rank_position: 1 }),
      row({
        handle: "gamma-driver",
        weekly_score: 300,
        active_days: 3,
        rank_position: 3,
        display_position: 3,
      }),
    ]);

    expect(page.participants.map(({ rankPosition }) => rankPosition)).toEqual([1, 1, 3]);
  });

  it("converts unexpected runtime failures into one non-reflective stable error", () => {
    const privateValue = "private-value-that-must-not-be-reflected";
    const revocable = Proxy.revocable([row({ handle: privateValue })], {});
    revocable.revoke();

    try {
      mapPublicCommunityScoreRows(revocable.proxy);
    } catch (error) {
      expect(error).toBeInstanceOf(PublicCommunityScoreMappingError);
      expect(error).toMatchObject({ code: "invalid_projection" });
      expect(String(error)).not.toContain(privateValue);
      expect(String(error)).not.toContain("handle");
      return;
    }
    throw new Error("expected revoked projection to fail");
  });
});
