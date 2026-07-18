import type { CarRecipe } from "./car-recipe";
import type { PublicRaceParticipant } from "./race-types";

const scorePath = "/v1/community/race/status";
const maximumResponseCharacters = 32_768;
const minimumSeasonStart = "1999-12-27";
const maximumSeasonStart = "2099-12-28";
const pageKeys = ["participants", "schemaVersion", "selfReported", "trustTier"] as const;
const participantKeys = [
  "activeDays",
  "displayPosition",
  "freshnessDays",
  "handle",
  "rankPosition",
  "scoreVersion",
  "seasonEnd",
  "seasonFinalized",
  "seasonStart",
  "sourceCount",
  "weeklyScore",
] as const;
const participantKeysWithCarRecipe = [...participantKeys, "carRecipe"] as const;
const participantKeysWithStreak = [...participantKeys, "streakDays"] as const;
const participantKeysWithCarRecipeAndStreak = [
  ...participantKeys,
  "carRecipe",
  "streakDays",
] as const;
const carRecipeKeys = [
  "schemaVersion",
  "chassis",
  "nose",
  "cockpit",
  "wing",
  "wheels",
  "palette",
  "trail",
  "seed",
] as const;
const carRecipeEnums =
  /^(?:formula|rally|roadster)\0(?:classic|scoop|wedge)\0(?:canopy|open|rally)\0(?:high|low|none)\0(?:all-terrain|slick|street)\0(?:magenta|mint|redline|sunburst|turbo-blue)\0(?:grid|none|spark)$/;
const handlePattern = /^[a-z0-9][a-z0-9_-]{1,22}[a-z0-9]$/;
const scoreVersionPattern = /^[a-z][a-z0-9_]{2,31}$/;

const fallbackCars = [
  {
    schemaVersion: 1,
    chassis: "formula",
    nose: "wedge",
    cockpit: "canopy",
    wing: "high",
    wheels: "slick",
    palette: "magenta",
    trail: "spark",
    seed: 1101,
  },
  {
    schemaVersion: 1,
    chassis: "roadster",
    nose: "classic",
    cockpit: "open",
    wing: "low",
    wheels: "street",
    palette: "sunburst",
    trail: "grid",
    seed: 2202,
  },
  {
    schemaVersion: 1,
    chassis: "rally",
    nose: "scoop",
    cockpit: "rally",
    wing: "high",
    wheels: "all-terrain",
    palette: "turbo-blue",
    trail: "spark",
    seed: 3303,
  },
  {
    schemaVersion: 1,
    chassis: "roadster",
    nose: "wedge",
    cockpit: "canopy",
    wing: "none",
    wheels: "street",
    palette: "mint",
    trail: "none",
    seed: 4404,
  },
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

function readCarRecipe(value: unknown): CarRecipe | undefined {
  if (!isPlainObject(value) || !hasExactDataKeys(value, carRecipeKeys)) {
    return undefined;
  }
  const recipe = value as { readonly [Key in keyof CarRecipe]: unknown };
  const enums = [
    recipe.chassis,
    recipe.nose,
    recipe.cockpit,
    recipe.wing,
    recipe.wheels,
    recipe.palette,
    recipe.trail,
  ];
  if (
    recipe.schemaVersion !== 1 ||
    enums.some((part) => typeof part !== "string") ||
    !carRecipeEnums.test(enums.join("\0")) ||
    !boundedInteger(recipe.seed, 0, 65_535)
  ) {
    return undefined;
  }
  return Object.freeze({ ...recipe }) as CarRecipe;
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

export function mapCommunityRaceStatusPageToRace(
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
      if (!isPlainObject(row)) {
        return undefined;
      }
      const carRecipeDescriptor = Object.getOwnPropertyDescriptor(row, "carRecipe");
      const streakDescriptor = Object.getOwnPropertyDescriptor(row, "streakDays");
      const hasCarRecipe =
        carRecipeDescriptor !== undefined &&
        "value" in carRecipeDescriptor &&
        carRecipeDescriptor.enumerable;
      const hasStreak =
        streakDescriptor !== undefined &&
        "value" in streakDescriptor &&
        streakDescriptor.enumerable;
      const exactParticipantKeys = hasCarRecipe
        ? hasStreak
          ? participantKeysWithCarRecipeAndStreak
          : participantKeysWithCarRecipe
        : hasStreak
          ? participantKeysWithStreak
          : participantKeys;
      if (!hasExactDataKeys(row, exactParticipantKeys)) {
        return undefined;
      }
      const activeDays = dataValue(row, "activeDays");
      const displayPosition = dataValue(row, "displayPosition");
      const freshnessDays = dataValue(row, "freshnessDays");
      const handle = dataValue(row, "handle");
      const rankPosition = dataValue(row, "rankPosition");
      const scoreVersion = dataValue(row, "scoreVersion");
      const seasonEnd = dataValue(row, "seasonEnd");
      const seasonFinalized = dataValue(row, "seasonFinalized");
      const rowSeasonStart = dataValue(row, "seasonStart");
      const sourceCount = dataValue(row, "sourceCount");
      let streakDays: number | null = null;
      if (hasStreak) {
        const streakCandidate = dataValue(row, "streakDays");
        if (!boundedInteger(streakCandidate, 0, 36_533)) {
          return undefined;
        }
        streakDays = streakCandidate;
      }
      const weeklyScore = dataValue(row, "weeklyScore");
      if (
        !boundedInteger(activeDays, 0, 7) ||
        displayPosition !== index + 1 ||
        !boundedInteger(freshnessDays, 0, 65_535) ||
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
      const car = hasCarRecipe
        ? readCarRecipe(dataValue(row, "carRecipe"))
        : (fallbackCars[index % fallbackCars.length] ?? fallbackCars[0]);
      if (car === undefined) {
        return undefined;
      }
      participants.push(
        Object.freeze({
          activeDays,
          car,
          freshnessDays,
          handle,
          id: `community-${String(displayPosition)}`,
          rank: rankPosition,
          sourceCount,
          streakDays,
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
    return mapCommunityRaceStatusPageToRace(JSON.parse(body) as unknown, seasonStart);
  } catch {
    return undefined;
  }
}
