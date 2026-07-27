import {
  validateCommunityScorePageV1,
  validateCommunityTokenRaceStatusPageV1,
} from "@viberacing/contracts";
import { describe, expect, it } from "vitest";

import {
  mapPublicCommunityRaceRows,
  mapPublicCommunityRaceStatusRows,
  mapPublicCommunityScoreRows,
  mapPublicCommunityTokenRaceStatusRows,
  PublicCommunityScoreMappingError,
  publicCommunityRacePageSize,
  publicCommunityRaceStatusPageSize,
  publicCommunityScorePageSize,
  publicCommunityTokenRaceStatusPageSize,
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

interface RaceProjectionRow extends ProjectionRow {
  readonly car_recipe: unknown;
}

interface RaceStatusProjectionRow extends RaceProjectionRow {
  readonly freshness_days: number;
  readonly streak_days: number | null;
}

interface TokenProjectionRow {
  readonly active_days: number;
  readonly car_recipe: unknown;
  readonly display_position: number;
  readonly freshness_days: number;
  readonly handle: string;
  readonly metric_version: string;
  readonly rank_position: number;
  readonly season_end: string;
  readonly season_finalized: boolean;
  readonly season_start: string;
  readonly source_count: number;
  readonly streak_days: number | null;
  readonly weekly_token_total: unknown;
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

function raceRow(
  overrides: Partial<ProjectionRow> & { readonly car_recipe?: unknown } = {},
): RaceProjectionRow {
  return { ...row(overrides), car_recipe: overrides.car_recipe ?? null };
}

function raceStatusRow(
  overrides: Partial<ProjectionRow> & {
    readonly car_recipe?: unknown;
    readonly freshness_days?: number;
    readonly streak_days?: number | null;
  } = {},
): RaceStatusProjectionRow {
  return {
    ...raceRow(overrides),
    freshness_days: overrides.freshness_days ?? 2,
    streak_days: overrides.streak_days ?? null,
  };
}

function tokenRow(overrides: Partial<TokenProjectionRow> = {}): TokenProjectionRow {
  return {
    season_start: "2026-07-27",
    season_end: "2026-08-02",
    metric_version: "community_tokens_v1",
    season_finalized: false,
    handle: "token-alpha",
    weekly_token_total: "1500",
    active_days: 2,
    source_count: 2,
    rank_position: 1,
    display_position: 1,
    car_recipe: null,
    freshness_days: 0,
    streak_days: null,
    ...overrides,
  };
}

function expectMappingError(
  value: unknown,
  code: PublicCommunityScoreMappingErrorCode,
  mapper: (input: unknown) => unknown = mapPublicCommunityScoreRows,
): void {
  try {
    mapper(value);
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

  it("maps the separate race projection with an optional frozen canonical CarRecipe", () => {
    const recipe = {
      schemaVersion: 1,
      chassis: "formula",
      nose: "wedge",
      cockpit: "canopy",
      wing: "high",
      wheels: "slick",
      palette: "magenta",
      trail: "spark",
      seed: 101,
    } as const;
    const page = mapPublicCommunityRaceRows([
      raceRow({ car_recipe: recipe }),
      raceRow({
        handle: "beta-driver",
        weekly_score: 400,
        active_days: 4,
        rank_position: 2,
        display_position: 2,
      }),
    ]);

    expect(page.participants).toEqual([
      expect.objectContaining({ handle: "alpha-driver", carRecipe: recipe }),
      expect.objectContaining({ handle: "beta-driver" }),
    ]);
    expect(Object.hasOwn(page.participants[1] ?? {}, "carRecipe")).toBe(false);
    expect(Object.isFrozen(page)).toBe(true);
    expect(Object.isFrozen(page.participants[0]?.carRecipe)).toBe(true);
    expect(publicCommunityRacePageSize).toBe(publicCommunityScorePageSize);
  });

  it("requires the exact race projection column and canonical recipe allowlists", () => {
    const validRecipe = {
      schemaVersion: 1,
      chassis: "roadster",
      nose: "classic",
      cockpit: "open",
      wing: "none",
      wheels: "street",
      palette: "mint",
      trail: "grid",
      seed: 202,
    };
    expectMappingError([row()], "invalid_projection", mapPublicCommunityRaceRows);
    expectMappingError(
      [{ ...raceRow({ car_recipe: validRecipe }), private_profile_id: "private" }],
      "invalid_projection",
      mapPublicCommunityRaceRows,
    );
    for (const car_recipe of [
      { ...validRecipe, assetUrl: "https://invalid.example/car.svg" },
      { ...validRecipe, palette: "#ffffff" },
      { ...validRecipe, seed: 65_536 },
      undefined,
    ]) {
      expectMappingError(
        [{ ...raceRow({ car_recipe: validRecipe }), car_recipe }],
        car_recipe === undefined ? "invalid_projection" : "contract_mismatch",
        mapPublicCommunityRaceRows,
      );
    }
  });

  it("maps the separate race-status projection and omits a hidden streak", () => {
    const recipe = {
      schemaVersion: 1,
      chassis: "formula",
      nose: "wedge",
      cockpit: "canopy",
      wing: "high",
      wheels: "slick",
      palette: "magenta",
      trail: "spark",
      seed: 303,
    } as const;
    const page = mapPublicCommunityRaceStatusRows([
      raceStatusRow({ car_recipe: recipe, freshness_days: 1, streak_days: 13 }),
      raceStatusRow({
        handle: "beta-driver",
        weekly_score: 400,
        active_days: 4,
        rank_position: 2,
        display_position: 2,
        freshness_days: 0,
      }),
    ]);

    expect(page.participants).toEqual([
      expect.objectContaining({
        handle: "alpha-driver",
        carRecipe: recipe,
        freshnessDays: 1,
        streakDays: 13,
      }),
      expect.objectContaining({ handle: "beta-driver", freshnessDays: 0 }),
    ]);
    expect(Object.hasOwn(page.participants[1] ?? {}, "carRecipe")).toBe(false);
    expect(Object.hasOwn(page.participants[1] ?? {}, "streakDays")).toBe(false);
    expect(Object.isFrozen(page)).toBe(true);
    expect(Object.isFrozen(page.participants[0]?.carRecipe)).toBe(true);
    expect(publicCommunityRaceStatusPageSize).toBe(publicCommunityRacePageSize);
    expect(
      mapPublicCommunityRaceStatusRows([
        raceStatusRow({ freshness_days: 65_535, streak_days: 36_533 }),
      ]).participants[0],
    ).toMatchObject({ freshnessDays: 65_535, streakDays: 36_533 });
  });

  it("requires exact status columns, bounds, and legacy response separation", () => {
    const valid = raceStatusRow({ freshness_days: 3, streak_days: 9 });
    const { freshness_days: _freshnessDays, ...missingFreshness } = valid;
    void _freshnessDays;

    expectMappingError([missingFreshness], "invalid_projection", mapPublicCommunityRaceStatusRows);
    expectMappingError(
      [{ ...valid, received_at: "2026-07-18T12:34:56.789Z" }],
      "invalid_projection",
      mapPublicCommunityRaceStatusRows,
    );
    for (const override of [
      { freshness_days: -1 },
      { freshness_days: 65_536 },
      { streak_days: -1 },
      { streak_days: 36_534 },
    ]) {
      expectMappingError(
        [{ ...valid, ...override }],
        "contract_mismatch",
        mapPublicCommunityRaceStatusRows,
      );
    }
    expectMappingError([valid], "invalid_projection", mapPublicCommunityRaceRows);
    expectMappingError([valid], "invalid_projection", mapPublicCommunityScoreRows);
  });
});

describe("public Community token leaderboard mapper", () => {
  const mapper = mapPublicCommunityTokenRaceStatusRows;

  it("maps exact bigint text, optional presentation state, and an empty top-32 page", () => {
    const recipe = {
      schemaVersion: 1,
      chassis: "formula",
      nose: "wedge",
      cockpit: "canopy",
      wing: "high",
      wheels: "slick",
      palette: "mint",
      trail: "spark",
      seed: 42,
    };
    const page = mapper([
      tokenRow({
        car_recipe: recipe,
        streak_days: 2,
        weekly_token_total: String(Number.MAX_SAFE_INTEGER),
      }),
      tokenRow({
        active_days: 1,
        display_position: 2,
        handle: "token-beta",
        rank_position: 2,
        source_count: 1,
        weekly_token_total: "0",
      }),
    ]);

    expect(page).toEqual({
      schemaVersion: 1,
      trustTier: "community",
      selfReported: true,
      participants: [
        {
          seasonStart: "2026-07-27",
          seasonEnd: "2026-08-02",
          metricVersion: "community_tokens_v1",
          seasonFinalized: false,
          handle: "token-alpha",
          weeklyTokenTotal: Number.MAX_SAFE_INTEGER,
          activeDays: 2,
          sourceCount: 2,
          rankPosition: 1,
          displayPosition: 1,
          carRecipe: recipe,
          freshnessDays: 0,
          streakDays: 2,
        },
        {
          seasonStart: "2026-07-27",
          seasonEnd: "2026-08-02",
          metricVersion: "community_tokens_v1",
          seasonFinalized: false,
          handle: "token-beta",
          weeklyTokenTotal: 0,
          activeDays: 1,
          sourceCount: 1,
          rankPosition: 2,
          displayPosition: 2,
          freshnessDays: 0,
        },
      ],
    });
    expect(validateCommunityTokenRaceStatusPageV1(page)).toEqual({ ok: true, value: page });
    expect(Object.isFrozen(page)).toBe(true);
    expect(Object.isFrozen(page.participants)).toBe(true);
    expect(page.participants.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(page.participants[0]?.carRecipe)).toBe(true);
    expect(mapper([]).participants).toEqual([]);

    const topPage = Array.from({ length: publicCommunityTokenRaceStatusPageSize }, (_, index) =>
      tokenRow({
        display_position: index + 1,
        handle: `token-${String(index + 1).padStart(2, "0")}`,
        rank_position: 1,
      }),
    );
    expect(mapper(topPage).participants).toHaveLength(32);
  });

  it("rejects malformed rows, noncanonical bigint text, and unsafe totals non-reflectively", () => {
    const missingColumn = { ...tokenRow() } as Record<string, unknown>;
    delete missingColumn.handle;
    const extraColumn = { ...tokenRow(), private_value: "hidden" };
    const inherited = Object.assign(Object.create({ private_value: true }) as object, tokenRow());
    const accessor = { ...tokenRow() };
    Object.defineProperty(accessor, "handle", {
      enumerable: true,
      get() {
        return "private-value";
      },
    });

    for (const value of [
      [null],
      [[]],
      [inherited],
      [missingColumn],
      [extraColumn],
      [accessor],
      [tokenRow({ weekly_token_total: 1 })],
      [tokenRow({ weekly_token_total: "-1" })],
      [tokenRow({ weekly_token_total: "01" })],
      [tokenRow({ weekly_token_total: "9007199254740992" })],
      [tokenRow({ car_recipe: undefined })],
      [tokenRow({ freshness_days: undefined as unknown as number })],
      [tokenRow({ streak_days: undefined as unknown as null })],
    ]) {
      expectMappingError(value, "invalid_projection", mapper);
    }

    const trapped = new Proxy(tokenRow(), {
      getPrototypeOf() {
        throw new Error("private-value");
      },
    });
    expectMappingError([trapped], "invalid_projection", mapper);
  });

  it("rejects contract drift before any token page can cross the public boundary", () => {
    for (const value of [
      [tokenRow({ metric_version: "community_v1" })],
      [tokenRow({ freshness_days: 65_536 })],
      [tokenRow({ active_days: 8 })],
      [tokenRow({ car_recipe: { assetUrl: "https://invalid.example/car.svg" } })],
    ]) {
      expectMappingError(value, "contract_mismatch", mapper);
    }
  });

  it("enforces exact-total ordering, tie gaps, visibility ordering, and one season window", () => {
    const tiedPage = mapper([
      tokenRow({ weekly_token_total: "1500" }),
      tokenRow({
        active_days: 1,
        display_position: 2,
        handle: "token-beta",
        rank_position: 1,
        source_count: 1,
        weekly_token_total: "1500",
      }),
      tokenRow({
        display_position: 3,
        handle: "token-gamma",
        rank_position: 3,
        weekly_token_total: "100",
      }),
    ]);
    expect(tiedPage.participants.map(({ rankPosition }) => rankPosition)).toEqual([1, 1, 3]);

    const second = tokenRow({
      display_position: 2,
      handle: "token-beta",
      rank_position: 2,
      weekly_token_total: "100",
    });
    for (const rows of [
      [tokenRow({ season_end: "2026-08-09" })],
      [tokenRow(), { ...second, season_start: "2026-08-03", season_end: "2026-08-09" }],
      [tokenRow(), { ...second, season_finalized: true }],
      [tokenRow(), { ...second, display_position: 3 }],
      [tokenRow(), { ...second, rank_position: 3 }],
      [tokenRow(), { ...second, handle: "token-alpha" }],
      [tokenRow({ weekly_token_total: "100" }), { ...second, weekly_token_total: "200" }],
      [tokenRow(), { ...second, weekly_token_total: "1500", rank_position: 2 }],
      [tokenRow(), { ...second, rank_position: 1 }],
    ]) {
      expectMappingError(rows, "projection_invariant", mapper);
    }
  });
});
