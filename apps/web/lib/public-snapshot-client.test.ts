import { describe, expect, it, vi } from "vitest";

import {
  currentCommunitySeasonStart,
  isPublicSnapshotHandle,
  loadCurrentPublicSnapshotRace,
  mapLeaderboardSnapshotToRace,
} from "./public-snapshot-client";

function validSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    generatedAt: "2026-07-27T12:00:00.000000Z",
    metricVersion: "provider_reported_tokens_v1",
    nextPage: null,
    page: 1,
    pageSize: 100,
    participantCount: 2,
    participants: [
      {
        displayPosition: 1,
        freshnessDays: 0,
        handle: "first_driver",
        rankPosition: 1,
        weeklyTokenTotal: "12345678",
      },
      {
        carRecipe: {
          schemaVersion: 1,
          chassis: "rally",
          cockpit: "rally",
          nose: "scoop",
          palette: "redline",
          seed: 202,
          trail: "grid",
          wheels: "all-terrain",
          wing: "low",
        },
        displayPosition: 2,
        freshnessDays: 1,
        handle: "second_driver",
        rankPosition: 2,
        weeklyTokenTotal: "4096",
      },
    ],
    schemaVersion: 1,
    seasonEnd: "2026-08-02",
    seasonStart: "2026-07-27",
    seasonState: "open",
    snapshotRevision: 4,
    trustTier: "community",
    ...overrides,
  };
}

describe("public snapshot browser client", () => {
  it("derives only canonical UTC Monday seasons", () => {
    expect(currentCommunitySeasonStart(new Date("2026-07-29T23:59:59.000Z"))).toBe(
      "2026-07-27",
    );
    expect(currentCommunitySeasonStart(new Date(Number.NaN))).toBeUndefined();
  });

  it.each([
    ["demo_driver", true],
    ["a-b", true],
    ["AB_driver", false],
    ["../private", false],
    ["ab", false],
    [null, false],
  ])("validates one canonical public handle %#", (value, expected) => {
    expect(isPublicSnapshotHandle(value)).toBe(expected);
  });

  it("maps one validated page to a bounded top32 race without exposing account fields", () => {
    const participants = mapLeaderboardSnapshotToRace(validSnapshot(), "2026-07-27");

    expect(participants).toHaveLength(2);
    expect(participants?.[0]).toMatchObject({
      activeDays: 0,
      freshnessDays: 0,
      handle: "first_driver",
      id: "community-1",
      rank: 1,
      sourceCount: 0,
      streakDays: null,
      weeklyScore: 12_345_678,
    });
    expect(participants?.[1]?.car).toMatchObject({ palette: "redline", seed: 202 });
    expect(Object.isFrozen(participants)).toBe(true);
    expect(Object.isFrozen(participants?.[0])).toBe(true);
  });

  it("takes only the first 32 rows from the single server-sized page", () => {
    const participants = Array.from({ length: 40 }, (_, index) => ({
      displayPosition: index + 1,
      freshnessDays: null,
      handle: `driver_${String(index).padStart(2, "0")}`,
      rankPosition: index + 1,
      weeklyTokenTotal: String(10_000 - index),
    }));
    const mapped = mapLeaderboardSnapshotToRace(
      validSnapshot({ participantCount: 40, participants }),
      "2026-07-27",
    );

    expect(mapped).toHaveLength(32);
    expect(mapped?.at(-1)?.handle).toBe("driver_31");
  });

  it.each([
    [validSnapshot(), "2026-07-20"],
    [validSnapshot({ page: 2 }), "2026-07-27"],
    [validSnapshot({ trustTier: "verified" }), "2026-07-27"],
    [
      validSnapshot({
        participants: [
          {
            displayPosition: 1,
            freshnessDays: 0,
            handle: "unsafe_tokens",
            rankPosition: 1,
            weeklyTokenTotal: "9007199254740992",
          },
        ],
      }),
      "2026-07-27",
    ],
    [new Proxy({}, { getPrototypeOf: () => { throw new Error("hostile"); } }), "2026-07-27"],
  ])("rejects an invalid or unsafe snapshot %#", (value, seasonStart) => {
    expect(mapLeaderboardSnapshotToRace(value, seasonStart)).toBeUndefined();
  });

  it("loads exactly one cacheable credential-free current page", async () => {
    const fetchSnapshot = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(validSnapshot()), {
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
      ),
    );
    const controller = new AbortController();

    await expect(
      loadCurrentPublicSnapshotRace(
        "2026-07-27",
        controller.signal,
        fetchSnapshot,
      ),
    ).resolves.toMatchObject({ metric: "tokens" });
    expect(fetchSnapshot).toHaveBeenCalledWith(
      "/v1/leaderboards/current?trustTier=community&page=1",
      {
        cache: "default",
        credentials: "omit",
        headers: { accept: "application/json" },
        method: "GET",
        redirect: "error",
        signal: controller.signal,
      },
    );
  });

  it("fails closed before fetch for an invalid season", async () => {
    const fetchSnapshot = vi.fn();
    await expect(
      loadCurrentPublicSnapshotRace(
        "2026-07-28",
        new AbortController().signal,
        fetchSnapshot,
      ),
    ).resolves.toBeUndefined();
    expect(fetchSnapshot).not.toHaveBeenCalled();
  });

  it.each([
    new Response(null, { status: 503 }),
    new Response(JSON.stringify(validSnapshot()), {
      headers: { "content-type": "text/plain" },
    }),
    new Response("{", {
      headers: { "content-type": "application/json; charset=utf-8" },
    }),
    new Response("x".repeat(1_048_577), {
      headers: { "content-type": "application/json; charset=utf-8" },
    }),
  ])("contains an unavailable or malformed response %#", async (response) => {
    await expect(
      loadCurrentPublicSnapshotRace(
        "2026-07-27",
        new AbortController().signal,
        () => Promise.resolve(response),
      ),
    ).resolves.toBeUndefined();
  });

  it("contains fetch failures", async () => {
    await expect(
      loadCurrentPublicSnapshotRace(
        "2026-07-27",
        new AbortController().signal,
        () => Promise.reject(new Error("private network detail")),
      ),
    ).resolves.toBeUndefined();
  });
});
