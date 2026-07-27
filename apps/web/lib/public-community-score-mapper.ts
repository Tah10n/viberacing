import "server-only";

import {
  communityRacePageV1Schema,
  communityRaceStatusPageV1Schema,
  communityScorePageV1Schema,
  communityTokenRaceStatusPageV1Schema,
  type CommunityRacePageV1,
  type CommunityRaceStatusPageV1,
  type CommunityScorePageV1,
  type CommunityTokenRaceStatusPageV1,
  validateCommunityRacePageV1,
  validateCommunityRaceStatusPageV1,
  validateCommunityScorePageV1,
  validateCommunityTokenRaceStatusPageV1,
} from "@viberacing/contracts";

const scoreProjectionColumns = [
  "season_start",
  "season_end",
  "score_version",
  "season_finalized",
  "handle",
  "weekly_score",
  "active_days",
  "source_count",
  "rank_position",
  "display_position",
] as const;
const raceProjectionColumns = [...scoreProjectionColumns, "car_recipe"] as const;
const raceStatusProjectionColumns = [
  ...raceProjectionColumns,
  "freshness_days",
  "streak_days",
] as const;
const tokenProjectionColumns = [
  "season_start",
  "season_end",
  "metric_version",
  "season_finalized",
  "handle",
  "weekly_token_total",
  "active_days",
  "source_count",
  "rank_position",
  "display_position",
  "car_recipe",
  "freshness_days",
  "streak_days",
] as const;
const scoreProjectionColumnSet = new Set<string>(scoreProjectionColumns);
const raceProjectionColumnSet = new Set<string>(raceProjectionColumns);
const raceStatusProjectionColumnSet = new Set<string>(raceStatusProjectionColumns);
const tokenProjectionColumnSet = new Set<string>(tokenProjectionColumns);
const millisecondsPerDay = 24 * 60 * 60 * 1_000;

export const publicCommunityScorePageSize =
  communityScorePageV1Schema.properties.participants.maxItems;
export const publicCommunityRacePageSize =
  communityRacePageV1Schema.properties.participants.maxItems;
export const publicCommunityRaceStatusPageSize =
  communityRaceStatusPageV1Schema.properties.participants.maxItems;
export const publicCommunityTokenRaceStatusPageSize =
  communityTokenRaceStatusPageV1Schema.properties.participants.maxItems;

export type PublicCommunityScoreMappingErrorCode =
  "contract_mismatch" | "invalid_projection" | "page_limit_exceeded" | "projection_invariant";

export class PublicCommunityScoreMappingError extends Error {
  readonly code: PublicCommunityScoreMappingErrorCode;

  constructor(code: PublicCommunityScoreMappingErrorCode) {
    super("Community score projection could not be mapped.");
    this.name = "PublicCommunityScoreMappingError";
    this.code = code;
  }
}

function fail(code: PublicCommunityScoreMappingErrorCode): never {
  throw new PublicCommunityScoreMappingError(code);
}

function dataValue(object: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
    fail("invalid_projection");
  }
  return descriptor.value as unknown;
}

interface ProjectionRow {
  readonly active_days: unknown;
  readonly car_recipe?: unknown;
  readonly display_position: unknown;
  readonly freshness_days?: unknown;
  readonly handle: unknown;
  readonly rank_position: unknown;
  readonly score_version: unknown;
  readonly season_end: unknown;
  readonly season_finalized: unknown;
  readonly season_start: unknown;
  readonly source_count: unknown;
  readonly streak_days?: unknown;
  readonly weekly_score: unknown;
}

type ProjectionKind = "race" | "score" | "status";

interface TokenProjectionRow {
  readonly active_days: unknown;
  readonly car_recipe: unknown;
  readonly display_position: unknown;
  readonly freshness_days: unknown;
  readonly handle: unknown;
  readonly metric_version: unknown;
  readonly rank_position: unknown;
  readonly season_end: unknown;
  readonly season_finalized: unknown;
  readonly season_start: unknown;
  readonly source_count: unknown;
  readonly streak_days: unknown;
  readonly weekly_token_total: unknown;
}

function readProjectionRow(value: unknown, kind: ProjectionKind): ProjectionRow {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid_projection");
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("invalid_projection");
  }
  const keys = Reflect.ownKeys(value);
  const columns =
    kind === "status"
      ? raceStatusProjectionColumns
      : kind === "race"
        ? raceProjectionColumns
        : scoreProjectionColumns;
  const columnSet =
    kind === "status"
      ? raceStatusProjectionColumnSet
      : kind === "race"
        ? raceProjectionColumnSet
        : scoreProjectionColumnSet;
  if (
    keys.length !== columns.length ||
    keys.some((key) => typeof key !== "string" || !columnSet.has(key))
  ) {
    fail("invalid_projection");
  }

  const row: ProjectionRow = {
    season_start: dataValue(value, "season_start"),
    season_end: dataValue(value, "season_end"),
    score_version: dataValue(value, "score_version"),
    season_finalized: dataValue(value, "season_finalized"),
    handle: dataValue(value, "handle"),
    weekly_score: dataValue(value, "weekly_score"),
    active_days: dataValue(value, "active_days"),
    source_count: dataValue(value, "source_count"),
    rank_position: dataValue(value, "rank_position"),
    display_position: dataValue(value, "display_position"),
  };
  if (kind === "score") {
    return row;
  }
  const raceRow = { ...row, car_recipe: dataValue(value, "car_recipe") };
  return kind === "status"
    ? {
        ...raceRow,
        freshness_days: dataValue(value, "freshness_days"),
        streak_days: dataValue(value, "streak_days"),
      }
    : raceRow;
}

function readTokenProjectionRow(value: unknown): TokenProjectionRow {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid_projection");
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("invalid_projection");
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== tokenProjectionColumns.length ||
    keys.some((key) => typeof key !== "string" || !tokenProjectionColumnSet.has(key))
  ) {
    fail("invalid_projection");
  }
  return {
    season_start: dataValue(value, "season_start"),
    season_end: dataValue(value, "season_end"),
    metric_version: dataValue(value, "metric_version"),
    season_finalized: dataValue(value, "season_finalized"),
    handle: dataValue(value, "handle"),
    weekly_token_total: dataValue(value, "weekly_token_total"),
    active_days: dataValue(value, "active_days"),
    source_count: dataValue(value, "source_count"),
    rank_position: dataValue(value, "rank_position"),
    display_position: dataValue(value, "display_position"),
    car_recipe: dataValue(value, "car_recipe"),
    freshness_days: dataValue(value, "freshness_days"),
    streak_days: dataValue(value, "streak_days"),
  };
}

function isCanonicalArrayIndex(key: PropertyKey, length: number): boolean {
  return typeof key === "string" && /^(?:0|[1-9][0-9]*)$/.test(key) && Number(key) < length;
}

function readProjectionRows(value: unknown, maximumPageSize: number): readonly unknown[] {
  if (!Array.isArray(value)) {
    fail("invalid_projection");
  }
  if (value.length > maximumPageSize) {
    fail("page_limit_exceeded");
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Array.prototype) {
    fail("invalid_projection");
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== value.length + 1 ||
    keys.some((key) => key !== "length" && !isCanonicalArrayIndex(key, value.length))
  ) {
    fail("invalid_projection");
  }

  const rows: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    rows.push(dataValue(value, String(index)));
  }
  return rows;
}

function hasValidSeasonWindow(seasonStart: string, seasonEnd: string): boolean {
  const startTime = Date.parse(`${seasonStart}T00:00:00.000Z`);
  const endTime = Date.parse(`${seasonEnd}T00:00:00.000Z`);
  return (
    Number.isFinite(startTime) &&
    Number.isFinite(endTime) &&
    new Date(startTime).getUTCDay() === 1 &&
    endTime - startTime === 6 * millisecondsPerDay
  );
}

function assertProjectionInvariants(
  page: CommunityScorePageV1 | CommunityRacePageV1 | CommunityRaceStatusPageV1,
): void {
  const first = page.participants[0];
  if (first === undefined) {
    return;
  }
  if (!hasValidSeasonWindow(first.seasonStart, first.seasonEnd)) {
    fail("projection_invariant");
  }

  const handles = new Set<string>();
  for (const [index, participant] of page.participants.entries()) {
    if (
      participant.seasonStart !== first.seasonStart ||
      participant.seasonEnd !== first.seasonEnd ||
      participant.scoreVersion !== first.scoreVersion ||
      participant.seasonFinalized !== first.seasonFinalized ||
      participant.displayPosition !== index + 1 ||
      participant.rankPosition > participant.displayPosition ||
      handles.has(participant.handle)
    ) {
      fail("projection_invariant");
    }
    handles.add(participant.handle);

    const previous = page.participants[index - 1];
    if (previous === undefined) {
      continue;
    }

    const tied =
      participant.weeklyScore === previous.weeklyScore &&
      participant.activeDays === previous.activeDays;
    if (
      participant.weeklyScore > previous.weeklyScore ||
      (participant.weeklyScore === previous.weeklyScore &&
        participant.activeDays > previous.activeDays) ||
      participant.rankPosition !== (tied ? previous.rankPosition : participant.displayPosition)
    ) {
      fail("projection_invariant");
    }
  }
}

function parseWeeklyTokenTotal(value: unknown): number {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    fail("invalid_projection");
  }
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    fail("invalid_projection");
  }
  return result;
}

function assertTokenProjectionInvariants(page: CommunityTokenRaceStatusPageV1): void {
  const first = page.participants[0];
  if (first === undefined) {
    return;
  }
  if (!hasValidSeasonWindow(first.seasonStart, first.seasonEnd)) {
    fail("projection_invariant");
  }

  const handles = new Set<string>();
  for (const [index, participant] of page.participants.entries()) {
    if (
      participant.seasonStart !== first.seasonStart ||
      participant.seasonEnd !== first.seasonEnd ||
      participant.seasonFinalized !== first.seasonFinalized ||
      participant.displayPosition !== index + 1 ||
      participant.rankPosition > participant.displayPosition ||
      handles.has(participant.handle)
    ) {
      fail("projection_invariant");
    }
    handles.add(participant.handle);

    const previous = page.participants[index - 1];
    if (previous === undefined) {
      continue;
    }
    const tied = participant.weeklyTokenTotal === previous.weeklyTokenTotal;
    if (
      participant.weeklyTokenTotal > previous.weeklyTokenTotal ||
      participant.rankPosition !== (tied ? previous.rankPosition : participant.displayPosition)
    ) {
      fail("projection_invariant");
    }
  }
}

function mapParticipant(source: ProjectionRow) {
  return {
    seasonStart: source.season_start,
    seasonEnd: source.season_end,
    scoreVersion: source.score_version,
    seasonFinalized: source.season_finalized,
    handle: source.handle,
    weeklyScore: source.weekly_score,
    activeDays: source.active_days,
    sourceCount: source.source_count,
    rankPosition: source.rank_position,
    displayPosition: source.display_position,
  };
}

function freezeProjection<
  T extends CommunityRacePageV1 | CommunityRaceStatusPageV1 | CommunityScorePageV1,
>(page: T, freezeRecipes: boolean): T {
  assertProjectionInvariants(page);
  for (const participant of page.participants) {
    if (freezeRecipes) {
      const recipe = Object.getOwnPropertyDescriptor(participant, "carRecipe")?.value as unknown;
      if (recipe !== null && typeof recipe === "object") {
        Object.freeze(recipe);
      }
    }
    Object.freeze(participant);
  }
  Object.freeze(page.participants);
  return Object.freeze(page);
}

function mapScoreProjection(value: unknown): CommunityScorePageV1 {
  const participants = readProjectionRows(value, publicCommunityScorePageSize).map((row) =>
    mapParticipant(readProjectionRow(row, "score")),
  );
  const result = validateCommunityScorePageV1({
    schemaVersion: 1,
    trustTier: "community",
    selfReported: true,
    participants,
  });
  if (!result.ok) {
    fail("contract_mismatch");
  }
  return freezeProjection(result.value, false);
}

function mapRaceProjection(value: unknown): CommunityRacePageV1 {
  const participants = readProjectionRows(value, publicCommunityRacePageSize).map((row) => {
    const source = readProjectionRow(row, "race");
    const participant = mapParticipant(source);
    if (source.car_recipe === null) {
      return participant;
    }
    if (source.car_recipe === undefined) {
      fail("invalid_projection");
    }
    return { ...participant, carRecipe: source.car_recipe };
  });
  const result = validateCommunityRacePageV1({
    schemaVersion: 1,
    trustTier: "community",
    selfReported: true,
    participants,
  });
  if (!result.ok) {
    fail("contract_mismatch");
  }
  return freezeProjection(result.value, true);
}

function mapRaceStatusProjection(value: unknown): CommunityRaceStatusPageV1 {
  const participants = readProjectionRows(value, publicCommunityRaceStatusPageSize).map((row) => {
    const source = readProjectionRow(row, "status");
    if (
      source.car_recipe === undefined ||
      source.freshness_days === undefined ||
      source.streak_days === undefined
    ) {
      fail("invalid_projection");
    }
    return {
      ...mapParticipant(source),
      freshnessDays: source.freshness_days,
      ...(source.car_recipe === null ? {} : { carRecipe: source.car_recipe }),
      ...(source.streak_days === null ? {} : { streakDays: source.streak_days }),
    };
  });
  const result = validateCommunityRaceStatusPageV1({
    schemaVersion: 1,
    trustTier: "community",
    selfReported: true,
    participants,
  });
  if (!result.ok) {
    fail("contract_mismatch");
  }
  return freezeProjection(result.value, true);
}

function mapTokenProjection(value: unknown): CommunityTokenRaceStatusPageV1 {
  const participants = readProjectionRows(value, publicCommunityTokenRaceStatusPageSize).map(
    (row) => {
      const source = readTokenProjectionRow(row);
      if (
        source.car_recipe === undefined ||
        source.freshness_days === undefined ||
        source.streak_days === undefined
      ) {
        fail("invalid_projection");
      }
      return {
        seasonStart: source.season_start,
        seasonEnd: source.season_end,
        metricVersion: source.metric_version,
        seasonFinalized: source.season_finalized,
        handle: source.handle,
        weeklyTokenTotal: parseWeeklyTokenTotal(source.weekly_token_total),
        activeDays: source.active_days,
        sourceCount: source.source_count,
        rankPosition: source.rank_position,
        displayPosition: source.display_position,
        freshnessDays: source.freshness_days,
        ...(source.car_recipe === null ? {} : { carRecipe: source.car_recipe }),
        ...(source.streak_days === null ? {} : { streakDays: source.streak_days }),
      };
    },
  );
  const result = validateCommunityTokenRaceStatusPageV1({
    schemaVersion: 1,
    trustTier: "community",
    selfReported: true,
    participants,
  });
  if (!result.ok) {
    fail("contract_mismatch");
  }
  assertTokenProjectionInvariants(result.value);
  for (const participant of result.value.participants) {
    const recipe = Object.getOwnPropertyDescriptor(participant, "carRecipe")?.value as unknown;
    if (recipe !== null && typeof recipe === "object") {
      Object.freeze(recipe);
    }
    Object.freeze(participant);
  }
  Object.freeze(result.value.participants);
  return Object.freeze(result.value);
}

export function mapPublicCommunityScoreRows(value: unknown): CommunityScorePageV1 {
  try {
    return mapScoreProjection(value);
  } catch (error) {
    if (error instanceof PublicCommunityScoreMappingError) {
      throw error;
    }
    fail("invalid_projection");
  }
}

export function mapPublicCommunityRaceRows(value: unknown): CommunityRacePageV1 {
  try {
    return mapRaceProjection(value);
  } catch (error) {
    if (error instanceof PublicCommunityScoreMappingError) {
      throw error;
    }
    fail("invalid_projection");
  }
}

export function mapPublicCommunityRaceStatusRows(value: unknown): CommunityRaceStatusPageV1 {
  try {
    return mapRaceStatusProjection(value);
  } catch (error) {
    if (error instanceof PublicCommunityScoreMappingError) {
      throw error;
    }
    fail("invalid_projection");
  }
}

export function mapPublicCommunityTokenRaceStatusRows(
  value: unknown,
): CommunityTokenRaceStatusPageV1 {
  try {
    return mapTokenProjection(value);
  } catch (error) {
    if (error instanceof PublicCommunityScoreMappingError) {
      throw error;
    }
    fail("invalid_projection");
  }
}
