import "server-only";

import {
  communityScorePageV1Schema,
  type CommunityScorePageV1,
  validateCommunityScorePageV1,
} from "@viberacing/contracts";

const projectionColumns = [
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
const projectionColumnSet = new Set<string>(projectionColumns);
const millisecondsPerDay = 24 * 60 * 60 * 1_000;

export const publicCommunityScorePageSize =
  communityScorePageV1Schema.properties.participants.maxItems;

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

function readProjectionRow(value: unknown): Record<(typeof projectionColumns)[number], unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid_projection");
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("invalid_projection");
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== projectionColumns.length ||
    keys.some((key) => typeof key !== "string" || !projectionColumnSet.has(key))
  ) {
    fail("invalid_projection");
  }

  return {
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
}

function isCanonicalArrayIndex(key: PropertyKey, length: number): boolean {
  return typeof key === "string" && /^(?:0|[1-9][0-9]*)$/.test(key) && Number(key) < length;
}

function readProjectionRows(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    fail("invalid_projection");
  }
  if (value.length > publicCommunityScorePageSize) {
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

function assertProjectionInvariants(page: CommunityScorePageV1): void {
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

function mapProjection(value: unknown): CommunityScorePageV1 {
  const participants = readProjectionRows(value).map((row) => {
    const source = readProjectionRow(row);
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
  });
  const result = validateCommunityScorePageV1({
    schemaVersion: 1,
    trustTier: "community",
    selfReported: true,
    participants,
  });
  if (!result.ok) {
    fail("contract_mismatch");
  }

  assertProjectionInvariants(result.value);
  for (const participant of result.value.participants) {
    Object.freeze(participant);
  }
  Object.freeze(result.value.participants);
  return Object.freeze(result.value);
}

export function mapPublicCommunityScoreRows(value: unknown): CommunityScorePageV1 {
  try {
    return mapProjection(value);
  } catch (error) {
    if (error instanceof PublicCommunityScoreMappingError) {
      throw error;
    }
    fail("invalid_projection");
  }
}
