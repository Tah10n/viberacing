import { describe, expect, it, vi } from "vitest";

import type {
  CommunityRaceStatusPageV1,
  CommunityTokenRaceStatusPageV1,
} from "@viberacing/contracts";

import {
  currentCommunitySeasonStart,
  isPublicCommunityHandle,
  loadPreferredPublicCommunityRace,
  loadPublicCommunityRace,
  loadPublicCommunityTokenRace,
  mapCommunityRaceStatusPageToRace,
  mapCommunityTokenRaceStatusPageToRace,
} from "./public-community-race";

const seasonStart = "2026-07-13";
const tokenSeasonStart = "2026-07-27";
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
      freshnessDays: 0,
      handle: "community_one",
      carRecipe: activeRecipe,
      rankPosition: 1,
      scoreVersion: "community_v1",
      seasonEnd: "2026-07-19",
      seasonFinalized: false,
      seasonStart,
      sourceCount: 2,
      streakDays: 13,
      weeklyScore: 6400,
    },
    {
      activeDays: 7,
      displayPosition: 2,
      freshnessDays: 2,
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
} as const satisfies CommunityRaceStatusPageV1;
const validTokenPage = {
  participants: [
    {
      activeDays: 7,
      displayPosition: 1,
      freshnessDays: 0,
      handle: "token_one",
      carRecipe: activeRecipe,
      metricVersion: "community_tokens_v1",
      rankPosition: 1,
      seasonEnd: "2026-08-02",
      seasonFinalized: false,
      seasonStart: tokenSeasonStart,
      sourceCount: 2,
      streakDays: 13,
      weeklyTokenTotal: 12_345_678,
    },
    {
      activeDays: 6,
      displayPosition: 2,
      freshnessDays: 1,
      handle: "token_two",
      metricVersion: "community_tokens_v1",
      rankPosition: 2,
      seasonEnd: "2026-08-02",
      seasonFinalized: false,
      seasonStart: tokenSeasonStart,
      sourceCount: 1,
      weeklyTokenTotal: 9_876_543,
    },
  ],
  schemaVersion: 1,
  selfReported: true,
  trustTier: "community",
} as const satisfies CommunityTokenRaceStatusPageV1;

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
    const participants = mapCommunityRaceStatusPageToRace(validPage, seasonStart);
    expect(participants).toEqual([
      expect.objectContaining({
        car: activeRecipe,
        freshnessDays: 0,
        handle: "community_one",
        id: "community-1",
        rank: 1,
        streakDays: 13,
      }),
      expect.objectContaining({
        handle: "community_two",
        freshnessDays: 2,
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
        participants: validPage.participants.map((participant) => {
          const { freshnessDays: _freshnessDays, ...withoutFreshness } = participant;
          void _freshnessDays;
          return withoutFreshness;
        }),
      },
      seasonStart,
    ],
    [
      {
        ...validPage,
        participants: [{ ...validPage.participants[0], freshnessDays: 65_536 }],
      },
      seasonStart,
    ],
    [
      {
        ...validPage,
        participants: [{ ...validPage.participants[0], streakDays: null }],
      },
      seasonStart,
    ],
    [
      {
        ...validPage,
        participants: [{ ...validPage.participants[0], streakDays: 36_534 }],
      },
      seasonStart,
    ],
    [
      {
        ...validPage,
        participants: [
          {
            ...validPage.participants[0],
            receivedAt: "2026-07-18T12:34:56.789Z",
          },
        ],
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
    expect(mapCommunityRaceStatusPageToRace(page, expectedSeason)).toBeUndefined();
  });

  it("maps the direct-token contract into the existing relative race presentation", () => {
    const participants = mapCommunityTokenRaceStatusPageToRace(validTokenPage, tokenSeasonStart);

    expect(participants).toEqual([
      expect.objectContaining({
        car: activeRecipe,
        handle: "token_one",
        rank: 1,
        streakDays: 13,
        weeklyScore: 12_345_678,
      }),
      expect.objectContaining({
        handle: "token_two",
        rank: 2,
        weeklyScore: 9_876_543,
      }),
    ]);
    expect(Object.isFrozen(participants)).toBe(true);
    expect(Object.isFrozen(participants?.[0])).toBe(true);
    expect(participants?.[1]?.car).not.toEqual(activeRecipe);

    const carOnly = {
      ...validTokenPage,
      participants: [
        {
          ...validTokenPage.participants[0],
          streakDays: undefined,
        },
      ],
    };
    delete (carOnly.participants[0] as { streakDays?: unknown }).streakDays;
    const streakOnly = {
      ...validTokenPage,
      participants: [
        {
          ...validTokenPage.participants[1],
          displayPosition: 1,
          streakDays: 2,
        },
      ],
    };
    expect(mapCommunityTokenRaceStatusPageToRace(carOnly, tokenSeasonStart)).toHaveLength(1);
    expect(mapCommunityTokenRaceStatusPageToRace(streakOnly, tokenSeasonStart)).toHaveLength(1);
  });

  it.each([
    [{ ...validTokenPage, trustTier: "verified" }, tokenSeasonStart],
    [
      {
        ...validTokenPage,
        participants: [{ ...validTokenPage.participants[0], metricVersion: "community_v1" }],
      },
      tokenSeasonStart,
    ],
    [
      {
        ...validTokenPage,
        participants: [
          { ...validTokenPage.participants[0], weeklyTokenTotal: Number.MAX_SAFE_INTEGER + 1 },
        ],
      },
      tokenSeasonStart,
    ],
    [
      {
        ...validTokenPage,
        participants: [{ ...validTokenPage.participants[0], weeklyScore: 7000 }],
      },
      tokenSeasonStart,
    ],
    [
      {
        ...validTokenPage,
        participants: [{ ...validTokenPage.participants[0], displayPosition: 2 }],
      },
      tokenSeasonStart,
    ],
    [
      {
        ...validTokenPage,
        participants: [{ ...validTokenPage.participants[0], streakDays: null }],
      },
      tokenSeasonStart,
    ],
    [
      {
        ...validTokenPage,
        participants: [
          {
            ...validTokenPage.participants[0],
            carRecipe: { ...activeRecipe, palette: "#ffffff" },
          },
        ],
      },
      tokenSeasonStart,
    ],
    [validTokenPage, "2026-07-28"],
  ])("fails closed for invalid direct-token pages", (page, expectedSeason) => {
    expect(mapCommunityTokenRaceStatusPageToRace(page, expectedSeason)).toBeUndefined();
  });

  it("reads the exact same-origin endpoint without credentials or caching", async () => {
    const controller = new AbortController();
    const fetchScore = vi.fn((input: string, init: RequestInit) => {
      expect(input).toBe("/v1/community/race/status?seasonStart=2026-07-13");
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

  it("loads the exact token endpoint without credentials and maps its response", async () => {
    const controller = new AbortController();
    const fetchScore = vi.fn((input: string, init: RequestInit) => {
      expect(input).toBe("/v1/community/tokens?seasonStart=2026-07-27");
      expect(init).toMatchObject({
        cache: "no-store",
        credentials: "omit",
        headers: { accept: "application/json" },
        method: "GET",
        redirect: "error",
        signal: controller.signal,
      });
      return Promise.resolve(scoreResponse(validTokenPage));
    });

    await expect(
      loadPublicCommunityTokenRace(tokenSeasonStart, controller.signal, fetchScore),
    ).resolves.toHaveLength(2);
    expect(fetchScore).toHaveBeenCalledOnce();
  });

  it("fails closed for invalid token seasons, responses, and oversized bodies", async () => {
    const fetchScore = vi.fn(() => Promise.resolve(scoreResponse(validTokenPage)));
    await expect(
      loadPublicCommunityTokenRace("2026-07-28", new AbortController().signal, fetchScore),
    ).resolves.toBeUndefined();
    expect(fetchScore).not.toHaveBeenCalled();

    for (const response of [
      new Response("unavailable", { status: 503 }),
      new Response(JSON.stringify(validTokenPage), {
        headers: { "content-type": "text/plain" },
      }),
      scoreResponse({ ...validTokenPage, selfReported: false }),
      new Response("{" + "x".repeat(32_768), {
        headers: { "content-type": "application/json; charset=utf-8" },
      }),
    ]) {
      await expect(
        loadPublicCommunityTokenRace(tokenSeasonStart, new AbortController().signal, () =>
          Promise.resolve(response.clone()),
        ),
      ).resolves.toBeUndefined();
    }
    await expect(
      loadPublicCommunityTokenRace(tokenSeasonStart, new AbortController().signal, () =>
        Promise.reject(new Error("private-network-error")),
      ),
    ).resolves.toBeUndefined();
  });

  it("prefers nonempty token standings and otherwise falls back without inventing data", async () => {
    const signal = new AbortController().signal;
    const tokenFirst = vi.fn(() => Promise.resolve(scoreResponse(validTokenPage)));
    await expect(
      loadPreferredPublicCommunityRace(tokenSeasonStart, signal, tokenFirst),
    ).resolves.toMatchObject({ metric: "tokens", participants: { length: 2 } });
    expect(tokenFirst).toHaveBeenCalledOnce();

    const emptyTokenPage = { ...validTokenPage, participants: [] };
    const fallback = vi
      .fn<(input: string) => Promise<Response>>()
      .mockResolvedValueOnce(scoreResponse(emptyTokenPage))
      .mockResolvedValueOnce(scoreResponse(validPage));
    await expect(
      loadPreferredPublicCommunityRace(seasonStart, signal, fallback),
    ).resolves.toMatchObject({ metric: "score", participants: { length: 2 } });
    expect(fallback).toHaveBeenCalledTimes(2);

    const unavailableToken = vi
      .fn<(input: string) => Promise<Response>>()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(scoreResponse(validPage));
    await expect(
      loadPreferredPublicCommunityRace(seasonStart, signal, unavailableToken),
    ).resolves.toMatchObject({ metric: "score", participants: { length: 2 } });

    const emptyOnly = vi
      .fn<(input: string) => Promise<Response>>()
      .mockResolvedValueOnce(scoreResponse(emptyTokenPage))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    await expect(
      loadPreferredPublicCommunityRace(tokenSeasonStart, signal, emptyOnly),
    ).resolves.toEqual({ metric: "tokens", participants: [] });

    const unavailable = vi.fn(() => Promise.resolve(new Response("unavailable", { status: 503 })));
    await expect(
      loadPreferredPublicCommunityRace(tokenSeasonStart, signal, unavailable),
    ).resolves.toBeUndefined();
  });
});
