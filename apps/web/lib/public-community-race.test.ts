import { describe, expect, it, vi } from "vitest";

import type { CommunityRacePageV1 } from "@viberacing/contracts";

import {
  currentCommunitySeasonStart,
  isPublicCommunityHandle,
  loadPublicCommunityRace,
  mapCommunityRacePageToRace,
} from "./public-community-race";

const seasonStart = "2026-07-13";
const activeRecipe = {
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
const validPage = {
  participants: [
    {
      activeDays: 7,
      displayPosition: 1,
      handle: "community_one",
      carRecipe: activeRecipe,
      rankPosition: 1,
      scoreVersion: "community_v1",
      seasonEnd: "2026-07-19",
      seasonFinalized: false,
      seasonStart,
      sourceCount: 2,
      weeklyScore: 6400,
    },
    {
      activeDays: 7,
      displayPosition: 2,
      handle: "community_two",
      rankPosition: 1,
      scoreVersion: "community_v1",
      seasonEnd: "2026-07-19",
      seasonFinalized: false,
      seasonStart,
      sourceCount: 1,
      weeklyScore: 6400,
    },
  ],
  schemaVersion: 1,
  selfReported: true,
  trustTier: "community",
} as const satisfies CommunityRacePageV1;

function scoreResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
}

describe("visible public Community race", () => {
  it.each([
    ["2026-07-13T00:00:00.000Z", "2026-07-13"],
    ["2026-07-19T23:59:59.999Z", "2026-07-13"],
    ["2027-01-01T12:00:00.000Z", "2026-12-28"],
    ["1999-12-26T12:00:00.000Z", undefined],
  ])("derives the current server-side ISO week from %s", (value, expected) => {
    expect(currentCommunitySeasonStart(new Date(value))).toBe(expected);
  });

  it("rejects an invalid clock", () => {
    expect(currentCommunitySeasonStart(new Date(Number.NaN))).toBeUndefined();
  });

  it.each([
    ["pixel_driver", true],
    ["abc", true],
    ["ab", false],
    ["Pixel_driver", false],
    ["pixel/driver", false],
    [["pixel_driver"], false],
  ])("validates one canonical public profile handle", (value, expected) => {
    expect(isPublicCommunityHandle(value)).toBe(expected);
  });

  it("maps only the validated requested season into public presentation fields", () => {
    const participants = mapCommunityRacePageToRace(validPage, seasonStart);
    expect(participants).toEqual([
      expect.objectContaining({
        car: activeRecipe,
        freshnessDays: null,
        handle: "community_one",
        id: "community-1",
        rank: 1,
        streakDays: null,
      }),
      expect.objectContaining({
        handle: "community_two",
        id: "community-2",
        rank: 1,
      }),
    ]);
    expect(Object.isFrozen(participants)).toBe(true);
    expect(Object.isFrozen(participants?.[0])).toBe(true);
    expect(Object.isFrozen(participants?.[0]?.car)).toBe(true);
    expect(participants?.[1]?.car).not.toEqual(activeRecipe);
    expect(JSON.stringify(participants)).not.toMatch(/(?:token|sourceId|profileId|github)/i);
  });

  it.each([
    [{ ...validPage, selfReported: false }, seasonStart],
    [
      {
        ...validPage,
        participants: [{ ...validPage.participants[0], seasonStart: "2026-07-06" }],
      },
      seasonStart,
    ],
    [
      {
        ...validPage,
        participants: [{ ...validPage.participants[0], displayPosition: 2 }],
      },
      seasonStart,
    ],
    [
      {
        ...validPage,
        participants: [
          {
            ...validPage.participants[0],
            carRecipe: { ...activeRecipe, assetUrl: "https://invalid.example/car.svg" },
          },
        ],
      },
      seasonStart,
    ],
    [
      {
        ...validPage,
        participants: [
          { ...validPage.participants[0], carRecipe: { ...activeRecipe, palette: "#ffffff" } },
        ],
      },
      seasonStart,
    ],
  ])("fails closed for invalid or mismatched race pages", (page, expectedSeason) => {
    expect(mapCommunityRacePageToRace(page, expectedSeason)).toBeUndefined();
  });

  it("reads the exact same-origin endpoint without credentials or caching", async () => {
    const controller = new AbortController();
    const fetchScore = vi.fn((input: string, init: RequestInit) => {
      expect(input).toBe("/v1/community/race?seasonStart=2026-07-13");
      expect(init).toMatchObject({
        cache: "no-store",
        credentials: "omit",
        headers: { accept: "application/json" },
        method: "GET",
        redirect: "error",
        signal: controller.signal,
      });
      return Promise.resolve(scoreResponse(validPage));
    });

    await expect(
      loadPublicCommunityRace(seasonStart, controller.signal, fetchScore),
    ).resolves.toHaveLength(2);
    expect(fetchScore).toHaveBeenCalledOnce();
  });

  it("does not request an invalid season", async () => {
    const fetchScore = vi.fn(() => Promise.resolve(scoreResponse(validPage)));
    await expect(
      loadPublicCommunityRace("2026-07-14", new AbortController().signal, fetchScore),
    ).resolves.toBeUndefined();
    expect(fetchScore).not.toHaveBeenCalled();
  });

  it.each([
    new Response("unavailable", { status: 503 }),
    new Response(JSON.stringify(validPage), { headers: { "content-type": "text/plain" } }),
    scoreResponse({ ...validPage, trustTier: "verified" }),
    scoreResponse(validPage, { status: 302 }),
  ])("keeps the synthetic fallback for a rejected response", async (response) => {
    await expect(
      loadPublicCommunityRace(seasonStart, new AbortController().signal, () =>
        Promise.resolve(response.clone()),
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects an oversized response before JSON parsing", async () => {
    const response = new Response("{" + "x".repeat(32_768), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
    await expect(
      loadPublicCommunityRace(seasonStart, new AbortController().signal, () =>
        Promise.resolve(response),
      ),
    ).resolves.toBeUndefined();
  });
});
