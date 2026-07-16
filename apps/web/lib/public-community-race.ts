import type { CarRecipe } from "./car-recipe";
import type { PublicRaceParticipant } from "./race-types";

const scorePath = "/v1/community/scores";
const maximumResponseCharacters = 32_768;
const minimumSeasonStart = "1999-12-27";
const maximumSeasonStart = "2099-12-28";
const pageKeys = ["participants", "schemaVersion", "selfReported", "trustTier"] as const;
const participantKeys = [
  "activeDays",
  "displayPosition",
  "handle",
  "rankPosition",
  "scoreVersion",
  "seasonEnd",
  "seasonFinalized",
  "seasonStart",
  "sourceCount",
  "weeklyScore",
] as const;
const handlePattern = /^[a-z0-9][a-z0-9_-]{1,22}[a-z0-9]$/;
const scoreVersionPattern = /^[a-z][a-z0-9_]{2,31}$/;

const fallbackCars = [
  { body: "formula", paint: "magenta", trim: "chrome", spoiler: "high" },
  { body: "roadster", paint: "sunburst", trim: "dark", spoiler: "low" },
  { body: "rally", paint: "turbo-blue", trim: "light", spoiler: "high" },
  { body: "roadster", paint: "mint", trim: "dark", spoiler: "none" },
] as const satisfies readonly CarRecipe[];

type ScoreFetch = (input: string, init: RequestInit) => Promise<Response>;

function isPlainObject(value: unknown): value is object {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactDataKeys(value: object, keys: readonly string[]): boolean {
  const ownKeys = Reflect.ownKeys(value);
  return (
    ownKeys.length === keys.length &&
    keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && "value" in descriptor && descriptor.enumerable;
    })
  );
}

function dataValue(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
  );
}

function validSeasonStart(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value < minimumSeasonStart ||
    value > maximumSeasonStart ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.valueOf()) &&
    date.toISOString().slice(0, 10) === value &&
    date.getUTCDay() === 1
  );
}

function seasonEndFor(seasonStart: string): string {
  const end = new Date(`${seasonStart}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return end.toISOString().slice(0, 10);
}

export function currentCommunitySeasonStart(now: Date): string | undefined {
  const timestamp = now.valueOf();
  if (!Number.isFinite(timestamp)) {
    return undefined;
  }
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const seasonStart = monday.toISOString().slice(0, 10);
  return validSeasonStart(seasonStart) ? seasonStart : undefined;
}

export function isPublicCommunityHandle(value: unknown): value is string {
  return typeof value === "string" && handlePattern.test(value);
}

export function mapCommunityScorePageToRace(
  value: unknown,
  expectedSeasonStart: string,
): readonly PublicRaceParticipant[] | undefined {
  try {
    if (
      !validSeasonStart(expectedSeasonStart) ||
      !isPlainObject(value) ||
      !hasExactDataKeys(value, pageKeys) ||
      dataValue(value, "schemaVersion") !== 1 ||
      dataValue(value, "trustTier") !== "community" ||
      dataValue(value, "selfReported") !== true
    ) {
      return undefined;
    }
    const rows = dataValue(value, "participants");
    if (
      !Array.isArray(rows) ||
      Object.getPrototypeOf(rows) !== Array.prototype ||
      rows.length > 32 ||
      Reflect.ownKeys(rows).length !== rows.length + 1
    ) {
      return undefined;
    }
    const expectedSeasonEnd = seasonEndFor(expectedSeasonStart);
    const participants: PublicRaceParticipant[] = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = dataValue(rows, String(index));
      if (!isPlainObject(row) || !hasExactDataKeys(row, participantKeys)) {
        return undefined;
      }
      const activeDays = dataValue(row, "activeDays");
      const displayPosition = dataValue(row, "displayPosition");
      const handle = dataValue(row, "handle");
      const rankPosition = dataValue(row, "rankPosition");
      const scoreVersion = dataValue(row, "scoreVersion");
      const seasonEnd = dataValue(row, "seasonEnd");
      const seasonFinalized = dataValue(row, "seasonFinalized");
      const rowSeasonStart = dataValue(row, "seasonStart");
      const sourceCount = dataValue(row, "sourceCount");
      const weeklyScore = dataValue(row, "weeklyScore");
      if (
        !boundedInteger(activeDays, 0, 7) ||
        displayPosition !== index + 1 ||
        !isPublicCommunityHandle(handle) ||
        !boundedInteger(rankPosition, 1, 32) ||
        typeof scoreVersion !== "string" ||
        !scoreVersionPattern.test(scoreVersion) ||
        seasonEnd !== expectedSeasonEnd ||
        typeof seasonFinalized !== "boolean" ||
        rowSeasonStart !== expectedSeasonStart ||
        !boundedInteger(sourceCount, 0, 32) ||
        !boundedInteger(weeklyScore, 0, 7000)
      ) {
        return undefined;
      }
      const car = fallbackCars[index % fallbackCars.length] ?? fallbackCars[0];
      participants.push(
        Object.freeze({
          activeDays,
          car,
          freshnessDays: null,
          handle,
          id: `community-${String(displayPosition)}`,
          rank: rankPosition,
          sourceCount,
          streakDays: null,
          weeklyScore,
        }),
      );
    }
    return Object.freeze(participants);
  } catch {
    return undefined;
  }
}

export async function loadPublicCommunityRace(
  seasonStart: string,
  signal: AbortSignal,
  fetchScore: ScoreFetch = fetch,
): Promise<readonly PublicRaceParticipant[] | undefined> {
  if (!validSeasonStart(seasonStart)) {
    return undefined;
  }
  try {
    const response = await fetchScore(`${scorePath}?seasonStart=${seasonStart}`, {
      cache: "no-store",
      credentials: "omit",
      headers: { accept: "application/json" },
      method: "GET",
      redirect: "error",
      signal,
    });
    if (
      !response.ok ||
      response.headers.get("content-type")?.toLowerCase() !== "application/json; charset=utf-8"
    ) {
      return undefined;
    }
    const body = await response.text();
    if (body.length > maximumResponseCharacters) {
      return undefined;
    }
    return mapCommunityScorePageToRace(JSON.parse(body) as unknown, seasonStart);
  } catch {
    return undefined;
  }
}
