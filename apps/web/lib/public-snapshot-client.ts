import {
  validateLeaderboardSnapshotV1,
  type LeaderboardSnapshotV1,
} from "@viberacing/contracts";

import type { CarRecipe } from "./car-recipe";
import type { PublicRaceParticipant } from "./race-types";

const currentLeaderboardPath =
  "/v1/leaderboards/current?trustTier=community&page=1";
const maximumResponseCharacters = 1_048_576;
const minimumSeasonStart = "1999-12-27";
const maximumSeasonStart = "2099-12-28";
const handlePattern = /^[a-z0-9](?:[a-z0-9_-]{1,22}[a-z0-9])$/;

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

type SnapshotFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface LoadedPublicSnapshotRace {
  readonly metric: "tokens";
  readonly participants: readonly PublicRaceParticipant[];
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

export function isPublicSnapshotHandle(value: unknown): value is string {
  return typeof value === "string" && handlePattern.test(value);
}

export function mapLeaderboardSnapshotToRace(
  value: unknown,
  expectedSeasonStart: string,
): readonly PublicRaceParticipant[] | undefined {
  const validation = validateLeaderboardSnapshotV1(value);
  if (
    !validation.ok ||
    !validSeasonStart(expectedSeasonStart) ||
    validation.value.seasonStart !== expectedSeasonStart ||
    validation.value.page !== 1
  ) {
    return undefined;
  }
  const participants: PublicRaceParticipant[] = [];
  const top32 = validation.value.participants.slice(0, 32);
  for (const [index, participant] of top32.entries()) {
    const weeklyTokens = Number(participant.weeklyTokenTotal);
    const fallbackCar = fallbackCars[index % fallbackCars.length] ?? fallbackCars[0];
    if (!Number.isSafeInteger(weeklyTokens) || weeklyTokens < 0) {
      return undefined;
    }
    participants.push(
      Object.freeze({
        activeDays: 0,
        car: participant.carRecipe ?? fallbackCar,
        freshnessDays: participant.freshnessDays,
        handle: participant.handle,
        id: `community-${String(participant.displayPosition)}`,
        rank: participant.rankPosition,
        sourceCount: 0,
        streakDays: null,
        weeklyScore: weeklyTokens,
      }),
    );
  }
  return Object.freeze(participants);
}

export async function loadCurrentPublicSnapshotRace(
  expectedSeasonStart: string,
  signal: AbortSignal,
  fetchSnapshot: SnapshotFetch = fetch,
): Promise<LoadedPublicSnapshotRace | undefined> {
  if (!validSeasonStart(expectedSeasonStart)) {
    return undefined;
  }
  try {
    const response = await fetchSnapshot(currentLeaderboardPath, {
      cache: "default",
      credentials: "omit",
      headers: { accept: "application/json" },
      method: "GET",
      redirect: "error",
      signal,
    });
    if (
      !response.ok ||
      response.headers.get("content-type")?.toLowerCase() !==
        "application/json; charset=utf-8"
    ) {
      return undefined;
    }
    const body = await response.text();
    if (body.length < 2 || body.length > maximumResponseCharacters) {
      return undefined;
    }
    const participants = mapLeaderboardSnapshotToRace(
      JSON.parse(body) as unknown,
      expectedSeasonStart,
    );
    return participants === undefined
      ? undefined
      : Object.freeze({ metric: "tokens", participants });
  } catch {
    return undefined;
  }
}

export type PublicSnapshotPayload = LeaderboardSnapshotV1;
